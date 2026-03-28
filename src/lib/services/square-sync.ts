/**
 * Square API Sync Service
 * =======================
 *
 * Follows the 3-step pipeline:
 *
 *   Step 1: Square API → squareup.db (items table)
 *   Step 2: squareup.db → sales.db (orders + order_items)
 *   Step 3: Apply aliases (categories.db → sales.db order_items)
 *
 * All Square data comes exclusively from the API (no CSV).
 * Incremental syncs fetch new payments since the last sync date.
 * Full syncs fetch everything from the beginning.
 *
 * Step 2 and Step 3 use the shared pipeline functions from
 * pipeline-step2-unify.ts and pipeline-step3-aliases.ts — no duplicated logic.
 *
 * @see pipeline-step2-unify.ts — Step 2 implementation (shared)
 * @see pipeline-step3-aliases.ts — Step 3 implementation (shared)
 * @see PIPELINE.md — Full documentation
 */

import Database from "better-sqlite3";
import path from "path";
import {
  fetchAllPayments,
  batchRetrieveOrders,
  SquarePayment,
  SquareOrderData,
} from "./square-api";
import { unifySquare } from "./pipeline-step2-unify";
import { step3ApplyAliases } from "./pipeline-step3-aliases";
import { ProgressCallback } from "./progress";

const DB_DIR = path.join(process.cwd(), "databases");
const SQUAREUP_DB_PATH = path.join(DB_DIR, "squareup.db");

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

function getPaymentMethod(payment: SquarePayment): string {
  if (payment.source_type === "CASH") return "Cash";
  if (payment.source_type === "WALLET") return "Digital Wallet";
  if (payment.source_type === "EXTERNAL") return "External";
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
  enrichedOrders: number;
  errors: number;
}

/**
 * Sync Square payments following the 3-step pipeline.
 *
 * Step 1: API → squareup.db (items table, raw data with cleanup)
 * Step 2: squareup.db → sales.db (orders + order_items) — shared function
 * Step 3: Apply aliases (categories.db → sales.db order_items) — shared function
 */
export async function syncSquareFees(
  startDate?: string,
  endDate?: string,
  onProgress?: ProgressCallback,
  fullSync = false
): Promise<SyncResult> {
  const label = fullSync
    ? "Square Full Sync (all time)"
    : startDate
    ? `Square Sync (since ${new Date(startDate).toLocaleDateString()})`
    : "Square Sync (full)";
  console.log(`[Square Sync] ${label}`);

  // ============================================================
  // FETCH — Get payments + order details from Square API
  // ============================================================

  const fetchStart = fullSync ? undefined : startDate;
  const payments = await fetchAllPayments(fetchStart, endDate, onProgress);
  console.log(`[Square Sync] Fetched ${payments.length} payments`);

  // ============================================================
  // DEDUP: Find truly new payments not in squareup.db
  // ============================================================

  const sqDb2 = new Database(SQUAREUP_DB_PATH);
  const existingIds = new Set<string>(
    (sqDb2.prepare("SELECT DISTINCT transaction_id FROM items WHERE transaction_id != ''").all() as { transaction_id: string }[])
      .map((r) => r.transaction_id)
  );
  sqDb2.close();

  const newPayments = payments.filter((p) => !existingIds.has(p.id));
  console.log(`[Square Sync] ${newPayments.length} new payments (${existingIds.size} already in squareup.db)`);

  if (newPayments.length === 0) {
    return { totalPayments: payments.length, newOrders: 0, skippedDuplicates: payments.length, enrichedOrders: 0, errors: 0 };
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
  // Ensure modifiers_json column exists (migration for existing DBs)
  try { step1Db.exec("ALTER TABLE items ADD COLUMN modifiers_json TEXT"); } catch (e: any) {
    if (!e.message?.includes("duplicate column")) throw e;
  }

  const insertItem = step1Db.prepare(`
    INSERT INTO items (date, time, time_zone, category, item, qty, price_point_name, sku,
      modifiers_applied, modifiers_json, gross_sales, discounts, net_sales, tax, transaction_id, payment_id,
      device_name, notes, details, event_type, location, dining_option, customer_id, customer_name,
      customer_reference_id, unit, count, itemization_type, fulfillment_note, channel, token,
      card_brand, pan_suffix, processing_fee, tip, source, platform)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api', 'square')
  `);

  let newItemsCount = 0;
  let errors = 0;

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
        const paymentMethod = getPaymentMethod(payment);

        const realOrderId = paymentToOrderId.get(payment.id);
        const detail = realOrderId ? orderData.get(realOrderId) : undefined;
        const taxCents = detail?.totalTaxCents || 0;

        const grossDollars = (amountCents - taxCents) / 100;
        const taxDollars = taxCents / 100;
        const tipDollars = tipCents / 100;
        const feeDollars = feeCents / 100;

        const diningOption = detail?.diningOption || "";
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

            // Get modifiers — build both flat string and structured JSON
            const modifiers = (li.modifiers || []).filter((m: any) => m.name);
            const mods = modifiers.map((m: any) => m.name).join(", ");
            const modsJson = modifiers.length > 0
              ? JSON.stringify(modifiers.map((m: any) => ({
                  group: "",
                  name: m.name || "",
                  price: Math.round(((m.total_price_money?.amount || m.base_price_money?.amount || 0) / 100) * 100) / 100,
                })))
              : "";

            insertItem.run(
              dateStr, timeStr, "America/New_York",
              li.variation_name || "", li.name, qty, "", "",
              mods, modsJson, liGross, liDisc, liNet, liTax,
              payment.id, payment.id,
              "", "", "", "Payment", payment.location_id || "",
              diningOption, "", "", "", "", "", "", "", "",
              "", paymentMethod, "",
              feeDollars / (detail.lineItems.length), tipDollars / (detail.lineItems.length)
            );
            newItemsCount++;
          }
        } else {
          insertItem.run(
            dateStr, timeStr, "America/New_York",
            "", "Unknown Item", 1, "", "",
            "", "", grossDollars, 0, grossDollars, taxDollars,
            payment.id, payment.id,
            "", "", "", "Payment", payment.location_id || "",
            diningOption, "", "", "", "", "", "", "", "",
            "", paymentMethod, "",
            feeDollars, tipDollars
          );
          newItemsCount++;
        }
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
  // STEP 2: squareup.db → sales.db (orders + order_items)
  // Uses shared unifySquare() from pipeline-step2-unify.ts
  // ============================================================

  onProgress?.({
    phase: "syncing",
    current: 0,
    total: 0,
    message: "Step 2: Writing to sales.db (orders + order_items)...",
  });

  const step2Result = unifySquare();
  console.log(`[Square Sync] Step 2 complete: inserted=${step2Result.inserted}, skipped=${step2Result.skipped}`);

  // ============================================================
  // STEP 3: Apply aliases (categories.db → sales.db order_items)
  // Uses shared step3ApplyAliases() from pipeline-step3-aliases.ts
  // ============================================================

  onProgress?.({
    phase: "syncing",
    current: 0,
    total: 0,
    message: "Step 3: Applying aliases...",
  });

  const aliasResult = step3ApplyAliases();
  console.log(`[Square Sync] Step 3 complete: items=${aliasResult.itemAliasesApplied}, categories=${aliasResult.categoryAliasesApplied}`);

  // ============================================================
  // STEP 4: Sync catalog (categories + item mappings)
  // Only adds new categories/mappings — never overwrites manual work
  // ============================================================

  onProgress?.({
    phase: "syncing",
    current: 0,
    total: 0,
    message: "Step 4: Syncing catalog categories...",
  });

  try {
    const { syncSquareCatalog } = await import("./square-catalog-sync");
    const catalogResult = await syncSquareCatalog(onProgress);
    console.log(`[Square Sync] Step 4 complete: ${catalogResult.categoriesCreated} new categories, ${catalogResult.itemsMapped} new mappings`);

    // Re-run Step 3 if catalog added new mappings
    if (catalogResult.categoriesCreated > 0 || catalogResult.itemsMapped > 0) {
      step3ApplyAliases();
    }
  } catch (err) {
    // Non-fatal: catalog sync failure shouldn't break payment sync
    console.warn("[Square Sync] Step 4 catalog sync failed (non-fatal):", err);
  }

  const result: SyncResult = {
    totalPayments: payments.length,
    newOrders: step2Result.inserted,
    skippedDuplicates: payments.length - newPayments.length,
    enrichedOrders: 0,
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
    const row = db.prepare("SELECT MAX(date) as last_date FROM items").get() as { last_date: string | null } | undefined;
    db.close();
    return row?.last_date || null;
  } catch {
    return null;
  }
}
