/**
 * Direct SQLite connection to sales.db
 * Reads from the unified `orders` table.
 */
import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "databases", "sales.db");

let _db: Database.Database | null = null;

export function getSalesDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH, { readonly: true });
  }
  return _db;
}

// ── Types ──────────────────────────────────────────────────────────────

export interface SalesRecord {
  id: number;
  date: string;
  time: string;
  platform: string;
  order_id: string;
  gross_sales: number;
  tax: number;
  total_fees: number;
  net_sales: number;
  order_status: string;
  items: string;
  item_count: number;
  modifiers: string;
  tip: number;
  discounts: number;
  dining_option: string;
  customer_name: string;
  payment_method: string;
  // Raw fee breakdown
  commission_fee: number;
  processing_fee: number;
  delivery_fee: number;
  marketing_fee: number;
  // Summary rollups
  fees_total: number;
  marketing_total: number;
  refunds_total: number;
  adjustments_total: number;
  other_total: number;
}

export interface SalesSummary {
  order_count: number;
  gross_sales: number;
  tax: number;
  tip: number;
  net_sales: number;
  // Raw fee breakdown
  commission_fee: number;
  processing_fee: number;
  delivery_fee: number;
  marketing_fee: number;
  // Summary rollups
  fees_total: number;
  marketing_total: number;
  refunds_total: number;
  adjustments_total: number;
  other_total: number;
  discounts: number;
}

// ── Query helpers ──────────────────────────────────────────────────────

interface QueryParams {
  platforms?: string[];
  types?: string[];
  statuses?: string[];
  startDate?: string;
  endDate?: string;
  search?: string;
  categories?: string[];
  sortBy?: string;
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

function buildQuery(p: QueryParams, mode: "rows" | "summary" | "count") {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  // Platform filter
  if (p.platforms && p.platforms.length > 0) {
    conditions.push(`platform IN (${p.platforms.map(() => "?").join(",")})`);
    params.push(...p.platforms);
  }

  // Date filter
  if (p.startDate) {
    conditions.push("date >= ?");
    params.push(p.startDate);
  }
  if (p.endDate) {
    conditions.push("date <= ?");
    params.push(p.endDate);
  }

  // Search
  if (p.search) {
    conditions.push("(items LIKE ? OR order_id LIKE ? OR customer_name LIKE ?)");
    params.push(`%${p.search}%`, `%${p.search}%`, `%${p.search}%`);
  }

  // Status filter (default: completed only)
  if (p.status && p.status.length > 0) {
    conditions.push(`order_status IN (${p.status.map(() => "?").join(",")})`);
    params.push(...p.status);
  }

  // Category filter — uses denormalized display_categories column on orders
  if (p.categories && p.categories.length > 0) {
    const catConds = p.categories.map(() => "(display_categories LIKE ? OR display_categories = ?)");
    conditions.push(`(${catConds.join(" OR ")})`);
    for (const cat of p.categories) {
      params.push(`%${cat}%`, cat);
    }
  }

  // Types filter — show orders where selected summary columns are non-zero
  // Valid types: fees_total, marketing_total, refunds_total, adjustments_total, other_total
  if (p.types && p.types.length > 0) {
    const validTypes = ["fees_total", "marketing_total", "refunds_total", "adjustments_total", "other_total", "completed", "cancelled", "unfulfilled"];
    const typeConds = p.types
      .filter((t) => validTypes.includes(t))
      .map((t) => {
        if (t === "completed") return `(order_status = 'completed')`;
        if (t === "refunds_total") return `((${t} IS NOT NULL AND ${t} != 0) OR order_status = 'refund')`;
        if (t === "cancelled") return `(order_status = 'cancelled')`;
        if (t === "unfulfilled") return `(order_status = 'unfulfilled')`;
        return `(${t} IS NOT NULL AND ${t} != 0)`;
      });
    if (typeConds.length > 0) {
      conditions.push(`(${typeConds.join(" OR ")})`);
    }
  }

  // Status filter — filter by order_status
  if (p.statuses && p.statuses.length > 0) {
    conditions.push(`order_status IN (${p.statuses.map(() => "?").join(",")})`);
    params.push(...p.statuses);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  if (mode === "count") {
    return { sql: `SELECT COUNT(*) as cnt FROM orders ${where}`, params };
  }

  if (mode === "summary") {
    return {
      sql: `SELECT
        COUNT(*) as order_count,
        ROUND(SUM(gross_sales), 2) as gross_sales,
        ROUND(SUM(tax), 2) as tax,
        ROUND(SUM(tip), 2) as tip,
        ROUND(SUM(net_sales), 2) as net_sales,
        ROUND(SUM(commission_fee), 2) as commission_fee,
        ROUND(SUM(processing_fee), 2) as processing_fee,
        ROUND(SUM(delivery_fee), 2) as delivery_fee,
        ROUND(SUM(marketing_fee), 2) as marketing_fee,
        ROUND(SUM(fees_total), 2) as fees_total,
        ROUND(SUM(marketing_total), 2) as marketing_total,
        ROUND(SUM(refunds_total), 2) as refunds_total,
        ROUND(SUM(adjustments_total), 2) as adjustments_total,
        ROUND(SUM(other_total), 2) as other_total,
        ROUND(SUM(discounts), 2) as discounts
      FROM orders ${where}`,
      params,
    };
  }

  // rows mode
  const validSorts: Record<string, string> = {
    date: "date",
    amount: "gross_sales",
    platform: "platform",
    net: "net_sales",
    fees: "fees_total",
  };
  const orderCol = validSorts[p.sortBy || ""] || "date";
  const dir = p.sortDir === "asc" ? "ASC" : "DESC";

  return {
    sql: `SELECT * FROM orders ${where} ORDER BY ${orderCol} ${dir}, time DESC LIMIT ? OFFSET ?`,
    params: [...params, p.limit || 100, p.offset || 0],
  };
}

export function querySales(p: QueryParams) {
  const db = getSalesDb();

  const rowsQuery = buildQuery(p, "rows");
  const countQuery = buildQuery(p, "count");
  const summaryQuery = buildQuery(p, "summary");

  const rows = db.prepare(rowsQuery.sql).all(...rowsQuery.params) as SalesRecord[];
  const countResult = db.prepare(countQuery.sql).get(...countQuery.params) as { cnt: number };
  const summaryResult = db.prepare(summaryQuery.sql).get(...summaryQuery.params) as SalesSummary;

  return {
    records: rows,
    total: countResult.cnt,
    summary: summaryResult,
  };
}

/**
 * Get platform-level summary broken down by platform
 */
export function queryPlatformBreakdown(p: Pick<QueryParams, "startDate" | "endDate">) {
  const db = getSalesDb();

  const platforms = ["square", "grubhub", "doordash", "ubereats"];
  const results: Record<string, SalesSummary> = {};

  for (const plat of platforms) {
    const q = buildQuery({ ...p, platforms: [plat] }, "summary");
    const r = db.prepare(q.sql).get(...q.params) as SalesSummary;
    results[plat] = r;
  }

  return results;
}
