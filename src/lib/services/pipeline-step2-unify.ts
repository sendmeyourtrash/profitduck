/**
 * ============================================================
 * PIPELINE STEP 2: Vendor DB → Unified DB (Normalize)
 * ============================================================
 *
 * This is the SECOND step in the data pipeline. It reads clean
 * data from vendor-specific SQLite databases and writes normalized
 * records to the unified databases:
 *
 *   squareup.db  →  sales.db (orders table)
 *   grubhub.db   →  sales.db (orders table)
 *   doordash.db  →  sales.db (orders table)
 *   ubereats.db  →  sales.db (orders table)
 *   rocketmoney.db → bank.db (rocketmoney table)
 *
 * Normalization operations:
 *   1. MAP to unified schema (orders table columns)
 *   2. CALCULATE summary rollups (fees_total, marketing_total, etc.)
 *   3. DEDUP across sources (by order_id + platform)
 *   4. CONSISTENT SIGNS — all fees/deductions are negative
 *
 * This step can be re-run at any time to rebuild the unified
 * databases from the vendor DBs. Useful when cleanup rules change.
 *
 * @see pipeline-step1-ingest.ts
 * @see PIPELINE.md
 */

import Database from "better-sqlite3";
import path from "path";

const DB_DIR = path.join(process.cwd(), "databases");

function openDb(name: string, readonly = false): InstanceType<typeof Database> {
  return new Database(path.join(DB_DIR, name), { readonly });
}

function parseAmount(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === "number") return raw;
  const s = raw.toString().trim().replace(/[$,]/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

export interface UnifyResult {
  platform: string;
  inserted: number;
  skipped: number;
  errors: string[];
}

// ============================================================
// ENSURE UNIFIED TABLES EXIST
// ============================================================

function ensureSalesDbSchema(db: InstanceType<typeof Database>) {
  db.exec(`CREATE TABLE IF NOT EXISTS orders (
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
}

function ensureBankDbSchema(db: InstanceType<typeof Database>) {
  db.exec(`CREATE TABLE IF NOT EXISTS rocketmoney (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT, original_date TEXT, account_type TEXT, account_name TEXT,
    account_number TEXT, institution_name TEXT, name TEXT, custom_name TEXT,
    amount TEXT, description TEXT, category TEXT, note TEXT,
    ignored_from TEXT, tax_deductible TEXT, transaction_tags TEXT,
    source TEXT DEFAULT 'rocketmoney'
  )`);
}

// ============================================================
// SQUARE → sales.db
// ============================================================

/**
 * Read squareup.db items, aggregate by transaction_id, write to sales.db orders.
 * Square items are item-level → must GROUP BY transaction_id to get order-level.
 */
export function unifySquare(): UnifyResult {
  const src = openDb("squareup.db", true);
  const dest = openDb("sales.db");
  ensureSalesDbSchema(dest);
  const result: UnifyResult = { platform: "square", inserted: 0, skipped: 0, errors: [] };

  // Get all unique transaction_ids from squareup.db
  const orders = src.prepare(`
    SELECT
      transaction_id,
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
    WHERE transaction_id != '' AND transaction_id IS NOT NULL
    GROUP BY transaction_id
  `).all() as Record<string, unknown>[];

  const insert = dest.prepare(`
    INSERT INTO orders (date, time, platform, order_id, gross_sales, tax, total_fees, net_sales,
      order_status, items, item_count, modifiers, tip, discounts, dining_option, customer_name,
      payment_method, commission_fee, processing_fee, delivery_fee, marketing_fee,
      fees_total, marketing_total, refunds_total, adjustments_total, other_total)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  const insertMany = dest.transaction(() => {
    for (const o of orders) {
      const orderId = o.transaction_id as string;

      // Dedup
      const existing = dest.prepare("SELECT 1 FROM orders WHERE order_id = ? AND platform = 'square'").get(orderId);
      if (existing) { result.skipped++; continue; }

      const gross = o.gross_sales as number;
      const tax = o.tax as number;
      const tip = o.tip as number || 0;
      const procFee = -(o.processing_fee as number || 0);
      const discounts = -(Math.abs(o.discounts as number || 0));
      const status = (o.event_type as string) === "Refund" ? "refund" : "completed";
      const refundsTotal = status === "refund" ? gross : 0;

      const feesTotal = procFee;
      const netSales = Math.round((gross + discounts + tax + tip + feesTotal) * 100) / 100;

      insert.run(
        o.date, o.time, "square", orderId,
        gross, tax, feesTotal, netSales,
        status, o.items, o.item_count, o.modifiers,
        tip, discounts, o.dining_option || "", o.customer_name || "", o.payment_method || "",
        0, procFee, 0, 0,
        feesTotal, 0, refundsTotal, 0, 0
      );
      result.inserted++;
    }
  });

  insertMany();
  src.close();
  dest.close();
  return result;
}

// ============================================================
// GRUBHUB → sales.db
// ============================================================

export function unifyGrubhub(): UnifyResult {
  const src = openDb("grubhub.db", true);
  const dest = openDb("sales.db");
  ensureSalesDbSchema(dest);
  const result: UnifyResult = { platform: "grubhub", inserted: 0, skipped: 0, errors: [] };

  const rows = src.prepare("SELECT * FROM orders").all() as Record<string, unknown>[];

  const insert = dest.prepare(`
    INSERT INTO orders (date, time, platform, order_id, gross_sales, tax, total_fees, net_sales,
      order_status, items, item_count, modifiers, tip, discounts, dining_option, customer_name,
      payment_method, commission_fee, processing_fee, delivery_fee, marketing_fee,
      fees_total, marketing_total, refunds_total, adjustments_total, other_total)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  const insertMany = dest.transaction(() => {
    for (const r of rows) {
      const orderId = (r.transaction_id as string) || "";
      if (!orderId) continue;

      // Dedup
      const existing = dest.prepare("SELECT 1 FROM orders WHERE order_id = ? AND platform = 'grubhub'").get(orderId);
      if (existing) { result.skipped++; continue; }

      const gross = parseAmount(r.subtotal as string);
      const tax = parseAmount(r.subtotal_sales_tax as string);
      const tip = parseAmount(r.tip as string);
      const net = parseAmount(r.merchant_net_total as string);

      // Fee breakdown (stored as negative in GrubHub CSV)
      const commFee = parseAmount(r.commission as string);
      const delComm = parseAmount(r.delivery_commission as string);
      const ghPlusComm = parseAmount(r.gh_plus_commission as string);
      const procFee = parseAmount(r.processing_fee as string);
      const promo = parseAmount(r.merchant_funded_promotion as string);
      const loyalty = parseAmount(r.merchant_funded_loyalty as string);

      // Normalize: make all fees negative
      const commissionFee = -Math.abs(commFee);
      const deliveryFee = -Math.abs(delComm + ghPlusComm);
      const processingFee = -Math.abs(procFee);
      const marketingFee = 0;

      const feesTotal = commissionFee + deliveryFee + processingFee;
      let marketingTotal = -(Math.abs(promo) + Math.abs(loyalty));

      // Status
      const txnType = (r.transaction_type as string) || "";
      let status = "completed";
      if (txnType === "Cancellation") status = "cancelled";
      else if (txnType === "Order Adjustment") status = "adjustment";
      else if (txnType === "GH Credit") status = "credit";
      else if (txnType === "Miscellaneous") status = "other";

      const refundsTotal = status === "cancelled" ? -Math.abs(gross) : 0;
      let adjustmentsTotal = (status === "adjustment") ? net : 0;

      // GrubHub Ads charges (Miscellaneous) and credits (GH Credit) → marketing
      if (status === "other") {
        marketingTotal = net; // negative ad charges
      } else if (status === "credit") {
        marketingTotal = net; // positive ad refunds
      }

      // Dining option
      const fulfill = (r.fulfillment_type as string) || "";
      const diningOption = fulfill === "Pick-Up" ? "Pickup" : fulfill === "Grubhub Delivery" ? "Delivery" : fulfill;

      const totalFees = feesTotal + marketingTotal;

      // Time already normalized in Step 1 (AM/PM → 24h)
      insert.run(
        r.order_date, r.order_time_local, "grubhub", orderId,
        gross, tax, totalFees, net,
        status, null, null, null,
        tip, 0, diningOption, null, null,
        commissionFee, processingFee, deliveryFee, marketingFee,
        feesTotal, marketingTotal, refundsTotal, adjustmentsTotal, 0
      );
      result.inserted++;
    }
  });

  insertMany();
  src.close();
  dest.close();
  return result;
}

// ============================================================
// DOORDASH → sales.db
// ============================================================

export function unifyDoordash(): UnifyResult {
  const src = openDb("doordash.db", true);
  const dest = openDb("sales.db");
  ensureSalesDbSchema(dest);
  const result: UnifyResult = { platform: "doordash", inserted: 0, skipped: 0, errors: [] };

  const rows = src.prepare("SELECT * FROM detailed_transactions").all() as Record<string, unknown>[];

  const insert = dest.prepare(`
    INSERT INTO orders (date, time, platform, order_id, gross_sales, tax, total_fees, net_sales,
      order_status, items, item_count, modifiers, tip, discounts, dining_option, customer_name,
      payment_method, commission_fee, processing_fee, delivery_fee, marketing_fee,
      fees_total, marketing_total, refunds_total, adjustments_total, other_total)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  const insertMany = dest.transaction(() => {
    for (const r of rows) {
      const orderId = (r.doordash_order_id as string) || "";
      if (!orderId) continue;

      const existing = dest.prepare("SELECT 1 FROM orders WHERE order_id = ? AND platform = 'doordash'").get(orderId);
      if (existing) { result.skipped++; continue; }

      const gross = parseAmount(r.subtotal as string);
      const tax = parseAmount(r.subtotal_tax_passed_to_merchant as string);
      const net = parseAmount(r.net_total as string);

      const comm = parseAmount(r.commission as string);
      const proc = parseAmount(r.payment_processing_fee as string);
      const tablet = parseAmount(r.tablet_fee as string);
      const mktg = parseAmount(r.marketing_fees as string);
      const discYou = parseAmount(r.customer_discounts_funded_by_you as string);
      const ddCredit = parseAmount(r.doordash_marketing_credit as string);
      const errors = parseAmount(r.error_charges as string);
      const adj = parseAmount(r.adjustments as string);

      // Normalize fees (negative)
      const commissionFee = -Math.abs(comm);
      const processingFee = -Math.abs(proc + tablet);
      const marketingFee = -Math.abs(mktg);

      const feesTotal = commissionFee + processingFee;
      const marketingTotal = marketingFee + (discYou < 0 ? discYou : -Math.abs(discYou)) + ddCredit;
      const adjustmentsTotal = errors + adj;

      const totalFees = feesTotal + marketingTotal + adjustmentsTotal;

      const txnType = (r.transaction_type as string) || "";
      const status = txnType === "Order" ? "completed" : txnType.toLowerCase().replace(/ /g, "_");
      const channel = (r.channel as string) || "";
      const diningOption = channel === "Storefront" ? "Storefront" : "Delivery";

      insert.run(
        r.timestamp_local_date, r.timestamp_local_time, "doordash", orderId,
        gross, tax, totalFees, net,
        status, null, null, null,
        0, 0, diningOption, null, null,
        commissionFee, processingFee, 0, marketingFee,
        feesTotal, marketingTotal, 0, adjustmentsTotal, 0
      );
      result.inserted++;
    }
  });

  insertMany();
  src.close();
  dest.close();
  return result;
}

// ============================================================
// UBER EATS → sales.db
// ============================================================

export function unifyUberEats(): UnifyResult {
  const src = openDb("ubereats.db", true);
  const dest = openDb("sales.db");
  ensureSalesDbSchema(dest);
  const result: UnifyResult = { platform: "ubereats", inserted: 0, skipped: 0, errors: [] };

  const rows = src.prepare("SELECT * FROM orders").all() as Record<string, unknown>[];

  const insert = dest.prepare(`
    INSERT INTO orders (date, time, platform, order_id, gross_sales, tax, total_fees, net_sales,
      order_status, items, item_count, modifiers, tip, discounts, dining_option, customer_name,
      payment_method, commission_fee, processing_fee, delivery_fee, marketing_fee,
      fees_total, marketing_total, refunds_total, adjustments_total, other_total)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  const insertMany = dest.transaction(() => {
    for (const r of rows) {
      const orderId = (r.order_id as string) || "";
      if (!orderId) continue;

      const existing = dest.prepare("SELECT 1 FROM orders WHERE order_id = ? AND platform = 'ubereats'").get(orderId);
      if (existing) { result.skipped++; continue; }

      const gross = parseAmount(r.sales_excl_tax as string);
      const tax = parseAmount(r.tax as string);
      const mktFee = parseAmount(r.marketplace_fee as string);
      const refunds = parseAmount(r.customer_refunds as string);
      const charges = parseAmount(r.order_charges as string);
      const payout = parseAmount(r.estimated_payout as string);

      const commissionFee = mktFee < 0 ? mktFee : -Math.abs(mktFee);
      // order_charges is a platform fee (~21.8% commission), not an adjustment
      const chargesFee = charges < 0 ? charges : (charges > 0 ? -charges : 0);
      const feesTotal = commissionFee + chargesFee;
      const refundsTotal = refunds < 0 ? refunds : (refunds > 0 ? -refunds : 0);

      const totalFees = feesTotal + refundsTotal;

      const statusRaw = (r.order_status as string) || "";
      let status = "completed";
      if (statusRaw === "Cancelled") status = "cancelled";
      else if (statusRaw === "Unfulfilled") status = "unfulfilled";

      insert.run(
        r.date, null, "ubereats", orderId,
        gross, tax, totalFees, payout,
        status, null, null, null,
        0, 0, "Delivery", r.customer || null, null,
        commissionFee + chargesFee, 0, 0, 0,
        feesTotal, 0, refundsTotal, 0, 0
      );
      result.inserted++;
    }
  });

  insertMany();
  src.close();
  dest.close();
  return result;
}

// ============================================================
// ROCKET MONEY → bank.db
// ============================================================

export function unifyRocketMoney(): UnifyResult {
  const src = openDb("rocketmoney.db", true);
  const dest = openDb("bank.db");
  ensureBankDbSchema(dest);
  const result: UnifyResult = { platform: "rocketmoney", inserted: 0, skipped: 0, errors: [] };

  const rows = src.prepare("SELECT * FROM transactions").all() as Record<string, unknown>[];

  const insertMany = dest.transaction(() => {
    for (const r of rows) {
      const date = (r.date as string) || "";
      const name = (r.name as string) || "";
      const amount = (r.amount as string) || "";

      const existing = dest.prepare("SELECT 1 FROM rocketmoney WHERE date = ? AND name = ? AND amount = ?").get(date, name, amount);
      if (existing) { result.skipped++; continue; }

      dest.prepare(`INSERT INTO rocketmoney (date, original_date, account_type, account_name, account_number, institution_name, name, custom_name, amount, description, category, note, ignored_from, tax_deductible, transaction_tags) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        date, r.original_date || "", r.account_type || "", r.account_name || "",
        r.account_number || "", r.institution_name || "", name, r.custom_name || "",
        amount, r.description || "", r.category || "", r.note || "",
        r.ignored_from || "", r.tax_deductible || "", r.transaction_tags || ""
      );
      result.inserted++;
    }
  });

  insertMany();
  src.close();
  dest.close();
  return result;
}

// ============================================================
// MAIN DISPATCHERS
// ============================================================

/**
 * Step 2 for a single platform — read from vendor DB, write to unified DB.
 */
export function step2Unify(platform: string): UnifyResult {
  switch (platform) {
    case "square": return unifySquare();
    case "grubhub": return unifyGrubhub();
    case "doordash": return unifyDoordash();
    case "ubereats": return unifyUberEats();
    case "rocketmoney": return unifyRocketMoney();
    default:
      return { platform, inserted: 0, skipped: 0, errors: [`Unknown platform: ${platform}`] };
  }
}

/**
 * Step 2 for ALL platforms — rebuild unified DBs from scratch.
 * Clears existing data in sales.db and bank.db, then re-populates.
 */
export function step2UnifyAll(rebuild = false): UnifyResult[] {
  if (rebuild) {
    // Clear unified tables
    const salesDb = openDb("sales.db");
    salesDb.exec("DELETE FROM orders");
    salesDb.close();

    const bankDb = openDb("bank.db");
    bankDb.exec("DELETE FROM rocketmoney");
    bankDb.close();
  }

  const results: UnifyResult[] = [];
  for (const platform of ["square", "grubhub", "doordash", "ubereats", "rocketmoney"]) {
    const r = step2Unify(platform);
    results.push(r);
    console.log(`[Step2] ${platform}: inserted=${r.inserted}, skipped=${r.skipped}`);
  }
  return results;
}
