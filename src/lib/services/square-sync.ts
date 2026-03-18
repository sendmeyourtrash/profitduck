/**
 * Square API sync service — follows the 2-step pipeline:
 *
 *   Step 1: Square API → squareup.db (items table)
 *   Step 2: squareup.db → sales.db (orders table)
 *
 * Flow:
 * 1. Fetch all payments from Square API (cursor-paginated)
 * 2. For each payment, get the real order_id
 * 3. Batch-retrieve order details (line items, tax, dining option)
 * 4. STEP 1: Deduplicate and write to squareup.db (items table)
 * 5. STEP 2: Read new items from squareup.db, aggregate by transaction_id,
 *    write to sales.db (orders table)
 *
 * @see pipeline-step1-ingest.ts
 * @see pipeline-step2-unify.ts
 * @see PIPELINE.md
 */

import Database from "better-sqlite3";
import path from "path";
import {
  fetchAllPayments,
  batchRetrieveOrders,
  SquarePayment,
  SquareOrderData,
} from "./square-api";
import { ProgressCallback } from "./progress";

const DB_DIR = path.join(process.cwd(), "databases");
const SQUAREUP_DB_PATH = path.join(DB_DIR, "squareup.db");
const SALES_DB_PATH = path.join(DB_DIR, "sales.db");

const CARD_BRAND_MAP: Record<string, string> = {
  VISA: "Visa",
  MASTERCARD: "MasterCard",
  AMERICAN_EXPRESS: "American Express",
  DISCOVER: "Discover",
  DISCOVER_DINERS: "Discover",
  JCB: "JCB",
  CHINA_UNIONPAY: "UnionPay",
  SQUARE_GIFT_CARD: "Gift Card",
  FELICA: "Felica",
  OTHER_BRAND: "Other",
};

function normalizeCardBrand(payment: SquarePayment): string {
  if (payment.source_type === "CASH") return "";
  const raw = payment.card_details?.card?.card_brand || "";
  return CARD_BRAND_MAP[raw] || raw || "";
}

function calculateProcessingFee(payment: SquarePayment): number {
  if (!payment.processing_fee || payment.processing_fee.length === 0) return 0;
  return payment.processing_fee.reduce(
    (sum, fee) => sum + (fee.amount_money?.amount || 0),
    0
  );
}

export interface SyncResult {
  totalPayments: number;
  newOrders: number;
  skippedDuplicates: number;
  errors: number;
}

/**
 * Sync Square payments following the 2-step pipeline.
 *
 * Step 1: API → squareup.db (items table, raw data with cleanup)
 * Step 2: squareup.db → sales.db (unified orders table)
 */
export async function syncSquareFees(
  startDate?: string,
  endDate?: string,
  onProgress?: ProgressCallback
): Promise<SyncResult> {
  const label = startDate
    ? `Square Sync (since ${new Date(startDate).toLocaleDateString()})`
    : "Square Sync (full)";
  console.log(`[Square Sync] ${label}`);

  // ============================================================
  // FETCH — Get payments + order details from Square API
  // ============================================================

  const payments = await fetchAllPayments(startDate, endDate, onProgress);
  console.log(`[Square Sync] Fetched ${payments.length} payments`);

  // Dedup against squareup.db (Step 1 source of truth)
  const sqDb = new Database(SQUAREUP_DB_PATH);
  const existingIds = new Set<string>(
    (sqDb.prepare("SELECT DISTINCT transaction_id FROM items WHERE transaction_id != '' AND source = 'api'").all() as { transaction_id: string }[])
      .map((r) => r.transaction_id)
  );
  sqDb.close();

  const newPayments = payments.filter((p) => !existingIds.has(p.id));
  console.log(`[Square Sync] ${newPayments.length} new payments (${existingIds.size} already in squareup.db)`);

  if (newPayments.length === 0) {
    return { totalPayments: payments.length, newOrders: 0, skippedDuplicates: payments.length, errors: 0 };
  }

  // Fetch order details (line items)
  onProgress?.({
    phase: "loading",
    current: 0,
    total: newPayments.length,
    message: `Fetching order details for ${newPayments.length} new payments...`,
  });

  const paymentToOrderId = new Map<string, string>();
  for (const p of newPayments) {
    if (p.order_id) {
      paymentToOrderId.set(p.id, p.order_id);
    }
  }

  const realOrderIds = [...new Set(paymentToOrderId.values())];
  let orderData = new Map<string, SquareOrderData>();
  if (realOrderIds.length > 0) {
    orderData = await batchRetrieveOrders(realOrderIds);
  }
  console.log(`[Square Sync] Got order details for ${orderData.size} orders`);

  // ============================================================
  // STEP 1: Write to squareup.db (items table)
  // ============================================================

  onProgress?.({
    phase: "creating",
    current: 0,
    total: newPayments.length,
    message: "Step 1: Writing to squareup.db...",
  });

  const step1Db = new Database(SQUAREUP_DB_PATH);
  const insertItem = step1Db.prepare(`
    INSERT INTO items (date, time, time_zone, category, item, qty, price_point_name, sku,
      modifiers_applied, gross_sales, discounts, net_sales, tax, transaction_id, payment_id,
      device_name, notes, details, event_type, location, dining_option, customer_id, customer_name,
      customer_reference_id, unit, count, itemization_type, fulfillment_note, channel, token,
      card_brand, pan_suffix, processing_fee, tip, source, platform)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api', 'square')
  `);

  let newItemsCount = 0;
  let errors = 0;
  const newTransactionIds: string[] = [];

  const step1Insert = step1Db.transaction(() => {
    for (let i = 0; i < newPayments.length; i++) {
      const payment = newPayments[i];

      if (i % 50 === 0) {
        onProgress?.({
          phase: "creating",
          current: i,
          total: newPayments.length,
          message: `Step 1: Writing items... ${i} / ${newPayments.length}`,
        });
      }

      try {
        const totalCents = payment.total_money?.amount || 0;
        if (totalCents === 0) continue;

        const amountCents = payment.amount_money?.amount || 0;
        const tipCents = payment.tip_money?.amount || 0;
        const feeCents = calculateProcessingFee(payment);
        const cardBrand = normalizeCardBrand(payment);

        const realOrderId = paymentToOrderId.get(payment.id);
        const detail = realOrderId ? orderData.get(realOrderId) : undefined;
        const taxCents = detail?.totalTaxCents || 0;

        const grossDollars = (amountCents - taxCents) / 100;
        const taxDollars = taxCents / 100;
        const tipDollars = tipCents / 100;
        const feeDollars = feeCents / 100;

        const diningOption = detail?.diningOption || "For Here";
        const orderDate = new Date(payment.created_at);
        // Convert UTC to Eastern time
        const eastern = new Intl.DateTimeFormat("en-US", {
          timeZone: "America/New_York",
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit",
          hour12: false,
        }).formatToParts(orderDate);
        const ep: Record<string, string> = {};
        for (const p of eastern) if (p.type !== "literal") ep[p.type] = p.value;
        const dateStr = `${ep.year}-${ep.month}-${ep.day}`;
        const h = ep.hour === "24" ? "00" : ep.hour;
        const timeStr = `${h}:${ep.minute}:${ep.second}`;

        if (detail?.lineItems && detail.lineItems.length > 0) {
          for (const li of detail.lineItems) {
            const qty = parseInt(li.quantity) || 1;
            const liGross = (li.total_money?.amount || 0) / 100;
            const liTax = (li.total_tax_money?.amount || 0) / 100;
            const liDisc = (li.total_discount_money?.amount || 0) / 100;
            const liNet = liGross - liTax;

            // Get modifiers
            const mods = (li.modifiers || []).map((m: { name?: string }) => m.name || "").filter(Boolean).join(", ");

            insertItem.run(
              dateStr, timeStr, "America/New_York",
              li.variation_name || "", li.name, qty, "", "",
              mods, liGross, liDisc, liNet, liTax,
              payment.id, payment.id,
              "", "", "", "Payment", "INCREPEABLE",
              diningOption, "", "", "", "", "", "", "", "",
              "", cardBrand, "",
              feeDollars / (detail.lineItems.length), tipDollars / (detail.lineItems.length)
            );
            newItemsCount++;
          }
        } else {
          insertItem.run(
            dateStr, timeStr, "America/New_York",
            "", "Unknown Item", 1, "", "",
            "", grossDollars, 0, grossDollars, taxDollars,
            payment.id, payment.id,
            "", "", "", "Payment", "INCREPEABLE",
            diningOption, "", "", "", "", "", "", "", "",
            "", cardBrand, "",
            feeDollars, tipDollars
          );
          newItemsCount++;
        }

        newTransactionIds.push(payment.id);
      } catch (err) {
        console.warn(`[Square Sync] Step 1 error for payment ${payment.id}:`, err);
        errors++;
      }
    }
  });

  step1Insert();
  step1Db.close();
  console.log(`[Square Sync] Step 1 complete: ${newItemsCount} items written to squareup.db`);

  // ============================================================
  // STEP 2: Read from squareup.db → write to sales.db
  // ============================================================

  onProgress?.({
    phase: "syncing",
    current: 0,
    total: newTransactionIds.length,
    message: "Step 2: Writing to sales.db...",
  });

  const srcDb = new Database(SQUAREUP_DB_PATH, { readonly: true });
  const destDb = new Database(SALES_DB_PATH);

  // Ensure orders table exists
  destDb.exec(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT, time TEXT, platform TEXT, order_id TEXT,
    gross_sales REAL, tax REAL, total_fees REAL, net_sales REAL,
    order_status TEXT, items TEXT, item_count INTEGER, modifiers TEXT,
    tip REAL, discounts REAL, dining_option TEXT, customer_name TEXT,
    payment_method TEXT, commission_fee REAL, processing_fee REAL,
    delivery_fee REAL, marketing_fee REAL,
    fees_total REAL, marketing_total REAL, refunds_total REAL,
    adjustments_total REAL, other_total REAL
  )`);

  const insertOrder = destDb.prepare(`
    INSERT INTO orders (date, time, platform, order_id, gross_sales, tax, total_fees, net_sales,
      order_status, items, item_count, modifiers, tip, discounts, dining_option, customer_name,
      payment_method, commission_fee, processing_fee, delivery_fee, marketing_fee,
      fees_total, marketing_total, refunds_total, adjustments_total, other_total)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  let newOrders = 0;

  const step2Insert = destDb.transaction(() => {
    for (const txnId of newTransactionIds) {
      // Dedup in sales.db
      const existing = destDb.prepare("SELECT 1 FROM orders WHERE order_id = ? AND platform = 'square'").get(txnId);
      if (existing) continue;

      // Read aggregated order from squareup.db
      const order = srcDb.prepare(`
        SELECT
          MIN(date) as date,
          MIN(time) as time,
          GROUP_CONCAT(item || ' x' || CAST(CAST(CAST(qty AS REAL) AS INTEGER) AS TEXT), ' | ') as items,
          COUNT(*) as item_count,
          GROUP_CONCAT(CASE WHEN modifiers_applied != '' AND modifiers_applied IS NOT NULL THEN item || ': ' || modifiers_applied END, ' | ') as modifiers,
          ROUND(SUM(CAST(gross_sales AS REAL)), 2) as gross_sales,
          ROUND(SUM(CAST(discounts AS REAL)), 2) as discounts,
          ROUND(SUM(CAST(net_sales AS REAL)), 2) as net_sales,
          ROUND(SUM(CAST(tax AS REAL)), 2) as tax,
          ROUND(SUM(CAST(processing_fee AS REAL)), 2) as processing_fee,
          MAX(CAST(tip AS REAL)) as tip,
          MIN(dining_option) as dining_option,
          MIN(CASE WHEN customer_name != '' AND customer_name IS NOT NULL THEN customer_name END) as customer_name,
          MIN(CASE WHEN card_brand != '' AND card_brand IS NOT NULL THEN card_brand END) as payment_method,
          MIN(event_type) as event_type
        FROM items
        WHERE transaction_id = ?
      `).get(txnId) as Record<string, unknown> | undefined;

      if (!order || !order.date) continue;

      const gross = order.gross_sales as number || 0;
      const tax = order.tax as number || 0;
      const tip = order.tip as number || 0;
      const procFee = -(order.processing_fee as number || 0);
      const discounts = -(Math.abs(order.discounts as number || 0));
      const status = (order.event_type as string) === "Refund" ? "refund" : "completed";
      const refundsTotal = status === "refund" ? gross : 0;

      const feesTotal = procFee;
      const netSales = Math.round((gross + discounts + tax + tip + feesTotal) * 100) / 100;

      insertOrder.run(
        order.date, order.time, "square", txnId,
        gross, tax, feesTotal, netSales,
        status, order.items, order.item_count, order.modifiers,
        tip, discounts, order.dining_option || "", order.customer_name || "", order.payment_method || "",
        0, procFee, 0, 0,
        feesTotal, 0, refundsTotal, 0, 0
      );
      newOrders++;
    }
  });

  step2Insert();
  srcDb.close();
  destDb.close();
  console.log(`[Square Sync] Step 2 complete: ${newOrders} orders written to sales.db`);

  const result: SyncResult = {
    totalPayments: payments.length,
    newOrders,
    skippedDuplicates: payments.length - newTransactionIds.length,
    errors,
  };

  console.log("[Square Sync] Complete:", result);
  return result;
}

/**
 * Get the last sync date from squareup.db (most recent API item date).
 * Uses squareup.db as source of truth (Step 1), not sales.db.
 */
export function getLastSyncDate(): string | null {
  try {
    const db = new Database(SQUAREUP_DB_PATH, { readonly: true });
    const row = db.prepare("SELECT MAX(date) as last_date FROM items WHERE source = 'api'").get() as { last_date: string | null } | undefined;
    db.close();
    return row?.last_date || null;
  } catch {
    return null;
  }
}
