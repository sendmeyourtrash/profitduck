/**
 * ============================================================
 * PIPELINE STEP 1: Source → Vendor DB (Raw + Cleanup)
 * ============================================================
 *
 * This is the FIRST step in the data pipeline. Raw data from
 * CSV files or API syncs is written to vendor-specific SQLite
 * databases with cleanup applied:
 *
 *   CSV/API  →  squareup.db
 *   CSV      →  grubhub.db
 *   CSV      →  doordash.db
 *   CSV      →  ubereats.db
 *   CSV      →  rocketmoney.db
 *
 * Cleanup operations:
 *   1. DEDUP — remove duplicate records within the same source
 *   2. DATE NORMALIZATION — all dates → YYYY-MM-DD format
 *   3. AMOUNT NORMALIZATION — consistent sign conventions
 *   4. STATUS FLAGS — completed / cancelled / refund / adjustment
 *   5. FILL MISSING DATA — API item details, etc.
 *
 * After Step 1 completes, Step 2 reads from vendor DBs and
 * writes to the unified sales.db / bank.db.
 *
 * @see pipeline-step2-unify.ts
 * @see PIPELINE.md
 */

import Database from "better-sqlite3";
import path from "path";

const DB_DIR = path.join(process.cwd(), "databases");

function openDb(name: string): InstanceType<typeof Database> {
  return new Database(path.join(DB_DIR, name));
}

// ============================================================
// DATE NORMALIZATION
// ============================================================

/**
 * Normalize any date format to YYYY-MM-DD.
 * Handles: YYYY-MM-DD, M/D/YYYY, MM/DD/YYYY, MM-DD-YYYY
 */
function normalizeDate(raw: string): string {
  if (!raw || raw.trim() === "") return "";
  const s = raw.trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // M/D/YYYY or MM/DD/YYYY
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[1].padStart(2, "0")}-${slashMatch[2].padStart(2, "0")}`;
  }

  // MM-DD-YYYY
  const dashMatch = s.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (dashMatch) {
    return `${dashMatch[3]}-${dashMatch[1]}-${dashMatch[2]}`;
  }

  // ISO datetime
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch {}

  return s; // Return as-is if unparseable
}

/**
 * Normalize time to HH:MM:SS format.
 */
function normalizeTime(raw: string): string {
  if (!raw || raw.trim() === "") return "";
  const s = raw.trim();

  // Already HH:MM:SS
  if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s;

  // HH:MM:SS with AM/PM
  const ampmMatch = s.match(/^(\d{1,2}):(\d{2}):?(\d{2})?\s*(AM|PM)/i);
  if (ampmMatch) {
    let h = parseInt(ampmMatch[1]);
    const m = ampmMatch[2];
    const sec = ampmMatch[3] || "00";
    const ampm = ampmMatch[4].toUpperCase();
    if (ampm === "PM" && h < 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return `${h.toString().padStart(2, "0")}:${m}:${sec}`;
  }

  // ISO datetime — extract time
  const isoMatch = s.match(/T(\d{2}:\d{2}:\d{2})/);
  if (isoMatch) return isoMatch[1];

  return s;
}

// ============================================================
// AMOUNT NORMALIZATION
// ============================================================

/**
 * Parse a string amount to a number, handling $, commas, parens for negatives.
 */
function parseAmount(raw: string): number {
  if (!raw || raw.trim() === "") return 0;
  let s = raw.trim().replace(/[$,]/g, "");

  // (123.45) = -123.45
  const parenMatch = s.match(/^\((.+)\)$/);
  if (parenMatch) s = "-" + parenMatch[1];

  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// ============================================================
// SQUAREUP INGEST
// ============================================================

export interface IngestResult {
  platform: string;
  inserted: number;
  skipped: number;
  cleaned: number;
  errors: string[];
}

/**
 * Ingest Square CSV rows into squareup.db.
 * Raw CSV columns preserved. Cleanup: dedup, date normalization.
 */
export function ingestSquareItems(rows: Record<string, string>[]): IngestResult {
  const db = openDb("squareup.db");
  const result: IngestResult = { platform: "squareup", inserted: 0, skipped: 0, cleaned: 0, errors: [] };

  db.exec(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT, time TEXT, time_zone TEXT, category TEXT, item TEXT, qty TEXT,
    price_point_name TEXT, sku TEXT, modifiers_applied TEXT,
    gross_sales TEXT, discounts TEXT, net_sales TEXT, tax TEXT,
    transaction_id TEXT, payment_id TEXT, device_name TEXT, notes TEXT,
    details TEXT, event_type TEXT, location TEXT, dining_option TEXT,
    customer_id TEXT, customer_name TEXT, customer_reference_id TEXT,
    unit TEXT, count TEXT, itemization_type TEXT, fulfillment_note TEXT,
    channel TEXT, token TEXT, card_brand TEXT, pan_suffix TEXT,
    processing_fee TEXT, tip TEXT, source TEXT DEFAULT 'csv', platform TEXT DEFAULT 'square'
  )`);

  const insertMany = db.transaction(() => {
    for (const raw of rows) {
      const norm = normalizeKeys(raw);
      const txnId = norm["transaction_id"] || norm["transaction id"] || "";
      const item = norm["item"] || "";
      const date = normalizeDate(norm["date"] || "");

      // Dedup by transaction_id + item + qty
      if (txnId) {
        const qty = norm["qty"] || "1";
        const existing = db.prepare(
          "SELECT 1 FROM items WHERE transaction_id = ? AND item = ? AND qty = ? AND date = ?"
        ).get(txnId, item, qty, date);
        if (existing) { result.skipped++; continue; }
      }

      // Date cleanup
      const cleanDate = date;
      const cleanTime = normalizeTime(norm["time"] || "");
      if (cleanDate !== (norm["date"] || "")) result.cleaned++;

      db.prepare(`INSERT INTO items (date, time, time_zone, category, item, qty,
        price_point_name, sku, modifiers_applied, gross_sales, discounts, net_sales, tax,
        transaction_id, payment_id, device_name, notes, details, event_type, location,
        dining_option, customer_id, customer_name, customer_reference_id, unit, count,
        itemization_type, fulfillment_note, channel, token, card_brand, pan_suffix,
        processing_fee, tip, source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'csv')`)
        .run(
          cleanDate, cleanTime,
          norm["time_zone"] || norm["time zone"] || "",
          norm["category"] || "",
          item,
          norm["qty"] || "1",
          norm["price_point_name"] || norm["price point name"] || "",
          norm["sku"] || "",
          norm["modifiers_applied"] || norm["modifiers applied"] || "",
          norm["gross_sales"] || norm["gross sales"] || "0",
          norm["discounts"] || "0",
          norm["net_sales"] || norm["net sales"] || "0",
          norm["tax"] || "0",
          txnId,
          norm["payment_id"] || norm["payment id"] || "",
          norm["device_name"] || norm["device name"] || "",
          norm["notes"] || "",
          norm["details"] || "",
          norm["event_type"] || norm["event type"] || "Payment",
          norm["location"] || "",
          norm["dining_option"] || norm["dining option"] || "",
          norm["customer_id"] || norm["customer id"] || "",
          norm["customer_name"] || norm["customer name"] || "",
          norm["customer_reference_id"] || norm["customer reference id"] || "",
          norm["unit"] || "",
          norm["count"] || "",
          norm["itemization_type"] || norm["itemization type"] || "",
          norm["fulfillment_note"] || norm["fulfillment note"] || "",
          norm["channel"] || "",
          norm["token"] || "",
          norm["card_brand"] || norm["card brand"] || "",
          norm["pan_suffix"] || norm["pan suffix"] || "",
          norm["processing_fee"] || norm["processing fee"] || "0",
          norm["tip"] || "0"
        );
      result.inserted++;
    }
  });

  insertMany();
  db.close();
  return result;
}

/**
 * Ingest GrubHub CSV rows into grubhub.db.
 * All raw columns preserved. Cleanup: dedup by transaction_id, normalize dates.
 */
export function ingestGrubhubOrders(rows: Record<string, string>[]): IngestResult {
  const db = openDb("grubhub.db");
  const result: IngestResult = { platform: "grubhub", inserted: 0, skipped: 0, cleaned: 0, errors: [] };

  db.exec(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_channel TEXT, order_number TEXT, order_date TEXT, order_time_local TEXT,
    order_day_of_week TEXT, order_hour_of_day TEXT, order_time_zone TEXT,
    transaction_date TEXT, transaction_time_local TEXT,
    grubhub_store_id TEXT, store_number TEXT, store_name TEXT,
    street_address TEXT, city TEXT, state TEXT, postal_code TEXT,
    transaction_type TEXT, fulfillment_type TEXT, gh_plus_customer TEXT,
    subtotal TEXT, subtotal_sales_tax TEXT, subtotal_sales_tax_exemption TEXT,
    self_delivery_charge TEXT, self_delivery_charge_tax TEXT, self_delivery_charge_tax_exemption TEXT,
    merchant_service_fee TEXT, merchant_service_fee_tax TEXT, merchant_service_fee_tax_exemption TEXT,
    merchant_flexible_fee_bag_fee TEXT, merchant_flexible_fee_bag_fee_tax TEXT, merchant_flexible_fee_bag_fee_tax_exemption TEXT,
    merchant_flexible_fee_pif_fee TEXT, merchant_flexible_fee_pif_fee_tax TEXT, merchant_flexible_fee_pif_fee_tax_exemption TEXT,
    tip TEXT, merchant_total TEXT, commission TEXT, delivery_commission TEXT,
    gh_plus_commission TEXT, processing_fee TEXT, withheld_tax TEXT, withheld_tax_exemption TEXT,
    merchant_funded_promotion TEXT, merchant_funded_loyalty TEXT,
    merchant_net_total TEXT, transaction_note TEXT, transaction_id TEXT
  )`);

  const cols = [
    "order_channel", "order_number", "order_date", "order_time_local",
    "order_day_of_week", "order_hour_of_day", "order_time_zone",
    "transaction_date", "transaction_time_local",
    "grubhub_store_id", "store_number", "store_name",
    "street_address", "city", "state", "postal_code",
    "transaction_type", "fulfillment_type", "gh_plus_customer",
    "subtotal", "subtotal_sales_tax", "subtotal_sales_tax_exemption",
    "self_delivery_charge", "self_delivery_charge_tax", "self_delivery_charge_tax_exemption",
    "merchant_service_fee", "merchant_service_fee_tax", "merchant_service_fee_tax_exemption",
    "merchant_flexible_fee_bag_fee", "merchant_flexible_fee_bag_fee_tax", "merchant_flexible_fee_bag_fee_tax_exemption",
    "merchant_flexible_fee_pif_fee", "merchant_flexible_fee_pif_fee_tax", "merchant_flexible_fee_pif_fee_tax_exemption",
    "tip", "merchant_total", "commission", "delivery_commission",
    "gh_plus_commission", "processing_fee", "withheld_tax", "withheld_tax_exemption",
    "merchant_funded_promotion", "merchant_funded_loyalty",
    "merchant_net_total", "transaction_note", "transaction_id"
  ];

  const insertMany = db.transaction(() => {
    for (const raw of rows) {
      const norm = normalizeKeys(raw);
      const txnId = norm["transaction_id"] || "";
      const orderNum = norm["order_number"] || "";

      // Dedup by transaction_id
      if (txnId) {
        const existing = db.prepare("SELECT 1 FROM orders WHERE transaction_id = ?").get(txnId);
        if (existing) { result.skipped++; continue; }
      }

      // Date cleanup
      const cleanOrderDate = normalizeDate(norm["order_date"] || "");
      const cleanTxnDate = normalizeDate(norm["transaction_date"] || "");
      if (cleanOrderDate !== (norm["order_date"] || "")) result.cleaned++;

      // Time cleanup: "02:55:57 PM" → "14:55:57"
      const cleanTime = (raw: string): string => {
        const m = raw.match(/^(\d{1,2}):(\d{2}):?(\d{2})?\s*(AM|PM)$/i);
        if (!m) return raw;
        let h = parseInt(m[1], 10);
        const isPM = m[4].toUpperCase() === "PM";
        if (isPM && h !== 12) h += 12;
        if (!isPM && h === 12) h = 0;
        return `${String(h).padStart(2, "0")}:${m[2]}:${m[3] || "00"}`;
      };

      const values = cols.map(c => {
        if (c === "order_date") return cleanOrderDate;
        if (c === "transaction_date") return cleanTxnDate;
        if (c === "order_time_local" || c === "transaction_time_local") return cleanTime(norm[c] || "");
        return norm[c] || "";
      });

      db.prepare(`INSERT INTO orders (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...values);
      result.inserted++;
    }
  });

  insertMany();
  db.close();
  return result;
}

/**
 * Ingest DoorDash CSV rows into doordash.db.
 * All raw columns preserved. Cleanup: dedup by doordash_order_id, normalize dates.
 */
export function ingestDoordashOrders(rows: Record<string, string>[]): IngestResult {
  const db = openDb("doordash.db");
  const result: IngestResult = { platform: "doordash", inserted: 0, skipped: 0, cleaned: 0, errors: [] };

  db.exec(`CREATE TABLE IF NOT EXISTS detailed_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp_utc_time TEXT, timestamp_utc_date TEXT, timestamp_local_time TEXT, timestamp_local_date TEXT,
    order_received_local_time TEXT, order_pickup_local_time TEXT, payout_time TEXT, payout_date TEXT,
    business_id TEXT, business_name TEXT, store_id TEXT, store_name TEXT, merchant_store_id TEXT,
    transaction_type TEXT, delivery_uuid TEXT, doordash_transaction_id TEXT, doordash_order_id TEXT,
    merchant_delivery_id TEXT, pos_order_id TEXT, channel TEXT, description TEXT, final_order_status TEXT,
    currency TEXT, subtotal TEXT, subtotal_tax_passed_to_merchant TEXT, commission TEXT,
    payment_processing_fee TEXT, tablet_fee TEXT, marketing_fees TEXT,
    customer_discounts_funded_by_you TEXT, customer_discounts_funded_by_doordash TEXT,
    customer_discounts_funded_by_third_party TEXT, doordash_marketing_credit TEXT,
    third_party_contribution TEXT, error_charges TEXT, adjustments TEXT, net_total TEXT,
    pre_adjusted_subtotal TEXT, pre_adjusted_tax_subtotal TEXT, subtotal_for_tax TEXT,
    subtotal_tax_remitted_by_doordash TEXT, payout_id TEXT,
    tip TEXT, customer_name TEXT, commission_rate TEXT, items_json TEXT, raw_json TEXT, source TEXT
  )`);

  // Add extension columns to existing tables (safe — SQLite ignores if already exists)
  for (const col of ["tip", "customer_name", "commission_rate", "items_json", "raw_json", "source"]) {
    try { db.exec(`ALTER TABLE detailed_transactions ADD COLUMN ${col} TEXT`); } catch {}
  }

  const cols = [
    "timestamp_utc_time", "timestamp_utc_date", "timestamp_local_time", "timestamp_local_date",
    "order_received_local_time", "order_pickup_local_time", "payout_time", "payout_date",
    "business_id", "business_name", "store_id", "store_name", "merchant_store_id",
    "transaction_type", "delivery_uuid", "doordash_transaction_id", "doordash_order_id",
    "merchant_delivery_id", "pos_order_id", "channel", "description", "final_order_status",
    "currency", "subtotal", "subtotal_tax_passed_to_merchant", "commission",
    "payment_processing_fee", "tablet_fee", "marketing_fees",
    "customer_discounts_funded_by_you", "customer_discounts_funded_by_doordash",
    "customer_discounts_funded_by_third_party", "doordash_marketing_credit",
    "third_party_contribution", "error_charges", "adjustments", "net_total",
    "pre_adjusted_subtotal", "pre_adjusted_tax_subtotal", "subtotal_for_tax",
    "subtotal_tax_remitted_by_doordash", "payout_id",
    "tip", "customer_name", "commission_rate", "items_json", "raw_json", "source"
  ];

  const insertMany = db.transaction(() => {
    for (const raw of rows) {
      const norm = normalizeKeys(raw);
      const orderId = norm["doordash_order_id"] || norm["doordash order id"] || "";

      // Dedup
      if (orderId) {
        const existing = db.prepare("SELECT 1 FROM detailed_transactions WHERE doordash_order_id = ?").get(orderId);
        if (existing) { result.skipped++; continue; }
      }

      // Date cleanup
      const cleanDate = normalizeDate(norm["timestamp_local_date"] || norm["timestamp local date"] || "");
      if (cleanDate !== (norm["timestamp_local_date"] || "")) result.cleaned++;

      // Extract time from "2026-03-11 10:51:14.991931" → "10:51:14"
      const extractTime = (raw: string): string => {
        const m = raw.match(/\d{4}-\d{2}-\d{2}\s+(\d{2}:\d{2}:\d{2})/);
        return m ? m[1] : raw;
      };

      const values = cols.map(c => {
        if (c === "timestamp_local_date") return cleanDate;
        if (c === "timestamp_utc_date") return normalizeDate(norm[c] || "");
        if (c === "payout_date") return normalizeDate(norm[c] || "");
        if (c === "timestamp_local_time" || c === "timestamp_utc_time") return extractTime(norm[c] || "");
        return norm[c] || "";
      });

      db.prepare(`INSERT INTO detailed_transactions (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...values);
      result.inserted++;
    }
  });

  insertMany();
  db.close();
  return result;
}

/**
 * Ingest Uber Eats CSV rows into ubereats.db.
 * All raw columns preserved. Cleanup: dedup by order_id, normalize dates from M/D/YYYY to YYYY-MM-DD.
 */
export function ingestUberEatsOrders(rows: Record<string, string>[]): IngestResult {
  const db = openDb("ubereats.db");
  const result: IngestResult = { platform: "ubereats", inserted: 0, skipped: 0, cleaned: 0, errors: [] };

  // Orders table — one row per order with financials
  db.exec(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT UNIQUE,
    order_uuid TEXT,
    date TEXT,
    time TEXT,
    timestamp_unix INTEGER,
    completed_at TEXT,
    customer TEXT,
    customer_uuid TEXT,
    customer_order_count INTEGER DEFAULT 0,
    order_status TEXT,
    fulfillment_type TEXT,
    sales_excl_tax REAL DEFAULT 0,
    tax REAL DEFAULT 0,
    marketplace_fee REAL DEFAULT 0,
    marketplace_fee_rate TEXT,
    customer_refunds REAL DEFAULT 0,
    order_charges REAL DEFAULT 0,
    estimated_payout REAL DEFAULT 0,
    raw_json TEXT,
    source TEXT DEFAULT 'extension',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Items table — one row per item per order (like Square's items table)
  db.exec(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT,
    item_uuid TEXT,
    item_name TEXT,
    quantity INTEGER DEFAULT 1,
    price REAL DEFAULT 0,
    modifiers TEXT,
    modifiers_json TEXT,
    special_instructions TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(order_id)
  )`);
  // Add modifiers_json column if upgrading from old schema
  try { db.exec("ALTER TABLE items ADD COLUMN modifiers_json TEXT"); } catch (_) {}

  // Indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ue_orders_date ON orders(date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ue_items_order ON items(order_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ue_items_name ON items(item_name)`);

  const insertMany = db.transaction(() => {
    for (const raw of rows) {
      const norm = normalizeKeys(raw);
      const orderId = norm["order_id"] || norm["order id"] || "";

      // Dedup by order_id
      if (orderId) {
        const existing = db.prepare("SELECT 1 FROM orders WHERE order_id = ?").get(orderId);
        if (existing) { result.skipped++; continue; }
      }

      // Date/time from extension GraphQL data
      const rawDate = norm["date"] || "";
      const cleanDate = normalizeDate(rawDate);
      if (cleanDate !== rawDate) result.cleaned++;

      // Parse amounts — strip $ and handle negatives
      const parseAmt = (v: string): number => {
        if (!v) return 0;
        const s = v.replace(/[$,]/g, "").trim();
        return parseFloat(s) || 0;
      };

      db.prepare(`INSERT INTO orders (
        order_id, order_uuid, date, time, timestamp_unix, completed_at,
        customer, customer_uuid, customer_order_count,
        order_status, fulfillment_type,
        sales_excl_tax, tax, marketplace_fee, marketplace_fee_rate,
        customer_refunds, order_charges, estimated_payout,
        raw_json, source
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        orderId,
        norm["order_uuid"] || "",
        cleanDate,
        norm["time"] || "",
        norm["timestamp_unix"] ? parseInt(norm["timestamp_unix"]) : null,
        norm["completed_at"] || "",
        norm["customer"] || "",
        norm["customer_uuid"] || "",
        norm["customer_order_count"] ? parseInt(norm["customer_order_count"]) : 0,
        norm["order_status"] || norm["order status"] || "",
        norm["fulfillment_type"] || "",
        parseAmt(norm["sales_excl_tax"] || norm["sales (excl. tax)"] || norm["sales_(excl._tax)"] || ""),
        parseAmt(norm["tax"] || ""),
        parseAmt(norm["marketplace_fee"] || norm["marketplace fee"] || ""),
        norm["marketplace_fee_rate"] || "",
        parseAmt(norm["customer_refunds"] || norm["customer refunds"] || ""),
        parseAmt(norm["order_charges"] || norm["order charges"] || ""),
        parseAmt(norm["estimated_payout"] || norm["estimated payout"] || ""),
        norm["raw_json"] || "",
        norm["source"] || "extension"
      );

      // Insert items if provided (JSON array from extension)
      const itemsJson = norm["items_json"] || "";
      if (itemsJson) {
        try {
          const items = JSON.parse(itemsJson);
          for (const item of items) {
            // Build modifiers string from customizations
            let modifiers = "";
            if (item.customizations && Array.isArray(item.customizations)) {
              modifiers = item.customizations
                .map((c: { name: string; options?: { name: string; price?: string }[] }) => {
                  const opts = (c.options || []).map((o: { name: string; price?: string }) =>
                    o.price ? `${o.name} (${o.price})` : o.name
                  ).join(", ");
                  return `${c.name}: ${opts}`;
                })
                .join("; ");
            }

            // Build structured modifiers JSON: [{group, name, price}]
            const modifiersJson: { group: string; name: string; price: number }[] = [];
            if (item.customizations && Array.isArray(item.customizations)) {
              for (const c of item.customizations) {
                for (const o of (c.options || [])) {
                  modifiersJson.push({
                    group: c.name || "",
                    name: o.name || "",
                    price: Math.round(parseAmt(o.price || "") * 100) / 100,
                  });
                }
              }
            }

            db.prepare(`INSERT INTO items (
              order_id, item_uuid, item_name, quantity, price, modifiers, modifiers_json, special_instructions
            ) VALUES (?,?,?,?,?,?,?,?)`).run(
              orderId,
              item.uuid || "",
              item.name || "",
              item.quantity || 1,
              parseAmt(item.price || ""),
              modifiers,
              modifiersJson.length > 0 ? JSON.stringify(modifiersJson) : "",
              item.specialInstructions || ""
            );
          }
        } catch (e) {
          result.errors.push(`Failed to parse items for order ${orderId}: ${e}`);
        }
      }

      result.inserted++;
    }
  });

  insertMany();
  db.close();
  return result;
}

/**
 * Ingest Rocket Money CSV rows into rocketmoney.db.
 * All raw columns preserved. Cleanup: dedup, normalize dates.
 */
export function ingestRocketMoneyTransactions(rows: Record<string, string>[]): IngestResult {
  const db = openDb("rocketmoney.db");
  const result: IngestResult = { platform: "rocketmoney", inserted: 0, skipped: 0, cleaned: 0, errors: [] };

  db.exec(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT, original_date TEXT, account_type TEXT, account_name TEXT,
    account_number TEXT, institution_name TEXT, name TEXT, custom_name TEXT,
    amount TEXT, description TEXT, category TEXT, note TEXT,
    ignored_from TEXT, tax_deductible TEXT, transaction_tags TEXT
  )`);

  const insertMany = db.transaction(() => {
    for (const raw of rows) {
      const norm = normalizeKeys(raw);
      const date = normalizeDate(norm["date"] || "");
      const name = norm["name"] || "";
      const amount = norm["amount"] || "";

      // Dedup by date + name + amount
      const existing = db.prepare("SELECT 1 FROM transactions WHERE date = ? AND name = ? AND amount = ?").get(date, name, amount);
      if (existing) { result.skipped++; continue; }

      db.prepare(`INSERT INTO transactions (date, original_date, account_type, account_name, account_number, institution_name, name, custom_name, amount, description, category, note, ignored_from, tax_deductible, transaction_tags) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        date,
        normalizeDate(norm["original_date"] || norm["original date"] || ""),
        norm["account_type"] || norm["account type"] || "",
        norm["account_name"] || norm["account name"] || "",
        norm["account_number"] || norm["account number"] || "",
        norm["institution_name"] || norm["institution name"] || "",
        name,
        norm["custom_name"] || norm["custom name"] || "",
        amount,
        norm["description"] || "",
        norm["category"] || "",
        norm["note"] || "",
        norm["ignored_from"] || norm["ignored from"] || "",
        norm["tax_deductible"] || norm["tax deductible"] || "",
        norm["transaction_tags"] || norm["transaction tags"] || ""
      );
      result.inserted++;
    }
  });

  insertMany();
  db.close();

  // Auto-detect unmatched vendors and add to vendor-aliases.db as "unmatched"
  if (result.inserted > 0) {
    try {
      const vaDb = new Database(path.join(process.cwd(), "databases", "vendor-aliases.db"));
      vaDb.pragma("journal_mode = WAL");

      // Ensure unmatched_vendors table exists
      vaDb.exec(`CREATE TABLE IF NOT EXISTS unmatched_vendors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raw_name TEXT UNIQUE,
        count INTEGER DEFAULT 1,
        first_seen TEXT,
        last_seen TEXT
      )`);

      // Get all existing alias patterns and ignored names
      const aliasPatterns = vaDb.prepare("SELECT pattern, match_type FROM vendor_aliases").all() as { pattern: string; match_type: string }[];
      const ignoredNames = new Set(
        (vaDb.prepare("SELECT vendor_name FROM vendor_ignores").all() as { vendor_name: string }[]).map((r) => r.vendor_name)
      );

      // Get unique vendor names from RM data
      const rmDb = openDb("rocketmoney.db");
      const vendorNames = rmDb.prepare(`
        SELECT CASE WHEN custom_name IS NOT NULL AND custom_name != '' THEN custom_name ELSE name END as raw_name,
               COUNT(*) as cnt, MIN(date) as first_seen, MAX(date) as last_seen
        FROM transactions
        WHERE name IS NOT NULL AND name != ''
        GROUP BY raw_name
      `).all() as { raw_name: string; cnt: number; first_seen: string; last_seen: string }[];
      rmDb.close();

      // Check which ones are unmatched
      const upsert = vaDb.prepare(`
        INSERT INTO unmatched_vendors (raw_name, count, first_seen, last_seen)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(raw_name) DO UPDATE SET
          count = excluded.count,
          last_seen = excluded.last_seen
      `);

      const addUnmatched = vaDb.transaction(() => {
        for (const v of vendorNames) {
          if (!v.raw_name || ignoredNames.has(v.raw_name)) continue;

          // Check if any alias matches
          let matched = false;
          for (const alias of aliasPatterns) {
            if (alias.match_type === "exact" && v.raw_name === alias.pattern) { matched = true; break; }
            if (alias.match_type === "starts_with" && v.raw_name.startsWith(alias.pattern)) { matched = true; break; }
            if (alias.match_type === "contains" && v.raw_name.includes(alias.pattern)) { matched = true; break; }
          }

          if (!matched) {
            upsert.run(v.raw_name, v.cnt, v.first_seen, v.last_seen);
          }
        }
      });
      addUnmatched();
      vaDb.close();
    } catch (e) {
      console.error("[Step 1] Failed to update unmatched vendors:", e);
    }
  }

  return result;
}

// ============================================================
// MAIN DISPATCHER
// ============================================================

/**
 * Step 1 dispatcher — routes raw CSV rows to the correct vendor DB.
 * Returns ingest results with counts.
 */
export function step1Ingest(platform: string, rows: Record<string, string>[]): IngestResult {
  switch (platform) {
    case "square":
      return ingestSquareItems(rows);
    case "grubhub":
      return ingestGrubhubOrders(rows);
    case "doordash":
      return ingestDoordashOrders(rows);
    case "ubereats":
      return ingestUberEatsOrders(rows);
    case "rocketmoney":
      return ingestRocketMoneyTransactions(rows);
    default:
      return { platform, inserted: 0, skipped: 0, cleaned: 0, errors: [`Unknown platform: ${platform}`] };
  }
}

// ============================================================
// HELPERS
// ============================================================

function normalizeKeys(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.toLowerCase().trim().replace(/\s+/g, "_")] = v;
    out[k.toLowerCase().trim()] = v;
  }
  return out;
}
