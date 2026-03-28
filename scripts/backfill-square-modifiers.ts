/**
 * Backfill Square modifier prices.
 *
 * Reads existing items from squareup.db, re-fetches order details from Square API
 * to get modifier pricing, and updates modifiers_json on each item.
 */
import Database from "better-sqlite3";
import path from "path";

const SQUARE_BASE_URL = "https://connect.squareup.com/v2";

function getToken(): string {
  // Try env var first
  if (process.env.SQUARE_ACCESS_TOKEN) return process.env.SQUARE_ACCESS_TOKEN;
  // Fall back to database-stored token
  try {
    const configDb = new Database(path.join(process.cwd(), "databases", "categories.db"), { readonly: true });
    const row = configDb.prepare("SELECT value FROM settings WHERE key = 'square_api_token'").get() as { value: string } | undefined;
    configDb.close();
    if (row?.value) return row.value;
  } catch {}
  throw new Error("No Square token found. Set SQUARE_ACCESS_TOKEN or configure in settings.");
}

interface ModifierJson {
  group: string;
  name: string;
  price: number;
}

async function batchRetrieveOrders(orderIds: string[]): Promise<Map<string, any>> {
  const token = getToken();
  const result = new Map<string, any>();

  for (let i = 0; i < orderIds.length; i += 100) {
    const batch = orderIds.slice(i, i + 100);
    console.log(`  Fetching batch ${Math.floor(i / 100) + 1} (${batch.length} orders)...`);

    const response = await fetch(`${SQUARE_BASE_URL}/orders/batch-retrieve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Square-Version": "2025-01-23",
      },
      body: JSON.stringify({ order_ids: batch }),
    });

    if (!response.ok) {
      console.warn(`  Batch failed: HTTP ${response.status}`);
      continue;
    }

    const data = await response.json();
    if (data.orders) {
      for (const order of data.orders) {
        result.set(order.id, order);
      }
    }

    // Rate limit: small delay between batches
    if (i + 100 < orderIds.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  return result;
}

async function main() {
  const dbPath = path.join(process.cwd(), "databases", "squareup.db");
  const db = new Database(dbPath);

  // Ensure modifiers_json column exists
  try { db.exec("ALTER TABLE items ADD COLUMN modifiers_json TEXT"); } catch (e: any) {
    if (!e.message?.includes("duplicate column")) throw e;
  }

  // Get all unique transaction_ids (payment IDs) that have items with modifiers but no modifiers_json
  const rows = db.prepare(`
    SELECT DISTINCT transaction_id
    FROM items
    WHERE modifiers_applied IS NOT NULL AND modifiers_applied != ''
      AND (modifiers_json IS NULL OR modifiers_json = '')
      AND transaction_id IS NOT NULL AND transaction_id != ''
  `).all() as { transaction_id: string }[];

  console.log(`Found ${rows.length} payments with modifiers to backfill`);
  if (rows.length === 0) {
    console.log("Nothing to do!");
    db.close();
    return;
  }

  // We need order_ids, not payment_ids. Square payments have an order_id field.
  // But we don't store the order_id in squareup.db — we need to look it up via the API.
  // Let's fetch payments to get their order_ids.
  const token = getToken();
  const paymentIds = rows.map(r => r.transaction_id);
  const paymentToOrderId = new Map<string, string>();

  console.log("Looking up order IDs for payments...");
  // Fetch payments in batches (no batch endpoint — use list with cursor)
  // Actually, we can use the Orders API search to find orders by payment
  // Simpler: just get all orders for our location within the date range

  // Get date range from items
  const dateRange = db.prepare(`
    SELECT MIN(date) as min_date, MAX(date) as max_date FROM items
  `).get() as { min_date: string; max_date: string };

  console.log(`Date range: ${dateRange.min_date} to ${dateRange.max_date}`);

  // Get location IDs first
  console.log("Fetching Square locations...");
  const locResponse = await fetch(`${SQUARE_BASE_URL}/locations`, {
    headers: { Authorization: `Bearer ${token}`, "Square-Version": "2025-01-23" },
  });
  const locData = await locResponse.json();
  const locationIds = (locData.locations || []).map((l: any) => l.id);
  console.log(`Found ${locationIds.length} locations: ${locationIds.join(", ")}`);

  if (locationIds.length === 0) {
    console.error("No locations found!");
    db.close();
    return;
  }

  // Search orders by date range
  let allOrders = new Map<string, any>();
  let cursor: string | undefined;

  console.log("Fetching all orders from Square API...");
  do {
    const body: any = {
      location_ids: locationIds,
      query: {
        filter: {
          date_time_filter: {
            created_at: {
              start_at: `${dateRange.min_date}T00:00:00Z`,
              end_at: `${dateRange.max_date}T23:59:59Z`,
            },
          },
        },
        sort: { sort_field: "CREATED_AT", sort_order: "ASC" },
      },
      limit: 500,
    };
    if (cursor) body.cursor = cursor;

    const response = await fetch(`${SQUARE_BASE_URL}/orders/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Square-Version": "2025-01-23",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.error(`Orders search failed: HTTP ${response.status}`);
      break;
    }

    const data = await response.json();
    const orders = data.orders || [];
    for (const order of orders) {
      // Map tenders (payments) to order
      if (order.tenders) {
        for (const tender of order.tenders) {
          if (tender.payment_id && paymentIds.includes(tender.payment_id)) {
            paymentToOrderId.set(tender.payment_id, order.id);
          }
        }
      }
      allOrders.set(order.id, order);
    }

    cursor = data.cursor;
    console.log(`  Fetched ${orders.length} orders (total mapped: ${paymentToOrderId.size})`);
  } while (cursor);

  console.log(`Mapped ${paymentToOrderId.size} payments to order IDs`);

  // Now get unique order IDs and batch-retrieve for line item details
  const uniqueOrderIds = [...new Set(paymentToOrderId.values())];
  console.log(`Fetching details for ${uniqueOrderIds.length} orders...`);
  const orderDetails = await batchRetrieveOrders(uniqueOrderIds);

  // Update items with modifiers_json
  const update = db.prepare("UPDATE items SET modifiers_json = ? WHERE transaction_id = ? AND item = ?");
  let updated = 0;
  let skipped = 0;

  const tx = db.transaction(() => {
    for (const [paymentId, orderId] of paymentToOrderId) {
      const order = orderDetails.get(orderId) || allOrders.get(orderId);
      if (!order?.line_items) continue;

      for (const li of order.line_items) {
        if (!li.modifiers || li.modifiers.length === 0) continue;

        const modsJson: ModifierJson[] = li.modifiers.map((m: any) => ({
          group: "",
          name: m.name || "",
          price: Math.round(((m.total_price_money?.amount || m.base_price_money?.amount || 0) / 100) * 100) / 100,
        }));

        const result = update.run(
          JSON.stringify(modsJson),
          paymentId,
          li.name || ""
        );
        if (result.changes > 0) updated++;
        else skipped++;
      }
    }
  });
  tx();

  console.log(`\nBackfill complete: ${updated} items updated, ${skipped} skipped`);
  db.close();
}

main().catch(console.error);
