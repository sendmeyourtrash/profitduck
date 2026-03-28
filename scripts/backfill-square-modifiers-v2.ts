/**
 * Backfill Square modifier prices (v2).
 *
 * For each payment with flat modifiers but no JSON, fetches the payment
 * from Square API to get order_id, then batch-retrieves order details
 * for modifier pricing.
 *
 * Slower but more reliable than v1 (which used Orders Search + tender matching).
 */
import Database from "better-sqlite3";
import path from "path";

const SQUARE_BASE_URL = "https://connect.squareup.com/v2";

function getToken(): string {
  if (process.env.SQUARE_ACCESS_TOKEN) return process.env.SQUARE_ACCESS_TOKEN;
  try {
    const configDb = new Database(path.join(process.cwd(), "databases", "categories.db"), { readonly: true });
    const row = configDb.prepare("SELECT value FROM settings WHERE key = 'square_api_token'").get() as { value: string } | undefined;
    configDb.close();
    if (row?.value) return row.value;
  } catch {}
  throw new Error("No Square token found.");
}

async function fetchPayment(token: string, paymentId: string): Promise<string | null> {
  const response = await fetch(`${SQUARE_BASE_URL}/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${token}`, "Square-Version": "2025-01-23" },
  });
  if (!response.ok) return null;
  const data = await response.json();
  return data.payment?.order_id || null;
}

async function batchRetrieveOrders(token: string, orderIds: string[]): Promise<Map<string, any>> {
  const result = new Map<string, any>();
  for (let i = 0; i < orderIds.length; i += 100) {
    const batch = orderIds.slice(i, i + 100);
    const response = await fetch(`${SQUARE_BASE_URL}/orders/batch-retrieve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Square-Version": "2025-01-23" },
      body: JSON.stringify({ order_ids: batch }),
    });
    if (!response.ok) continue;
    const data = await response.json();
    for (const order of data.orders || []) result.set(order.id, order);
    if (i + 100 < orderIds.length) await new Promise(r => setTimeout(r, 100));
  }
  return result;
}

async function main() {
  const token = getToken();
  const db = new Database(path.join(process.cwd(), "databases", "squareup.db"));

  // Ensure column exists
  try { db.exec("ALTER TABLE items ADD COLUMN modifiers_json TEXT"); } catch (e: any) {
    if (!e.message?.includes("duplicate column")) throw e;
  }

  // Get distinct payment IDs that need backfill
  const rows = db.prepare(`
    SELECT DISTINCT transaction_id FROM items
    WHERE modifiers_applied IS NOT NULL AND modifiers_applied <> ''
      AND (modifiers_json IS NULL OR modifiers_json = '')
      AND transaction_id IS NOT NULL AND transaction_id <> ''
  `).all() as { transaction_id: string }[];

  console.log(`${rows.length} payments need backfill`);
  if (rows.length === 0) { db.close(); return; }

  // Phase 1: Fetch payment → order_id mapping (batched in groups of 50)
  const paymentToOrder = new Map<string, string>();
  const BATCH_SIZE = 50;
  let fetched = 0;
  let failed = 0;

  console.log("Phase 1: Fetching payment → order_id mappings...");
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (r) => {
        const orderId = await fetchPayment(token, r.transaction_id);
        return { paymentId: r.transaction_id, orderId };
      })
    );

    for (const r of results) {
      if (r.orderId) {
        paymentToOrder.set(r.paymentId, r.orderId);
        fetched++;
      } else {
        failed++;
      }
    }

    const pct = Math.round(((i + batch.length) / rows.length) * 100);
    process.stdout.write(`\r  ${i + batch.length}/${rows.length} (${pct}%) — ${fetched} mapped, ${failed} failed`);

    // Rate limit: ~50 requests per batch, small delay
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`\n  Done: ${fetched} mapped, ${failed} failed`);

  // Phase 2: Batch-retrieve orders
  const uniqueOrderIds = [...new Set(paymentToOrder.values())];
  console.log(`Phase 2: Fetching ${uniqueOrderIds.length} order details...`);
  const orderDetails = await batchRetrieveOrders(token, uniqueOrderIds);
  console.log(`  Got ${orderDetails.size} orders`);

  // Phase 3: Update items
  const update = db.prepare("UPDATE items SET modifiers_json = ? WHERE transaction_id = ? AND item = ?");
  let updated = 0;

  const tx = db.transaction(() => {
    for (const [paymentId, orderId] of paymentToOrder) {
      const order = orderDetails.get(orderId);
      if (!order?.line_items) continue;

      for (const li of order.line_items) {
        if (!li.modifiers || li.modifiers.length === 0) continue;

        const modsJson = li.modifiers.map((m: any) => ({
          group: "",
          name: m.name || "",
          price: Math.round(((m.total_price_money?.amount || m.base_price_money?.amount || 0) / 100) * 100) / 100,
        }));

        const result = update.run(JSON.stringify(modsJson), paymentId, li.name || "");
        if (result.changes > 0) updated++;
      }
    }
  });
  tx();

  console.log(`\nPhase 3: ${updated} items updated`);
  db.close();
}

main().catch(console.error);
