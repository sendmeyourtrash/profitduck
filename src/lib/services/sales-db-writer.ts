/**
 * Writes parsed CSV/API data to:
 * 1. Vendor-specific SQLite DBs (databases/{platform}.db)
 * 2. Unified sales.db `orders` table
 * 3. bank.db for Rocket Money data
 *
 * Called from ingestion.ts after Prisma writes succeed.
 */

import Database from "better-sqlite3";
import path from "path";
import { ParseResult } from "../parsers/types";

const DB_DIR = path.join(process.cwd(), "databases");

function openDb(name: string): InstanceType<typeof Database> {
  return new Database(path.join(DB_DIR, name));
}

// ============================================================
// VENDOR DB WRITERS — raw data preservation
// ============================================================

function writeGrubhubDb(result: ParseResult) {
  const db = openDb("grubhub.db");

  // Ensure table exists
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

  const insert = db.prepare(`INSERT INTO orders (${getAllColumns("grubhub")}) VALUES (${getAllPlaceholders("grubhub")})`);

  const insertMany = db.transaction((orders: ParseResult["platformOrders"]) => {
    let inserted = 0;
    for (const order of orders) {
      if (order.platform !== "grubhub") continue;
      const raw = JSON.parse(order.rawData || "{}");
      // Check for duplicate by transaction_id
      const existing = db.prepare("SELECT 1 FROM orders WHERE transaction_id = ?").get(raw.transaction_id || raw["Transaction ID"] || "");
      if (existing) continue;

      // Insert raw CSV columns
      const norm = normalizeKeys(raw);
      const cols = getGrubhubColumns();
      const values = cols.map(c => norm[c] || "");
      insert.run(...values);
      inserted++;
    }
    return inserted;
  });

  const count = insertMany(result.platformOrders);
  db.close();
  return count;
}

function writeDoordashDb(result: ParseResult) {
  const db = openDb("doordash.db");

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
    subtotal_tax_remitted_by_doordash TEXT, payout_id TEXT, payout_status TEXT, payout_net REAL
  )`);

  const insertMany = db.transaction((orders: ParseResult["platformOrders"]) => {
    let inserted = 0;
    for (const order of orders) {
      if (order.platform !== "doordash") continue;
      const raw = JSON.parse(order.rawData || "{}");
      const norm = normalizeKeys(raw);
      const orderId = norm["doordash_order_id"] || norm["doordash order id"] || "";

      const existing = db.prepare("SELECT 1 FROM detailed_transactions WHERE doordash_order_id = ?").get(orderId);
      if (existing) continue;

      const cols = getDoordashColumns();
      const values = cols.map(c => norm[c] || "");
      db.prepare(`INSERT INTO detailed_transactions (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...values);
      inserted++;
    }
    return inserted;
  });

  const count = insertMany(result.platformOrders);
  db.close();
  return count;
}

function writeUberEatsDb(result: ParseResult) {
  const db = openDb("ubereats.db");

  db.exec(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT, date TEXT, customer TEXT, order_status TEXT,
    sales_excl_tax TEXT, tax TEXT, marketplace_fee TEXT,
    customer_refunds TEXT, order_charges TEXT, estimated_payout TEXT
  )`);

  const insertMany = db.transaction((orders: ParseResult["platformOrders"]) => {
    let inserted = 0;
    for (const order of orders) {
      if (order.platform !== "ubereats") continue;
      const raw = JSON.parse(order.rawData || "{}");
      const norm = normalizeKeys(raw);
      const orderId = norm["order_id"] || norm["order id"] || "";

      const existing = db.prepare("SELECT 1 FROM orders WHERE order_id = ?").get(orderId);
      if (existing) continue;

      db.prepare(`INSERT INTO orders (order_id, date, customer, order_status, sales_excl_tax, tax, marketplace_fee, customer_refunds, order_charges, estimated_payout) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        orderId,
        norm["date"] || "",
        norm["customer"] || "",
        norm["order_status"] || norm["order status"] || "",
        norm["sales_excl_tax"] || norm["sales (excl. tax)"] || "",
        norm["tax"] || "",
        norm["marketplace_fee"] || norm["marketplace fee"] || "",
        norm["customer_refunds"] || norm["customer refunds"] || "",
        norm["order_charges"] || norm["order charges"] || "",
        norm["estimated_payout"] || norm["estimated payout"] || ""
      );
      inserted++;
    }
    return inserted;
  });

  const count = insertMany(result.platformOrders);
  db.close();
  return count;
}

function writeRocketMoneyDb(result: ParseResult) {
  const db = openDb("rocketmoney.db");

  db.exec(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT, original_date TEXT, account_type TEXT, account_name TEXT,
    account_number TEXT, institution_name TEXT, name TEXT, custom_name TEXT,
    amount TEXT, description TEXT, category TEXT, note TEXT,
    ignored_from TEXT, tax_deductible TEXT, transaction_tags TEXT
  )`);

  const insertMany = db.transaction((bankTxns: ParseResult["bankTransactions"]) => {
    let inserted = 0;
    for (const bt of bankTxns) {
      const raw = JSON.parse(bt.rawData || "{}");
      const norm = normalizeKeys(raw);

      // Dedup by date + amount + description
      const existing = db.prepare("SELECT 1 FROM transactions WHERE date = ? AND amount = ? AND name = ?").get(
        norm["date"] || "", norm["amount"] || "", norm["name"] || ""
      );
      if (existing) continue;

      db.prepare(`INSERT INTO transactions (date, original_date, account_type, account_name, account_number, institution_name, name, custom_name, amount, description, category, note, ignored_from, tax_deductible, transaction_tags) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        norm["date"] || "",
        norm["original_date"] || norm["original date"] || "",
        norm["account_type"] || norm["account type"] || "",
        norm["account_name"] || norm["account name"] || "",
        norm["account_number"] || norm["account number"] || "",
        norm["institution_name"] || norm["institution name"] || "",
        norm["name"] || "",
        norm["custom_name"] || norm["custom name"] || "",
        norm["amount"] || "",
        norm["description"] || "",
        norm["category"] || "",
        norm["note"] || "",
        norm["ignored_from"] || norm["ignored from"] || "",
        norm["tax_deductible"] || norm["tax deductible"] || "",
        norm["transaction_tags"] || norm["transaction tags"] || ""
      );
      inserted++;
    }
    return inserted;
  });

  const count = insertMany(result.bankTransactions);
  db.close();
  return count;
}

// ============================================================
// UNIFIED SALES.DB WRITER — normalized orders table
// ============================================================

function writeSalesDbOrders(result: ParseResult) {
  const db = openDb("sales.db");

  // Ensure orders table exists
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

  const insert = db.prepare(`
    INSERT INTO orders (date, time, platform, order_id, gross_sales, tax, total_fees, net_sales,
      order_status, items, item_count, modifiers, tip, discounts, dining_option, customer_name,
      payment_method, commission_fee, processing_fee, delivery_fee, marketing_fee,
      fees_total, marketing_total, refunds_total, adjustments_total, other_total)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  const insertMany = db.transaction((orders: ParseResult["platformOrders"]) => {
    let inserted = 0;
    for (const order of orders) {
      // Skip Square — handled by square-sync.ts
      if (order.platform === "square") continue;

      // Dedup
      const existing = db.prepare("SELECT 1 FROM orders WHERE order_id = ? AND platform = ?").get(order.orderId, order.platform);
      if (existing) continue;

      const dateStr = order.orderDatetime.toISOString().slice(0, 10);
      const timeStr = order.orderDatetime.toISOString().slice(11, 19);
      const gross = order.subtotal || 0;
      const tax = order.tax || 0;
      const tip = order.tip || 0;

      // Fee breakdown
      const commissionFee = -(order.commissionFee || 0);
      const processingFee = -(order.serviceFee || 0);
      const deliveryFee = -(order.deliveryFee || 0);
      const marketingFee = -(order.marketingFees || 0);

      // Summary rollups
      const feesTotal = commissionFee + processingFee + deliveryFee;
      const marketingTotal = marketingFee;
      const refundsTotal = order.refunds ? -Math.abs(order.refunds) : 0;
      const adjustmentsTotal = order.adjustments || 0;
      const otherTotal = 0;

      const totalFees = feesTotal + marketingTotal + refundsTotal + adjustmentsTotal;
      const netSales = gross + tax + tip + feesTotal + marketingTotal + refundsTotal + adjustmentsTotal + otherTotal;

      // Dining option
      let diningOption = "";
      if (order.platform === "grubhub") {
        diningOption = order.fulfillmentType === "Pick-Up" ? "Pickup" : "Delivery";
      } else if (order.platform === "doordash") {
        diningOption = order.channel === "Storefront" ? "Storefront" : "Delivery";
      } else if (order.platform === "ubereats") {
        diningOption = "Delivery";
      }

      // Order status
      const raw = JSON.parse(order.rawData || "{}");
      const norm = normalizeKeys(raw);
      let status = "completed";
      if (order.platform === "grubhub") {
        const txnType = norm["transaction_type"] || norm["transaction type"] || "";
        if (txnType === "Cancellation") status = "cancelled";
        else if (txnType === "Order Adjustment") status = "adjustment";
        else if (txnType === "GH Credit") status = "credit";
        else if (txnType === "Miscellaneous") status = "other";
      } else if (order.platform === "doordash") {
        const txnType = norm["transaction_type"] || norm["transaction type"] || "";
        if (txnType !== "Order") status = txnType.toLowerCase().replace(/ /g, "_");
      } else if (order.platform === "ubereats") {
        const orderStatus = norm["order_status"] || norm["order status"] || "";
        if (orderStatus === "Cancelled") status = "cancelled";
        else if (orderStatus === "Unfulfilled") status = "unfulfilled";
      }

      insert.run(
        dateStr, timeStr, order.platform, order.orderId,
        gross, tax, totalFees, Math.round(netSales * 100) / 100,
        status, null, null, null,
        tip, order.discounts || 0, diningOption, null, null,
        commissionFee, processingFee, deliveryFee, marketingFee,
        feesTotal, marketingTotal, refundsTotal, adjustmentsTotal, otherTotal
      );
      inserted++;
    }
    return inserted;
  });

  const count = insertMany(result.platformOrders);
  db.close();
  return count;
}

// ============================================================
// BANK.DB WRITER — for Rocket Money
// ============================================================

function writeBankDb(result: ParseResult) {
  const db = openDb("bank.db");

  db.exec(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT, original_date TEXT, account_type TEXT, account_name TEXT,
    account_number TEXT, institution_name TEXT, name TEXT, custom_name TEXT,
    amount REAL, description TEXT, category TEXT, note TEXT,
    ignored_from TEXT, tax_deductible TEXT, transaction_tags TEXT,
    source TEXT
  )`);

  const insertMany = db.transaction((bankTxns: ParseResult["bankTransactions"]) => {
    let inserted = 0;
    for (const bt of bankTxns) {
      const raw = JSON.parse(bt.rawData || "{}");
      const norm = normalizeKeys(raw);

      const amount = parseFloat(norm["amount"] || "0") || 0;
      const existing = db.prepare(
        "SELECT 1 FROM transactions WHERE date = ? AND amount = ? AND name = ? AND source = 'rocketmoney'"
      ).get(norm["date"] || "", amount, norm["name"] || "");
      if (existing) continue;

      db.prepare(`INSERT INTO transactions (date, original_date, account_type, account_name, account_number, institution_name, name, custom_name, amount, description, category, note, ignored_from, tax_deductible, transaction_tags, source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        norm["date"] || "",
        norm["original_date"] || norm["original date"] || "",
        norm["account_type"] || norm["account type"] || "",
        norm["account_name"] || norm["account name"] || "",
        norm["account_number"] || norm["account number"] || "",
        norm["institution_name"] || norm["institution name"] || "",
        norm["name"] || "",
        norm["custom_name"] || norm["custom name"] || "",
        amount,
        norm["description"] || "",
        norm["category"] || "",
        norm["note"] || "",
        norm["ignored_from"] || norm["ignored from"] || "",
        norm["tax_deductible"] || norm["tax deductible"] || "",
        norm["transaction_tags"] || norm["transaction tags"] || "",
        "rocketmoney"
      );
      inserted++;
    }
    return inserted;
  });

  const count = insertMany(result.bankTransactions);
  db.close();
  return count;
}

// ============================================================
// MAIN ENTRY POINT — called from ingestion.ts
// ============================================================

export interface SalesDbWriteResult {
  vendorDb: number;
  salesDb: number;
  bankDb: number;
}

export function writeToSourceDatabases(
  sourcePlatform: string,
  result: ParseResult
): SalesDbWriteResult {
  const output: SalesDbWriteResult = { vendorDb: 0, salesDb: 0, bankDb: 0 };

  try {
    // Write to vendor-specific DB
    switch (sourcePlatform) {
      case "grubhub":
        output.vendorDb = writeGrubhubDb(result);
        break;
      case "doordash":
        output.vendorDb = writeDoordashDb(result);
        break;
      case "ubereats":
        output.vendorDb = writeUberEatsDb(result);
        break;
      case "rocketmoney":
        output.vendorDb = writeRocketMoneyDb(result);
        output.bankDb = writeBankDb(result);
        break;
      // Square handled by square-sync.ts, not CSV import
    }

    // Write to unified sales.db (for delivery platforms)
    if (["grubhub", "doordash", "ubereats"].includes(sourcePlatform)) {
      output.salesDb = writeSalesDbOrders(result);
    }
  } catch (err) {
    console.error(`[SalesDbWriter] Error writing to source databases:`, err);
  }

  console.log(`[SalesDbWriter] ${sourcePlatform}: vendor=${output.vendorDb}, sales=${output.salesDb}, bank=${output.bankDb}`);
  return output;
}

// ============================================================
// HELPERS
// ============================================================

function normalizeKeys(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    // Normalize to lowercase with underscores
    out[k.toLowerCase().trim().replace(/\s+/g, "_")] = v;
    // Also keep original lowercase with spaces for fallback
    out[k.toLowerCase().trim()] = v;
  }
  return out;
}

function getGrubhubColumns(): string[] {
  return [
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
}

function getDoordashColumns(): string[] {
  return [
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
    "subtotal_tax_remitted_by_doordash", "payout_id"
  ];
}

function getAllColumns(platform: string): string {
  if (platform === "grubhub") return getGrubhubColumns().join(", ");
  return "";
}

function getAllPlaceholders(platform: string): string {
  if (platform === "grubhub") return getGrubhubColumns().map(() => "?").join(", ");
  return "";
}
