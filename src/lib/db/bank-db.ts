/**
 * Bank DB Query Layer
 * ===================
 *
 * Reads from databases/bank.db (Rocket Money + Chase statements).
 * Powers the Bank Activity page.
 *
 * Also owns vendor_aliases, vendor_ignores, unmatched_vendors,
 * expense_categories, categorization_rules, and category_ignores tables
 * which now live in bank.db alongside the transaction tables.
 *
 * @see PIPELINE.md for database architecture
 */

import Database from "better-sqlite3";
import path from "path";

function getDb() {
  const db = new Database(path.join(process.cwd(), "databases", "bank.db"));
  ensureTransactionsTable(db);
  ensureDisplayVendorColumn(db);
  return db;
}

export function ensureTransactionsTable(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT, original_date TEXT, account_type TEXT, account_name TEXT DEFAULT 'Manual Entry',
    account_number TEXT, institution_name TEXT, name TEXT, custom_name TEXT,
    amount REAL, description TEXT, category TEXT, note TEXT,
    ignored_from TEXT, tax_deductible TEXT, transaction_tags TEXT,
    source TEXT,
    display_vendor TEXT,
    display_category TEXT
  )`);
  // View that reads from unified transactions table
  db.exec(`DROP VIEW IF EXISTS all_bank_transactions`);
  db.exec(`CREATE VIEW all_bank_transactions AS SELECT * FROM transactions`);

  // Vendor alias and expense category tables
  db.exec(`CREATE TABLE IF NOT EXISTS vendor_aliases (
    id TEXT PRIMARY KEY,
    pattern TEXT NOT NULL,
    match_type TEXT NOT NULL DEFAULT 'exact',
    display_name TEXT NOT NULL,
    auto_created INTEGER DEFAULT 0,
    created_at TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS vendor_ignores (
    id TEXT PRIMARY KEY,
    vendor_name TEXT NOT NULL UNIQUE,
    created_at TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS unmatched_vendors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_name TEXT NOT NULL UNIQUE,
    count INTEGER DEFAULT 1,
    first_seen TEXT,
    last_seen TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS expense_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT,
    color TEXT,
    icon TEXT,
    created_at TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS categorization_rules (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    pattern TEXT NOT NULL,
    category_id TEXT,
    priority INTEGER DEFAULT 5,
    created_from TEXT,
    hit_count INTEGER DEFAULT 0,
    created_at TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS category_ignores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_name TEXT NOT NULL UNIQUE,
    created_at TEXT
  )`);
}

/** @deprecated Use ensureTransactionsTable instead */
export function ensureManualEntriesTable(db: Database.Database) {
  ensureTransactionsTable(db);
}

// ── Vendor alias resolution (internal — uses open db connection) ──

interface VendorAliasInternal {
  pattern: string;
  match_type: string;
  display_name: string;
}

let cachedAliases: VendorAliasInternal[] | null = null;

function getVendorAliases(): VendorAliasInternal[] {
  if (cachedAliases) return cachedAliases;
  const db = getDb();
  try {
    cachedAliases = db.prepare("SELECT pattern, match_type, display_name FROM vendor_aliases").all() as VendorAliasInternal[];
    return cachedAliases;
  } finally {
    db.close();
  }
}

// ── Exported CRUD types ──

export interface VendorAlias {
  id: string;
  pattern: string;
  match_type: string;
  display_name: string;
  auto_created: number;
  created_at: string;
}

export interface VendorIgnore {
  id: string;
  vendor_name: string;
  created_at: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  icon: string | null;
  created_at: string;
}

export interface CategorizationRule {
  id: string;
  type: string;
  pattern: string;
  category_id: string | null;
  priority: number;
  created_from: string | null;
  hit_count: number;
  created_at: string;
}

export interface CategoryIgnore {
  id: number;
  category_name: string;
  created_at: string;
}

// ── Vendor Aliases CRUD ──

export function getAllVendorAliases(): VendorAlias[] {
  const db = getDb();
  try {
    return db.prepare("SELECT * FROM vendor_aliases ORDER BY display_name").all() as VendorAlias[];
  } finally {
    db.close();
  }
}

export function createVendorAlias(id: string, pattern: string, matchType: string, displayName: string, autoCreated = false): void {
  const db = getDb();
  try {
    db.prepare(
      "INSERT INTO vendor_aliases (id, pattern, match_type, display_name, auto_created, created_at) VALUES (?,?,?,?,?,?)"
    ).run(id, pattern, matchType, displayName, autoCreated ? 1 : 0, new Date().toISOString());
  } finally {
    db.close();
  }
}

export function updateVendorAlias(id: string, updates: Partial<{ pattern: string; match_type: string; display_name: string }>): void {
  const db = getDb();
  try {
    const sets: string[] = [];
    const params: string[] = [];
    if (updates.pattern !== undefined) { sets.push("pattern = ?"); params.push(updates.pattern); }
    if (updates.match_type !== undefined) { sets.push("match_type = ?"); params.push(updates.match_type); }
    if (updates.display_name !== undefined) { sets.push("display_name = ?"); params.push(updates.display_name); }
    if (sets.length > 0) {
      params.push(id);
      db.prepare(`UPDATE vendor_aliases SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    }
  } finally {
    db.close();
  }
}

export function deleteVendorAlias(id: string): void {
  const db = getDb();
  try {
    db.prepare("DELETE FROM vendor_aliases WHERE id = ?").run(id);
  } finally {
    db.close();
  }
}

// ── Vendor Ignores CRUD ──

export function getAllVendorIgnores(): VendorIgnore[] {
  const db = getDb();
  try {
    return db.prepare("SELECT * FROM vendor_ignores ORDER BY vendor_name").all() as VendorIgnore[];
  } finally {
    db.close();
  }
}

export function createVendorIgnore(id: string, vendorName: string): void {
  const db = getDb();
  try {
    const existing = db.prepare("SELECT 1 FROM vendor_ignores WHERE vendor_name = ?").get(vendorName);
    if (!existing) {
      db.prepare(
        "INSERT INTO vendor_ignores (id, vendor_name, created_at) VALUES (?,?,?)"
      ).run(id, vendorName, new Date().toISOString());
    }
  } finally {
    db.close();
  }
}

export function deleteVendorIgnore(vendorName: string): void {
  const db = getDb();
  try {
    db.prepare("DELETE FROM vendor_ignores WHERE vendor_name = ?").run(vendorName);
  } finally {
    db.close();
  }
}

// ── Expense Categories CRUD ──

export function getAllExpenseCategories(): ExpenseCategory[] {
  const db = getDb();
  try {
    return db.prepare("SELECT * FROM expense_categories ORDER BY name").all() as ExpenseCategory[];
  } finally {
    db.close();
  }
}

const AUTO_COLORS = [
  "#8b5cf6", "#22c55e", "#3b82f6", "#06b6d4", "#ec4899", "#f59e0b",
  "#6366f1", "#f97316", "#f43f5e", "#14b8a6", "#10b981", "#a855f7",
  "#0ea5e9", "#d946ef", "#84cc16", "#e11d48", "#0891b2", "#7c3aed",
];

export function createExpenseCategory(id: string, name: string, color?: string, icon?: string, parentId?: string): void {
  const db = getDb();
  try {
    // Auto-assign a distinct color if none provided
    let assignedColor = color;
    if (!assignedColor) {
      const usedColors = new Set(
        (db.prepare("SELECT color FROM expense_categories WHERE color IS NOT NULL").all() as { color: string }[]).map(r => r.color)
      );
      assignedColor = AUTO_COLORS.find(c => !usedColors.has(c)) || AUTO_COLORS[Math.floor(Math.random() * AUTO_COLORS.length)];
    }
    db.prepare(
      "INSERT INTO expense_categories (id, name, parent_id, color, icon, created_at) VALUES (?,?,?,?,?,?)"
    ).run(id, name, parentId || null, assignedColor, icon || null, new Date().toISOString());
  } finally {
    db.close();
  }
}

export function updateExpenseCategory(id: string, updates: Partial<{ name: string; color: string; icon: string }>): void {
  const db = getDb();
  try {
    const sets: string[] = [];
    const params: string[] = [];
    if (updates.name !== undefined) { sets.push("name = ?"); params.push(updates.name); }
    if (updates.color !== undefined) { sets.push("color = ?"); params.push(updates.color); }
    if (updates.icon !== undefined) { sets.push("icon = ?"); params.push(updates.icon); }
    if (sets.length > 0) {
      params.push(id);
      db.prepare(`UPDATE expense_categories SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    }
  } finally {
    db.close();
  }
}

export function deleteExpenseCategory(id: string): void {
  const db = getDb();
  try {
    db.transaction(() => {
      db.prepare("DELETE FROM expense_categories WHERE id = ?").run(id);
      db.prepare("DELETE FROM categorization_rules WHERE category_id = ?").run(id);
    })();
  } finally {
    db.close();
  }
}

// ── Categorization Rules CRUD ──

export function getAllCategorizationRules(): CategorizationRule[] {
  const db = getDb();
  try {
    return db.prepare("SELECT * FROM categorization_rules ORDER BY priority DESC, pattern").all() as CategorizationRule[];
  } finally {
    db.close();
  }
}

export function createCategorizationRule(id: string, type: string, pattern: string, categoryId: string, priority = 5, createdFrom = "manual"): void {
  const db = getDb();
  try {
    db.prepare(
      "INSERT INTO categorization_rules (id, type, pattern, category_id, priority, created_from, hit_count, created_at) VALUES (?,?,?,?,?,?,0,?)"
    ).run(id, type, pattern, categoryId, priority, createdFrom, new Date().toISOString());
  } finally {
    db.close();
  }
}

export function updateCategorizationRule(id: string, updates: Partial<{ type: string; pattern: string; category_id: string }>): void {
  const db = getDb();
  try {
    const sets: string[] = [];
    const params: string[] = [];
    if (updates.type !== undefined) { sets.push("type = ?"); params.push(updates.type); }
    if (updates.pattern !== undefined) { sets.push("pattern = ?"); params.push(updates.pattern); }
    if (updates.category_id !== undefined) { sets.push("category_id = ?"); params.push(updates.category_id); }
    if (sets.length > 0) {
      params.push(id);
      db.prepare(`UPDATE categorization_rules SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    }
  } finally {
    db.close();
  }
}

export function deleteCategorizationRule(id: string): void {
  const db = getDb();
  try {
    db.prepare("DELETE FROM categorization_rules WHERE id = ?").run(id);
  } finally {
    db.close();
  }
}

// ── Category Ignores CRUD ──

export function getAllCategoryIgnores(): CategoryIgnore[] {
  const db = getDb();
  try {
    return db.prepare("SELECT * FROM category_ignores ORDER BY category_name").all() as CategoryIgnore[];
  } finally {
    db.close();
  }
}

export function createCategoryIgnore(categoryName: string): void {
  const db = getDb();
  try {
    const existing = db.prepare("SELECT 1 FROM category_ignores WHERE category_name = ?").get(categoryName);
    if (!existing) {
      db.prepare(
        "INSERT INTO category_ignores (category_name, created_at) VALUES (?,?)"
      ).run(categoryName, new Date().toISOString());
    }
  } finally {
    db.close();
  }
}

export function deleteCategoryIgnore(categoryName: string): void {
  const db = getDb();
  try {
    db.prepare("DELETE FROM category_ignores WHERE category_name = ?").run(categoryName);
  } finally {
    db.close();
  }
}

function resolveVendorAlias(description: string): string | null {
  if (!description) return null;
  const aliases = getVendorAliases();
  const descLower = description.toLowerCase();
  for (const alias of aliases) {
    const patternLower = alias.pattern.toLowerCase();
    if (alias.match_type === "exact" && descLower === patternLower) {
      return alias.display_name;
    }
    if (alias.match_type === "starts_with" && descLower.startsWith(patternLower)) {
      return alias.display_name;
    }
    if (alias.match_type === "contains" && descLower.includes(patternLower)) {
      return alias.display_name;
    }
  }
  return null;
}

/** Resolve vendor alias, trying multiple fields */
export function resolveVendorFromRecord(name: string, customName: string, description: string): string {
  // Try custom_name first (user override), then name, then description
  const fields = [customName, name, description].filter(Boolean);
  for (const field of fields) {
    const alias = resolveVendorAlias(field);
    if (alias) return alias;
  }
  // Return the best raw name
  return customName || name || description || "";
}

/** Clear cached aliases (call when aliases are updated in Settings) */
export function clearVendorAliasCache() {
  cachedAliases = null;
}

/**
 * Idempotent migration: ensures display_vendor and display_category columns exist on transactions.
 * Creates indexes and populates all rows with NULL display_vendor.
 */
function ensureDisplayVendorColumn(db: Database.Database) {
  const txCols = db.prepare("PRAGMA table_info(transactions)").all() as { name: string }[];
  let needsRebuild = false;
  if (!txCols.some((c) => c.name === "display_vendor")) {
    db.exec("ALTER TABLE transactions ADD COLUMN display_vendor TEXT");
    needsRebuild = true;
  }
  if (!txCols.some((c) => c.name === "display_category")) {
    db.exec("ALTER TABLE transactions ADD COLUMN display_category TEXT");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_tx_display_vendor ON transactions(display_vendor)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tx_source ON transactions(source)");

  // Only rebuild on first migration (when column was just added) or if any rows are NULL
  if (needsRebuild) {
    rebuildDisplayVendors(db);
  } else {
    const nullCount = (db.prepare("SELECT COUNT(*) as cnt FROM transactions WHERE display_vendor IS NULL").get() as { cnt: number }).cnt;
    if (nullCount > 0) {
      rebuildDisplayVendors(db);
    }
  }
}

/**
 * Rebuild the materialized display_vendor column for all transactions rows.
 * Pass an existing db connection (e.g. during migration) or omit to open+close one internally.
 */
export function rebuildDisplayVendors(externalDb?: Database.Database) {
  // Clear alias cache so we pick up the latest vendor_aliases from bank.db
  cachedAliases = null;

  const db = externalDb || new Database(path.join(process.cwd(), "databases", "bank.db"));
  const shouldClose = !externalDb;
  try {
    const rows = db
      .prepare("SELECT id, name, custom_name, description FROM transactions")
      .all() as { id: number; name: string; custom_name: string; description: string }[];
    const update = db.prepare("UPDATE transactions SET display_vendor = ? WHERE id = ?");

    db.transaction(() => {
      for (const row of rows) {
        update.run(resolveVendorFromRecord(row.name, row.custom_name, row.description), row.id);
      }
    })();

    console.log(`[Bank DB] Rebuilt display_vendor for ${rows.length} transactions rows`);
  } finally {
    if (shouldClose) db.close();
  }
}

/** Resolve a vendor display name to its expense category name (or null if uncategorized) */
export function resolveVendorCategory(displayName: string): string | null {
  try {
    const rules = getAllCategorizationRules();
    const cats = getAllExpenseCategories();
    const catMap = new Map(cats.map((c) => [c.id, c.name]));
    for (const rule of rules) {
      if (rule.type === "vendor_match" && rule.pattern.toLowerCase() === displayName.toLowerCase()) {
        return catMap.get(rule.category_id || "") || null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── Account label mapping ──
const ACCOUNT_LABELS: Record<string, string> = {
  "BUS COMPLETE CHK": "Business Checking",
  "A. ORDUKHANOV": "Chase Ink",
};

// ── Types ──

interface BankRecord {
  id: number;
  date: string;
  original_date: string;
  account_type: string;
  account_name: string;
  account_number: string;
  institution_name: string;
  name: string;
  custom_name: string;
  amount: number;
  description: string;
  category: string;
  note: string;
  ignored_from: string;
  tax_deductible: string;
  transaction_tags: string;
  source: string;
  // Enriched
  display_account: string;
}

interface BankSummary {
  total_records: number;
  total_deposits: number;
  deposits_count: number;
  total_expenses: number;
  expenses_count: number;
  net: number;
}

interface QueryParams {
  startDate?: string;
  endDate?: string;
  accounts?: string[];
  categories?: string[];
  vendors?: string[];
  search?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

// ── Query builder ──

function buildQuery(p: QueryParams, mode: "rows" | "summary" | "count") {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  // Date filter
  if (p.startDate) {
    conditions.push("date >= ?");
    params.push(p.startDate);
  }
  if (p.endDate) {
    conditions.push("date <= ?");
    params.push(p.endDate);
  }

  // Account filter (by raw account_name)
  if (p.accounts && p.accounts.length > 0) {
    // Map display labels back to raw names
    const rawNames = p.accounts.map((a) => {
      const entry = Object.entries(ACCOUNT_LABELS).find(([, v]) => v === a);
      return entry ? entry[0] : a;
    });
    conditions.push(`account_name IN (${rawNames.map(() => "?").join(",")})`);
    params.push(...rawNames);
  }

  // Category filter — resolve through vendor alias → categorization rule pipeline
  if (p.categories && p.categories.length > 0) {
    const wantsUncategorized = p.categories.includes("Uncategorized");
    const namedCategories = p.categories.filter((c) => c !== "Uncategorized");

    try {
      const rules = getAllCategorizationRules();
      const expCats = getAllExpenseCategories();
      const aliases = getVendorAliases();

      // Build SQL conditions for ALL categorized vendors (used for Uncategorized exclusion)
      const allCategorizedVendors = rules
        .filter((r) => r.type === "vendor_match")
        .map((r) => r.pattern);

      const buildVendorConds = (vendorNames: string[]) => {
        const conds: string[] = [];
        for (const vendorName of vendorNames) {
          const matchingAliases = aliases.filter((a) => a.display_name.toLowerCase() === vendorName.toLowerCase());
          if (matchingAliases.length > 0) {
            for (const alias of matchingAliases) {
              if (alias.match_type === "exact") {
                conds.push("(name = ? OR custom_name = ?)");
                params.push(alias.pattern, alias.pattern);
              } else if (alias.match_type === "starts_with") {
                conds.push("(name LIKE ? OR custom_name LIKE ?)");
                params.push(`${alias.pattern}%`, `${alias.pattern}%`);
              } else if (alias.match_type === "contains") {
                conds.push("(name LIKE ? OR custom_name LIKE ?)");
                params.push(`%${alias.pattern}%`, `%${alias.pattern}%`);
              }
            }
          } else {
            conds.push("(name = ? OR custom_name = ?)");
            params.push(vendorName, vendorName);
          }
        }
        return conds;
      };

      const orParts: string[] = [];

      // Named categories
      if (namedCategories.length > 0) {
        const selectedCatIds = new Set(
          expCats.filter((c) => namedCategories.includes(c.name)).map((c) => c.id)
        );
        const matchingVendors = rules
          .filter((r) => r.type === "vendor_match" && selectedCatIds.has(r.category_id))
          .map((r) => r.pattern);

        if (matchingVendors.length > 0) {
          const vendorConds = buildVendorConds(matchingVendors);
          if (vendorConds.length > 0) {
            orParts.push(`(${vendorConds.join(" OR ")})`);
          }
        }
      }

      // Uncategorized — exclude all categorized vendors
      if (wantsUncategorized && allCategorizedVendors.length > 0) {
        const excludeConds = buildVendorConds(allCategorizedVendors);
        if (excludeConds.length > 0) {
          orParts.push(`NOT (${excludeConds.join(" OR ")})`);
        }
      } else if (wantsUncategorized) {
        orParts.push("1=1"); // No categorized vendors → everything is uncategorized
      }

      if (orParts.length > 0) {
        conditions.push(`(${orParts.join(" OR ")})`);
      } else if (!wantsUncategorized) {
        conditions.push("1=0");
      }
    } catch {
      // Fallback to raw RM category
      conditions.push(`category IN (${p.categories.map(() => "?").join(",")})`);
      params.push(...p.categories);
    }
  }

  // Vendor filter — map display names back to SQL patterns via aliases
  if (p.vendors && p.vendors.length > 0) {
    const aliases = getVendorAliases();
    const vendorConds: string[] = [];
    for (const vendorName of p.vendors) {
      // Find all alias patterns that map to this display name
      const matching = aliases.filter((a) => a.display_name === vendorName);
      if (matching.length > 0) {
        for (const alias of matching) {
          if (alias.match_type === "exact") {
            vendorConds.push("(name = ? OR custom_name = ?)");
            params.push(alias.pattern, alias.pattern);
          } else if (alias.match_type === "starts_with") {
            vendorConds.push("(name LIKE ? OR custom_name LIKE ?)");
            params.push(`${alias.pattern}%`, `${alias.pattern}%`);
          } else if (alias.match_type === "contains") {
            vendorConds.push("(name LIKE ? OR custom_name LIKE ?)");
            params.push(`%${alias.pattern}%`, `%${alias.pattern}%`);
          }
        }
      } else {
        // No alias — match raw name directly
        vendorConds.push("(name = ? OR custom_name = ? OR name LIKE ?)");
        params.push(vendorName, vendorName, `%${vendorName}%`);
      }
    }
    if (vendorConds.length > 0) {
      conditions.push(`(${vendorConds.join(" OR ")})`);
    }
  }

  // Smart search — supports amounts, ranges, dates, and text
  if (p.search) {
    const { parseSearch, buildBankSearchSQL } = require("@/lib/utils/search-parser");
    const parsed = parseSearch(p.search);
    const searchSQL = buildBankSearchSQL(parsed);
    if (searchSQL.conditions.length > 0) {
      conditions.push(`(${searchSQL.conditions.join(" AND ")})`);
      params.push(...searchSQL.params);
    }
  }

  // NOTE: Ignored categories are no longer excluded from queries.
  // Instead, the API tags each transaction with `ignored: true` and excludes
  // them from summary totals. This lets the frontend show them greyed out.

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  if (mode === "count") {
    return { sql: `SELECT COUNT(*) as cnt FROM all_bank_transactions ${where}`, params };
  }

  if (mode === "summary") {
    return {
      sql: `SELECT
        COUNT(*) as total_records,
        COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) as total_deposits,
        SUM(CASE WHEN amount < 0 THEN 1 ELSE 0 END) as deposits_count,
        COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as total_expenses,
        SUM(CASE WHEN amount > 0 THEN 1 ELSE 0 END) as expenses_count,
        COALESCE(SUM(amount), 0) as net
      FROM all_bank_transactions ${where}`,
      params,
    };
  }

  // Rows mode
  const validSortCols = ["date", "amount", "category", "name", "account_name"];
  const sortCol = p.sortBy && validSortCols.includes(p.sortBy) ? p.sortBy : "date";
  const sortDir = p.sortDir || "desc";
  const sortExpr = `${sortCol} ${sortDir}`;

  const limit = p.limit || 50;
  const offset = p.offset || 0;

  return {
    sql: `SELECT * FROM all_bank_transactions ${where} ORDER BY ${sortExpr} LIMIT ? OFFSET ?`,
    params: [...params, limit, offset],
  };
}

// ── Public API ──

export function queryBank(p: QueryParams) {
  const db = getDb();

  try {
    // Get rows
    const rowQuery = buildQuery(p, "rows");
    const records = db.prepare(rowQuery.sql).all(...rowQuery.params) as BankRecord[];

    // Get count
    const countQuery = buildQuery(p, "count");
    const countResult = db.prepare(countQuery.sql).get(...countQuery.params) as { cnt: number };

    // Get summary
    const summaryQuery = buildQuery(p, "summary");
    const summary = db.prepare(summaryQuery.sql).get(...summaryQuery.params) as BankSummary;

    // Enrich with display account names; display_vendor is already materialized on the row
    const enriched = records.map((r) => {
      const displayName = (r as any).display_vendor || r.custom_name || r.name || r.description || "";
      return {
        ...r,
        amount: r.amount,
        display_account: ACCOUNT_LABELS[r.account_name] || r.account_name,
        display_name: displayName,
      };
    });

    return {
      records: enriched,
      total: countResult.cnt,
      summary,
    };
  } finally {
    db.close();
  }
}

export function queryBankCategories() {
  // Return expense categories from bank.db (Settings → Categories tab)
  // Exclude ignored categories
  try {
    const categories = getAllExpenseCategories();
    const ignored = getAllCategoryIgnores();
    const ignoredNames = new Set(ignored.map((i) => i.category_name.toLowerCase()));
    const result = categories
      .map((c) => ({ name: c.name, color: c.color || null, ignored: ignoredNames.has(c.name.toLowerCase()) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    result.push({ name: "Uncategorized", color: null, ignored: false });
    return result;
  } catch {
    // Fallback to raw RM categories if bank.db is unavailable
    const db = getDb();
    try {
      const rows = db.prepare(`
        SELECT DISTINCT category FROM all_bank_transactions
        WHERE category IS NOT NULL AND category != ''
        ORDER BY category
      `).all() as { category: string }[];
      return rows.map((r) => r.category);
    } finally {
      db.close();
    }
  }
}

export function queryBankAccounts() {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT DISTINCT account_name FROM all_bank_transactions
      WHERE account_name IS NOT NULL AND account_name != ''
      ORDER BY account_name
    `).all() as { account_name: string }[];
    return rows.map((r) => ACCOUNT_LABELS[r.account_name] || r.account_name);
  } finally {
    db.close();
  }
}

export function queryBankVendors() {
  const db = getDb();
  try {
    // Get ignored vendor names (case-insensitive lookup) — from bank.db
    const ignoredRows = db.prepare("SELECT vendor_name FROM vendor_ignores").all() as { vendor_name: string }[];
    const ignoredNamesLower = new Set(ignoredRows.map((r) => r.vendor_name.toLowerCase()));

    // Get all alias display names to distinguish grouped vs unmatched
    const aliases = getVendorAliases();
    const aliasDisplayNames = new Set(aliases.map((a) => a.display_name));

    // Use materialized display_vendor — already resolved on every row
    const rows = db.prepare(`
      SELECT COALESCE(display_vendor, COALESCE(NULLIF(custom_name, ''), name)) as display_name,
             COALESCE(NULLIF(custom_name, ''), name) as raw_name,
             COUNT(*) as cnt
      FROM all_bank_transactions
      WHERE name IS NOT NULL AND name != ''
      GROUP BY display_name
      ORDER BY cnt DESC
    `).all() as { display_name: string; raw_name: string; cnt: number }[];

    // Categorize
    const grouped = new Map<string, number>();   // aliased vendors
    const ignored = new Map<string, number>();   // ignored vendors
    const unmatched = new Map<string, number>(); // no alias, not ignored

    for (const r of rows) {
      if (!r.display_name) continue;
      const display = r.display_name;

      if (ignoredNamesLower.has(display.toLowerCase())) {
        ignored.set(display, (ignored.get(display) || 0) + r.cnt);
      } else if (aliasDisplayNames.has(display) && display !== r.raw_name) {
        grouped.set(display, (grouped.get(display) || 0) + r.cnt);
      } else {
        unmatched.set(display, (unmatched.get(display) || 0) + r.cnt);
      }
    }

    const toList = (m: Map<string, number>, tag: string) =>
      [...m.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count, tag }));

    return [
      ...toList(grouped, "grouped"),
      ...toList(ignored, "ignored"),
      ...toList(unmatched, "unmatched"),
    ];
  } finally {
    db.close();
  }
}

export function queryBankDateRange() {
  const db = getDb();
  try {
    const row = db.prepare("SELECT MIN(date) as min_date, MAX(date) as max_date FROM all_bank_transactions").get() as { min_date: string; max_date: string };
    return { min: row.min_date, max: row.max_date };
  } finally {
    db.close();
  }
}

export function updateTransactionCustomName(id: number, customName: string) {
  const db = getDb();
  try {
    db.prepare("UPDATE transactions SET custom_name = ? WHERE id = ?").run(customName, id);
  } finally {
    db.close();
  }
}

export function bulkUpdateTransactionCustomName(ids: number[], customName: string) {
  const db = getDb();
  try {
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(`UPDATE transactions SET custom_name = ? WHERE id IN (${placeholders})`).run(customName, ...ids);
  } finally {
    db.close();
  }
}
