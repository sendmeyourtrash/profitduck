/**
 * Direct SQLite connection to sales.db
 * Reads from the unified `orders` table.
 *
 * Also owns all menu configuration tables:
 *   menu_item_aliases, menu_item_ignores, menu_category_aliases,
 *   menu_categories, menu_item_category_map,
 *   menu_modifier_aliases, menu_modifier_ignores
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

/**
 * Open a writable connection to sales.db.
 * Callers MUST close() this connection when done (use try/finally).
 */
export function getWritableSalesDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  return db;
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
  paymentMethod?: string;
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

  // Payment method filter
  if (p.paymentMethod) {
    conditions.push("payment_method = ?");
    params.push(p.paymentMethod);
  }

  // Smart search — supports amounts, ranges, dates, and text
  if (p.search) {
    const { parseSearch, buildSalesSearchSQL } = require("@/lib/utils/search-parser");
    const parsed = parseSearch(p.search);
    const searchSQL = buildSalesSearchSQL(parsed);
    if (searchSQL.conditions.length > 0) {
      conditions.push(`(${searchSQL.conditions.join(" AND ")})`);
      params.push(...searchSQL.params);
    }
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

// ══════════════════════════════════════════════════════════════════════
// Menu Configuration Tables
// All 7 menu tables live in sales.db alongside the order data they describe.
// Write operations open a fresh writable connection and close it when done.
// ══════════════════════════════════════════════════════════════════════

// ── Menu Item Aliases ──────────────────────────────────────────────────

export interface MenuItemAlias {
  id: string;
  pattern: string;
  match_type: string;
  display_name: string;
  created_at: string;
}

export interface MenuItemIgnore {
  id: string;
  item_name: string;
  created_at: string;
}

export function getAllMenuItemAliases(): MenuItemAlias[] {
  const db = getWritableSalesDb();
  try {
    return db.prepare("SELECT * FROM menu_item_aliases ORDER BY display_name").all() as MenuItemAlias[];
  } finally {
    db.close();
  }
}

export function createMenuItemAlias(id: string, pattern: string, matchType: string, displayName: string): void {
  const db = getWritableSalesDb();
  try {
    db.prepare(
      "INSERT INTO menu_item_aliases (id, pattern, match_type, display_name, created_at) VALUES (?,?,?,?,?)"
    ).run(id, pattern, matchType, displayName, new Date().toISOString());
  } finally {
    db.close();
  }
}

export function updateMenuItemAlias(id: string, updates: Partial<{ pattern: string; match_type: string; display_name: string }>): void {
  const db = getWritableSalesDb();
  try {
    const sets: string[] = [];
    const params: string[] = [];
    if (updates.pattern !== undefined) { sets.push("pattern = ?"); params.push(updates.pattern); }
    if (updates.match_type !== undefined) { sets.push("match_type = ?"); params.push(updates.match_type); }
    if (updates.display_name !== undefined) { sets.push("display_name = ?"); params.push(updates.display_name); }
    if (sets.length > 0) {
      params.push(id);
      db.prepare(`UPDATE menu_item_aliases SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    }
  } finally {
    db.close();
  }
}

export function deleteMenuItemAlias(id: string): void {
  const db = getWritableSalesDb();
  try {
    db.prepare("DELETE FROM menu_item_aliases WHERE id = ?").run(id);
  } finally {
    db.close();
  }
}

export function getAllMenuItemIgnores(): MenuItemIgnore[] {
  const db = getWritableSalesDb();
  try {
    return db.prepare("SELECT * FROM menu_item_ignores ORDER BY item_name").all() as MenuItemIgnore[];
  } finally {
    db.close();
  }
}

export function createMenuItemIgnore(id: string, itemName: string): void {
  const db = getWritableSalesDb();
  try {
    const existing = db.prepare("SELECT 1 FROM menu_item_ignores WHERE item_name = ?").get(itemName);
    if (!existing) {
      db.prepare(
        "INSERT INTO menu_item_ignores (id, item_name, created_at) VALUES (?,?,?)"
      ).run(id, itemName, new Date().toISOString());
    }
  } finally {
    db.close();
  }
}

export function deleteMenuItemIgnore(itemName: string): void {
  const db = getWritableSalesDb();
  try {
    db.prepare("DELETE FROM menu_item_ignores WHERE item_name = ?").run(itemName);
  } finally {
    db.close();
  }
}

// ── Menu Category Aliases ──────────────────────────────────────────────

export interface MenuCategoryAlias {
  id: string;
  pattern: string;
  match_type: string;
  display_name: string;
  created_at: string;
}

export function getAllMenuCategoryAliases(): MenuCategoryAlias[] {
  const db = getWritableSalesDb();
  try {
    return db.prepare("SELECT * FROM menu_category_aliases ORDER BY display_name").all() as MenuCategoryAlias[];
  } finally {
    db.close();
  }
}

export function createMenuCategoryAlias(id: string, pattern: string, matchType: string, displayName: string): void {
  const db = getWritableSalesDb();
  try {
    db.prepare(
      "INSERT INTO menu_category_aliases (id, pattern, match_type, display_name, created_at) VALUES (?,?,?,?,?)"
    ).run(id, pattern, matchType, displayName, new Date().toISOString());
  } finally {
    db.close();
  }
}

export function updateMenuCategoryAlias(id: string, updates: Partial<{ pattern: string; match_type: string; display_name: string }>): void {
  const db = getWritableSalesDb();
  try {
    const sets: string[] = [];
    const params: string[] = [];
    if (updates.pattern !== undefined) { sets.push("pattern = ?"); params.push(updates.pattern); }
    if (updates.match_type !== undefined) { sets.push("match_type = ?"); params.push(updates.match_type); }
    if (updates.display_name !== undefined) { sets.push("display_name = ?"); params.push(updates.display_name); }
    if (sets.length > 0) {
      params.push(id);
      db.prepare(`UPDATE menu_category_aliases SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    }
  } finally {
    db.close();
  }
}

export function deleteMenuCategoryAlias(id: string): void {
  const db = getWritableSalesDb();
  try {
    db.prepare("DELETE FROM menu_category_aliases WHERE id = ?").run(id);
  } finally {
    db.close();
  }
}

// ── Menu Categories ────────────────────────────────────────────────────

function ensureMenuCategoriesSchema(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS menu_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT,
    sort_order INTEGER DEFAULT 0,
    square_catalog_id TEXT,
    created_at TEXT
  )`);
  // Idempotent: add square_catalog_id column if missing (migration for existing DBs)
  const catCols = db.prepare("PRAGMA table_info(menu_categories)").all() as { name: string }[];
  if (!catCols.some(c => c.name === "square_catalog_id")) {
    db.exec("ALTER TABLE menu_categories ADD COLUMN square_catalog_id TEXT");
  }
  db.exec(`CREATE TABLE IF NOT EXISTS menu_item_category_map (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL UNIQUE,
    category_id TEXT NOT NULL,
    square_item_id TEXT,
    created_at TEXT
  )`);
  // Idempotent: add square_item_id column if missing
  const mapCols = db.prepare("PRAGMA table_info(menu_item_category_map)").all() as { name: string }[];
  if (!mapCols.some(c => c.name === "square_item_id")) {
    db.exec("ALTER TABLE menu_item_category_map ADD COLUMN square_item_id TEXT");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_micm_cat ON menu_item_category_map(category_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_micm_dn ON menu_item_category_map(display_name)");
}

export function getAllMenuCategories(): { id: string; name: string; color: string | null; sort_order: number; created_at: string }[] {
  const db = getWritableSalesDb();
  try {
    ensureMenuCategoriesSchema(db);
    return db.prepare("SELECT * FROM menu_categories ORDER BY sort_order, name").all() as {
      id: string; name: string; color: string | null; sort_order: number; created_at: string;
    }[];
  } finally {
    db.close();
  }
}

export function createMenuCategory(id: string, name: string, color?: string, sortOrder?: number): void {
  const db = getWritableSalesDb();
  try {
    ensureMenuCategoriesSchema(db);
    db.prepare("INSERT INTO menu_categories (id, name, color, sort_order, created_at) VALUES (?,?,?,?,?)").run(
      id, name, color || null, sortOrder ?? 0, new Date().toISOString()
    );
  } finally {
    db.close();
  }
}

export function updateMenuCategory(id: string, updates: { name?: string; color?: string; sort_order?: number }): void {
  const db = getWritableSalesDb();
  try {
    ensureMenuCategoriesSchema(db);
    const fields: string[] = [];
    const values: (string | number)[] = [];
    if (updates.name !== undefined) { fields.push("name = ?"); values.push(updates.name); }
    if (updates.color !== undefined) { fields.push("color = ?"); values.push(updates.color); }
    if (updates.sort_order !== undefined) { fields.push("sort_order = ?"); values.push(updates.sort_order); }
    if (fields.length === 0) return;
    values.push(id);
    db.prepare(`UPDATE menu_categories SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  } finally {
    db.close();
  }
}

export function deleteMenuCategory(id: string): void {
  const db = getWritableSalesDb();
  try {
    ensureMenuCategoriesSchema(db);
    db.transaction(() => {
      db.prepare("DELETE FROM menu_item_category_map WHERE category_id = ?").run(id);
      db.prepare("DELETE FROM menu_categories WHERE id = ?").run(id);
    })();
  } finally {
    db.close();
  }
}

// ── Menu Item Category Map ─────────────────────────────────────────────

export function getItemCategoryMappings(): { display_name: string; category_id: string; category_name: string }[] {
  const db = getWritableSalesDb();
  try {
    ensureMenuCategoriesSchema(db);
    return db.prepare(`
      SELECT m.display_name, m.category_id, c.name as category_name
      FROM menu_item_category_map m
      JOIN menu_categories c ON m.category_id = c.id
    `).all() as { display_name: string; category_id: string; category_name: string }[];
  } finally {
    db.close();
  }
}

export function assignItemToCategory(id: string, displayName: string, categoryId: string): void {
  const db = getWritableSalesDb();
  try {
    ensureMenuCategoriesSchema(db);
    const existing = db.prepare("SELECT id FROM menu_item_category_map WHERE display_name = ?").get(displayName) as { id: string } | undefined;
    if (existing) {
      db.prepare("UPDATE menu_item_category_map SET category_id = ? WHERE display_name = ?").run(categoryId, displayName);
    } else {
      db.prepare("INSERT INTO menu_item_category_map (id, display_name, category_id, created_at) VALUES (?,?,?,?)").run(
        id, displayName, categoryId, new Date().toISOString()
      );
    }
  } finally {
    db.close();
  }
}

export function unassignItem(displayName: string): void {
  const db = getWritableSalesDb();
  try {
    ensureMenuCategoriesSchema(db);
    db.prepare("DELETE FROM menu_item_category_map WHERE display_name = ?").run(displayName);
  } finally {
    db.close();
  }
}

export function bulkAssignItems(items: { id: string; displayName: string; categoryId: string }[]): void {
  const db = getWritableSalesDb();
  try {
    ensureMenuCategoriesSchema(db);
    db.transaction((batch: typeof items) => {
      for (const item of batch) {
        const existing = db.prepare("SELECT id FROM menu_item_category_map WHERE display_name = ?").get(item.displayName);
        if (existing) {
          db.prepare("UPDATE menu_item_category_map SET category_id = ? WHERE display_name = ?").run(item.categoryId, item.displayName);
        } else {
          db.prepare("INSERT INTO menu_item_category_map (id, display_name, category_id, created_at) VALUES (?,?,?,?)").run(
            item.id, item.displayName, item.categoryId, new Date().toISOString()
          );
        }
      }
    })(items);
  } finally {
    db.close();
  }
}

export function getCategoryBySquareCatalogId(squareCatalogId: string): {
  id: string; name: string; color: string | null; sort_order: number; square_catalog_id: string; created_at: string;
} | undefined {
  const db = getWritableSalesDb();
  try {
    ensureMenuCategoriesSchema(db);
    return db.prepare("SELECT * FROM menu_categories WHERE square_catalog_id = ?").get(squareCatalogId) as {
      id: string; name: string; color: string | null; sort_order: number; square_catalog_id: string; created_at: string;
    } | undefined;
  } finally {
    db.close();
  }
}

export function createMenuCategoryFromCatalog(id: string, name: string, squareCatalogId: string, sortOrder?: number): void {
  const db = getWritableSalesDb();
  try {
    ensureMenuCategoriesSchema(db);
    db.prepare("INSERT OR IGNORE INTO menu_categories (id, name, square_catalog_id, sort_order, created_at) VALUES (?,?,?,?,?)").run(
      id, name, squareCatalogId, sortOrder ?? 0, new Date().toISOString()
    );
  } finally {
    db.close();
  }
}

export function assignItemToCategoryFromCatalog(id: string, displayName: string, categoryId: string, squareItemId?: string): void {
  const db = getWritableSalesDb();
  try {
    ensureMenuCategoriesSchema(db);
    const existing = db.prepare("SELECT id FROM menu_item_category_map WHERE display_name = ?").get(displayName) as { id: string } | undefined;
    if (existing) {
      db.prepare("UPDATE menu_item_category_map SET category_id = ?, square_item_id = ? WHERE display_name = ?").run(categoryId, squareItemId || null, displayName);
    } else {
      db.prepare("INSERT INTO menu_item_category_map (id, display_name, category_id, square_item_id, created_at) VALUES (?,?,?,?,?)").run(
        id, displayName, categoryId, squareItemId || null, new Date().toISOString()
      );
    }
  } finally {
    db.close();
  }
}

// ── Menu Modifier Aliases ──────────────────────────────────────────────

function ensureMenuModifierAliasesTable(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS menu_modifier_aliases (
    id TEXT PRIMARY KEY,
    pattern TEXT NOT NULL,
    match_type TEXT NOT NULL DEFAULT 'exact',
    display_name TEXT NOT NULL,
    created_at TEXT
  )`);
}

export function getAllMenuModifierAliases(): { id: string; pattern: string; match_type: string; display_name: string; created_at: string }[] {
  const db = getWritableSalesDb();
  try {
    ensureMenuModifierAliasesTable(db);
    return db.prepare("SELECT * FROM menu_modifier_aliases ORDER BY display_name").all() as {
      id: string; pattern: string; match_type: string; display_name: string; created_at: string;
    }[];
  } finally {
    db.close();
  }
}

export function createMenuModifierAlias(id: string, pattern: string, matchType: string, displayName: string): void {
  const db = getWritableSalesDb();
  try {
    ensureMenuModifierAliasesTable(db);
    db.prepare("INSERT INTO menu_modifier_aliases (id, pattern, match_type, display_name, created_at) VALUES (?,?,?,?,?)").run(
      id, pattern, matchType, displayName, new Date().toISOString()
    );
  } finally {
    db.close();
  }
}

export function updateMenuModifierAlias(id: string, updates: { pattern?: string; match_type?: string; display_name?: string }): void {
  const db = getWritableSalesDb();
  try {
    ensureMenuModifierAliasesTable(db);
    const fields: string[] = [];
    const values: string[] = [];
    if (updates.pattern !== undefined) { fields.push("pattern = ?"); values.push(updates.pattern); }
    if (updates.match_type !== undefined) { fields.push("match_type = ?"); values.push(updates.match_type); }
    if (updates.display_name !== undefined) { fields.push("display_name = ?"); values.push(updates.display_name); }
    if (fields.length === 0) return;
    values.push(id);
    db.prepare(`UPDATE menu_modifier_aliases SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  } finally {
    db.close();
  }
}

export function deleteMenuModifierAlias(id: string): void {
  const db = getWritableSalesDb();
  try {
    ensureMenuModifierAliasesTable(db);
    db.prepare("DELETE FROM menu_modifier_aliases WHERE id = ?").run(id);
  } finally {
    db.close();
  }
}

// ── Menu Modifier Ignores ──────────────────────────────────────────────

function ensureMenuModifierIgnoresTable(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS menu_modifier_ignores (
    id TEXT PRIMARY KEY,
    modifier_name TEXT NOT NULL UNIQUE,
    created_at TEXT
  )`);
}

export function getAllMenuModifierIgnores(): { id: string; modifier_name: string; created_at: string }[] {
  const db = getWritableSalesDb();
  try {
    ensureMenuModifierIgnoresTable(db);
    return db.prepare("SELECT * FROM menu_modifier_ignores ORDER BY modifier_name").all() as {
      id: string; modifier_name: string; created_at: string;
    }[];
  } finally {
    db.close();
  }
}

export function createMenuModifierIgnore(id: string, modifierName: string): void {
  const db = getWritableSalesDb();
  try {
    ensureMenuModifierIgnoresTable(db);
    const existing = db.prepare("SELECT 1 FROM menu_modifier_ignores WHERE modifier_name = ?").get(modifierName);
    if (!existing) {
      db.prepare("INSERT INTO menu_modifier_ignores (id, modifier_name, created_at) VALUES (?,?,?)").run(
        id, modifierName, new Date().toISOString()
      );
    }
  } finally {
    db.close();
  }
}

export function deleteMenuModifierIgnore(modifierName: string): void {
  const db = getWritableSalesDb();
  try {
    ensureMenuModifierIgnoresTable(db);
    db.prepare("DELETE FROM menu_modifier_ignores WHERE modifier_name = ?").run(modifierName);
  } finally {
    db.close();
  }
}
