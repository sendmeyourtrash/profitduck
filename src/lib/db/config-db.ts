/**
 * Config Database Helpers
 * =======================
 *
 * Provides access to the configuration databases:
 *   - vendor-aliases.db — vendor name mappings + ignores
 *   - categories.db — menu aliases, expense categories, categorization rules
 *
 * These are separate from the data pipeline databases (sales.db, bank.db)
 * because they contain user configuration, not transaction data.
 */

import Database from "better-sqlite3";
import path from "path";

const DB_DIR = path.join(process.cwd(), "databases");

let _vendorDb: InstanceType<typeof Database> | null = null;
let _categoriesDb: InstanceType<typeof Database> | null = null;

export function getVendorAliasesDb(): InstanceType<typeof Database> {
  if (!_vendorDb || !_vendorDb.open) {
    _vendorDb = new Database(path.join(DB_DIR, "vendor-aliases.db"));
    _vendorDb.pragma("journal_mode = WAL");
  }
  return _vendorDb;
}

export function getCategoriesDb(): InstanceType<typeof Database> {
  if (!_categoriesDb || !_categoriesDb.open) {
    _categoriesDb = new Database(path.join(DB_DIR, "categories.db"));
    _categoriesDb.pragma("journal_mode = WAL");
  }
  return _categoriesDb;
}

// ── Vendor Aliases ──────────────────────────────────────────────────

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

export function getAllVendorAliases(): VendorAlias[] {
  return getVendorAliasesDb().prepare("SELECT * FROM vendor_aliases ORDER BY display_name").all() as VendorAlias[];
}

export function createVendorAlias(id: string, pattern: string, matchType: string, displayName: string, autoCreated = false): void {
  getVendorAliasesDb().prepare(
    "INSERT INTO vendor_aliases (id, pattern, match_type, display_name, auto_created, created_at) VALUES (?,?,?,?,?,?)"
  ).run(id, pattern, matchType, displayName, autoCreated ? 1 : 0, new Date().toISOString());
}

export function updateVendorAlias(id: string, updates: Partial<{ pattern: string; match_type: string; display_name: string }>): void {
  const sets: string[] = [];
  const params: (string)[] = [];
  if (updates.pattern !== undefined) { sets.push("pattern = ?"); params.push(updates.pattern); }
  if (updates.match_type !== undefined) { sets.push("match_type = ?"); params.push(updates.match_type); }
  if (updates.display_name !== undefined) { sets.push("display_name = ?"); params.push(updates.display_name); }
  if (sets.length > 0) {
    params.push(id);
    getVendorAliasesDb().prepare(`UPDATE vendor_aliases SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  }
}

export function deleteVendorAlias(id: string): void {
  getVendorAliasesDb().prepare("DELETE FROM vendor_aliases WHERE id = ?").run(id);
}

export function getAllVendorIgnores(): VendorIgnore[] {
  return getVendorAliasesDb().prepare("SELECT * FROM vendor_ignores ORDER BY vendor_name").all() as VendorIgnore[];
}

export function createVendorIgnore(id: string, vendorName: string): void {
  const existing = getVendorAliasesDb().prepare("SELECT 1 FROM vendor_ignores WHERE vendor_name = ?").get(vendorName);
  if (!existing) {
    getVendorAliasesDb().prepare(
      "INSERT INTO vendor_ignores (id, vendor_name, created_at) VALUES (?,?,?)"
    ).run(id, vendorName, new Date().toISOString());
  }
}

export function deleteVendorIgnore(vendorName: string): void {
  getVendorAliasesDb().prepare("DELETE FROM vendor_ignores WHERE vendor_name = ?").run(vendorName);
}

// ── Menu Item Aliases ───────────────────────────────────────────────

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
  return getCategoriesDb().prepare("SELECT * FROM menu_item_aliases ORDER BY display_name").all() as MenuItemAlias[];
}

export function createMenuItemAlias(id: string, pattern: string, matchType: string, displayName: string): void {
  getCategoriesDb().prepare(
    "INSERT INTO menu_item_aliases (id, pattern, match_type, display_name, created_at) VALUES (?,?,?,?,?)"
  ).run(id, pattern, matchType, displayName, new Date().toISOString());
}

export function updateMenuItemAlias(id: string, updates: Partial<{ pattern: string; match_type: string; display_name: string }>): void {
  const sets: string[] = [];
  const params: (string)[] = [];
  if (updates.pattern !== undefined) { sets.push("pattern = ?"); params.push(updates.pattern); }
  if (updates.match_type !== undefined) { sets.push("match_type = ?"); params.push(updates.match_type); }
  if (updates.display_name !== undefined) { sets.push("display_name = ?"); params.push(updates.display_name); }
  if (sets.length > 0) {
    params.push(id);
    getCategoriesDb().prepare(`UPDATE menu_item_aliases SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  }
}

export function deleteMenuItemAlias(id: string): void {
  getCategoriesDb().prepare("DELETE FROM menu_item_aliases WHERE id = ?").run(id);
}

export function getAllMenuItemIgnores(): MenuItemIgnore[] {
  return getCategoriesDb().prepare("SELECT * FROM menu_item_ignores ORDER BY item_name").all() as MenuItemIgnore[];
}

export function createMenuItemIgnore(id: string, itemName: string): void {
  const existing = getCategoriesDb().prepare("SELECT 1 FROM menu_item_ignores WHERE item_name = ?").get(itemName);
  if (!existing) {
    getCategoriesDb().prepare(
      "INSERT INTO menu_item_ignores (id, item_name, created_at) VALUES (?,?,?)"
    ).run(id, itemName, new Date().toISOString());
  }
}

export function deleteMenuItemIgnore(itemName: string): void {
  getCategoriesDb().prepare("DELETE FROM menu_item_ignores WHERE item_name = ?").run(itemName);
}

// ── Menu Category Aliases ───────────────────────────────────────────

export interface MenuCategoryAlias {
  id: string;
  pattern: string;
  match_type: string;
  display_name: string;
  created_at: string;
}

export function getAllMenuCategoryAliases(): MenuCategoryAlias[] {
  return getCategoriesDb().prepare("SELECT * FROM menu_category_aliases ORDER BY display_name").all() as MenuCategoryAlias[];
}

export function createMenuCategoryAlias(id: string, pattern: string, matchType: string, displayName: string): void {
  getCategoriesDb().prepare(
    "INSERT INTO menu_category_aliases (id, pattern, match_type, display_name, created_at) VALUES (?,?,?,?,?)"
  ).run(id, pattern, matchType, displayName, new Date().toISOString());
}

export function updateMenuCategoryAlias(id: string, updates: Partial<{ pattern: string; match_type: string; display_name: string }>): void {
  const sets: string[] = [];
  const params: (string)[] = [];
  if (updates.pattern !== undefined) { sets.push("pattern = ?"); params.push(updates.pattern); }
  if (updates.match_type !== undefined) { sets.push("match_type = ?"); params.push(updates.match_type); }
  if (updates.display_name !== undefined) { sets.push("display_name = ?"); params.push(updates.display_name); }
  if (sets.length > 0) {
    params.push(id);
    getCategoriesDb().prepare(`UPDATE menu_category_aliases SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  }
}

export function deleteMenuCategoryAlias(id: string): void {
  getCategoriesDb().prepare("DELETE FROM menu_category_aliases WHERE id = ?").run(id);
}

// ── Expense Categories ──────────────────────────────────────────────

export interface ExpenseCategory {
  id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  icon: string | null;
  created_at: string;
}

export function getAllExpenseCategories(): ExpenseCategory[] {
  return getCategoriesDb().prepare("SELECT * FROM expense_categories ORDER BY name").all() as ExpenseCategory[];
}

export function createExpenseCategory(id: string, name: string, color?: string, icon?: string, parentId?: string): void {
  getCategoriesDb().prepare(
    "INSERT INTO expense_categories (id, name, parent_id, color, icon, created_at) VALUES (?,?,?,?,?,?)"
  ).run(id, name, parentId || null, color || null, icon || null, new Date().toISOString());
}

export function updateExpenseCategory(id: string, updates: Partial<{ name: string; color: string; icon: string }>): void {
  const sets: string[] = [];
  const params: (string)[] = [];
  if (updates.name !== undefined) { sets.push("name = ?"); params.push(updates.name); }
  if (updates.color !== undefined) { sets.push("color = ?"); params.push(updates.color); }
  if (updates.icon !== undefined) { sets.push("icon = ?"); params.push(updates.icon); }
  if (sets.length > 0) {
    params.push(id);
    getCategoriesDb().prepare(`UPDATE expense_categories SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  }
}

export function deleteExpenseCategory(id: string): void {
  getCategoriesDb().prepare("DELETE FROM expense_categories WHERE id = ?").run(id);
  getCategoriesDb().prepare("DELETE FROM categorization_rules WHERE category_id = ?").run(id);
}

// ── Category Ignores (Bank Statements) ─────────────────────────────

export interface CategoryIgnore {
  id: number;
  category_name: string;
  created_at: string;
}

export function ensureCategoryIgnoresTable(): void {
  getCategoriesDb().exec(`CREATE TABLE IF NOT EXISTS category_ignores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_name TEXT NOT NULL UNIQUE,
    created_at TEXT
  )`);
}

export function getAllCategoryIgnores(): CategoryIgnore[] {
  ensureCategoryIgnoresTable();
  return getCategoriesDb().prepare("SELECT * FROM category_ignores ORDER BY category_name").all() as CategoryIgnore[];
}

export function createCategoryIgnore(categoryName: string): void {
  ensureCategoryIgnoresTable();
  const existing = getCategoriesDb().prepare("SELECT 1 FROM category_ignores WHERE category_name = ?").get(categoryName);
  if (!existing) {
    getCategoriesDb().prepare(
      "INSERT INTO category_ignores (category_name, created_at) VALUES (?,?)"
    ).run(categoryName, new Date().toISOString());
  }
}

export function deleteCategoryIgnore(categoryName: string): void {
  ensureCategoryIgnoresTable();
  getCategoriesDb().prepare("DELETE FROM category_ignores WHERE category_name = ?").run(categoryName);
}

// ── Settings ────────────────────────────────────────────────────────

function ensureSettingsTable(): void {
  getCategoriesDb().exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
}

export function getSettingValue(key: string): string | null {
  ensureSettingsTable();
  const row = getCategoriesDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSettingValue(key: string, value: string): void {
  ensureSettingsTable();
  getCategoriesDb().prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?"
  ).run(key, value, value);
}

export function deleteSettingValue(key: string): void {
  ensureSettingsTable();
  getCategoriesDb().prepare("DELETE FROM settings WHERE key = ?").run(key);
}

export function getAllSettingValues(): Record<string, string> {
  ensureSettingsTable();
  const rows = getCategoriesDb().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

// ── Closed Days ─────────────────────────────────────────────────────

function ensureClosedDaysTable(): void {
  getCategoriesDb().exec(`CREATE TABLE IF NOT EXISTS closed_days (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    reason TEXT,
    auto_detected INTEGER DEFAULT 0,
    created_at TEXT
  )`);
}

export interface ClosedDay {
  id: number;
  date: string;
  reason: string | null;
  auto_detected: number;
  created_at: string;
}

export function getClosedDays(): ClosedDay[] {
  ensureClosedDaysTable();
  return getCategoriesDb().prepare("SELECT * FROM closed_days ORDER BY date DESC").all() as ClosedDay[];
}

export function addClosedDay(date: string, reason?: string, autoDetected = false): void {
  ensureClosedDaysTable();
  const existing = getCategoriesDb().prepare("SELECT 1 FROM closed_days WHERE date = ?").get(date);
  if (!existing) {
    getCategoriesDb().prepare(
      "INSERT INTO closed_days (date, reason, auto_detected, created_at) VALUES (?,?,?,?)"
    ).run(date, reason || null, autoDetected ? 1 : 0, new Date().toISOString());
  }
}

export function removeClosedDay(date: string): void {
  ensureClosedDaysTable();
  getCategoriesDb().prepare("DELETE FROM closed_days WHERE date = ?").run(date);
}

// ── Ignored closed days (dismissed from auto-detect permanently) ──

function ensureClosedDaysIgnoredTable(): void {
  getCategoriesDb().exec(`CREATE TABLE IF NOT EXISTS closed_days_ignored (
    date TEXT PRIMARY KEY
  )`);
}

export function getIgnoredClosedDates(): string[] {
  ensureClosedDaysIgnoredTable();
  return (getCategoriesDb().prepare("SELECT date FROM closed_days_ignored ORDER BY date DESC").all() as { date: string }[]).map((r) => r.date);
}

export function addIgnoredClosedDate(date: string): void {
  ensureClosedDaysIgnoredTable();
  getCategoriesDb().prepare("INSERT OR IGNORE INTO closed_days_ignored (date) VALUES (?)").run(date);
}

export function removeIgnoredClosedDate(date: string): void {
  ensureClosedDaysIgnoredTable();
  getCategoriesDb().prepare("DELETE FROM closed_days_ignored WHERE date = ?").run(date);
}

export function countClosedDaysInRange(startDate: string, endDate: string): number {
  ensureClosedDaysTable();
  const row = getCategoriesDb().prepare(
    "SELECT COUNT(*) as cnt FROM closed_days WHERE date >= ? AND date <= ?"
  ).get(startDate, endDate) as { cnt: number };
  return row.cnt;
}

// ── Imports ─────────────────────────────────────────────────────────

function ensureImportsTable(): void {
  getCategoriesDb().exec(`CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    source TEXT,
    status TEXT DEFAULT 'completed',
    records_count INTEGER DEFAULT 0,
    file_hash TEXT,
    date_range_start TEXT,
    date_range_end TEXT,
    created_at TEXT
  )`);
}

export interface ImportRecord {
  id: number;
  filename: string;
  source: string | null;
  status: string;
  records_count: number;
  file_hash: string | null;
  date_range_start: string | null;
  date_range_end: string | null;
  created_at: string;
}

export function getImports(source?: string, limit = 50, offset = 0): ImportRecord[] {
  ensureImportsTable();
  if (source) {
    return getCategoriesDb().prepare(
      "SELECT * FROM imports WHERE source = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
    ).all(source, limit, offset) as ImportRecord[];
  }
  return getCategoriesDb().prepare(
    "SELECT * FROM imports ORDER BY created_at DESC LIMIT ? OFFSET ?"
  ).all(limit, offset) as ImportRecord[];
}

export function createImport(filename: string, source: string, recordsCount = 0, fileHash?: string, dateStart?: string, dateEnd?: string): number {
  ensureImportsTable();
  const result = getCategoriesDb().prepare(
    "INSERT INTO imports (filename, source, status, records_count, file_hash, date_range_start, date_range_end, created_at) VALUES (?,?,?,?,?,?,?,?)"
  ).run(filename, source, "completed", recordsCount, fileHash || null, dateStart || null, dateEnd || null, new Date().toISOString());
  return Number(result.lastInsertRowid);
}

export function getImportByHash(fileHash: string): ImportRecord | null {
  ensureImportsTable();
  return (getCategoriesDb().prepare("SELECT * FROM imports WHERE file_hash = ?").get(fileHash) as ImportRecord) || null;
}

// ── Reconciliation Matches ──────────────────────────────────────────

function ensureReconciliationTable(): void {
  getCategoriesDb().exec(`CREATE TABLE IF NOT EXISTS reconciliation_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    order_group_start TEXT NOT NULL,
    order_group_end TEXT NOT NULL,
    order_count INTEGER NOT NULL,
    expected_amount REAL NOT NULL,
    bank_tx_id INTEGER,
    bank_date TEXT,
    bank_amount REAL,
    variance REAL,
    status TEXT DEFAULT 'unmatched',
    created_at TEXT
  )`);
  getCategoriesDb().exec(`CREATE TABLE IF NOT EXISTS reconciliation_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    severity TEXT DEFAULT 'warning',
    message TEXT NOT NULL,
    platform TEXT,
    resolved INTEGER DEFAULT 0,
    created_at TEXT
  )`);
}

export interface ReconMatch {
  id: number;
  platform: string;
  order_group_start: string;
  order_group_end: string;
  order_count: number;
  expected_amount: number;
  bank_tx_id: number | null;
  bank_date: string | null;
  bank_amount: number | null;
  variance: number | null;
  status: string;
  created_at: string;
}

export interface ReconAlert {
  id: number;
  type: string;
  severity: string;
  message: string;
  platform: string | null;
  resolved: number;
  created_at: string;
}

export function getReconMatches(platform?: string): ReconMatch[] {
  ensureReconciliationTable();
  if (platform) {
    return getCategoriesDb().prepare(
      "SELECT * FROM reconciliation_matches WHERE platform = ? ORDER BY order_group_start DESC"
    ).all(platform) as ReconMatch[];
  }
  return getCategoriesDb().prepare(
    "SELECT * FROM reconciliation_matches ORDER BY order_group_start DESC"
  ).all() as ReconMatch[];
}

export function clearReconMatches(): void {
  ensureReconciliationTable();
  getCategoriesDb().prepare("DELETE FROM reconciliation_matches").run();
  getCategoriesDb().prepare("DELETE FROM reconciliation_alerts").run();
}

export function insertReconMatch(match: Omit<ReconMatch, "id" | "created_at">): number {
  ensureReconciliationTable();
  const result = getCategoriesDb().prepare(
    `INSERT INTO reconciliation_matches (platform, order_group_start, order_group_end, order_count, expected_amount, bank_tx_id, bank_date, bank_amount, variance, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    match.platform, match.order_group_start, match.order_group_end,
    match.order_count, match.expected_amount, match.bank_tx_id,
    match.bank_date, match.bank_amount, match.variance, match.status,
    new Date().toISOString()
  );
  return Number(result.lastInsertRowid);
}

export function updateReconMatch(id: number, bankTxId: number, bankDate: string, bankAmount: number): void {
  ensureReconciliationTable();
  const variance = Math.round((bankAmount - (getCategoriesDb().prepare(
    "SELECT expected_amount FROM reconciliation_matches WHERE id = ?"
  ).get(id) as { expected_amount: number }).expected_amount) * 100) / 100;
  getCategoriesDb().prepare(
    `UPDATE reconciliation_matches SET bank_tx_id = ?, bank_date = ?, bank_amount = ?, variance = ?, status = 'matched' WHERE id = ?`
  ).run(bankTxId, bankDate, bankAmount, variance, id);
}

export function unmatchReconMatch(id: number): void {
  ensureReconciliationTable();
  getCategoriesDb().prepare(
    `UPDATE reconciliation_matches SET bank_tx_id = NULL, bank_date = NULL, bank_amount = NULL, variance = NULL, status = 'unmatched' WHERE id = ?`
  ).run(id);
}

export function insertReconAlert(type: string, severity: string, message: string, platform?: string): void {
  ensureReconciliationTable();
  getCategoriesDb().prepare(
    `INSERT INTO reconciliation_alerts (type, severity, message, platform, created_at) VALUES (?,?,?,?,?)`
  ).run(type, severity, message, platform || null, new Date().toISOString());
}

export function getReconAlerts(resolved = false): ReconAlert[] {
  ensureReconciliationTable();
  return getCategoriesDb().prepare(
    "SELECT * FROM reconciliation_alerts WHERE resolved = ? ORDER BY created_at DESC"
  ).all(resolved ? 1 : 0) as ReconAlert[];
}

export function resolveReconAlert(id: number): void {
  ensureReconciliationTable();
  getCategoriesDb().prepare("UPDATE reconciliation_alerts SET resolved = 1 WHERE id = ?").run(id);
}

export function getReconSummary(): { total: number; matched: number; unmatched: number; variance: number; rate: number } {
  ensureReconciliationTable();
  const total = (getCategoriesDb().prepare("SELECT COUNT(*) as cnt FROM reconciliation_matches").get() as { cnt: number }).cnt;
  const matched = (getCategoriesDb().prepare("SELECT COUNT(*) as cnt FROM reconciliation_matches WHERE status = 'matched'").get() as { cnt: number }).cnt;
  const varianceRow = getCategoriesDb().prepare("SELECT ROUND(SUM(ABS(variance)), 2) as v FROM reconciliation_matches WHERE status = 'matched'").get() as { v: number };
  return {
    total,
    matched,
    unmatched: total - matched,
    variance: varianceRow.v || 0,
    rate: total > 0 ? Math.round((matched / total) * 100) : 0,
  };
}

// ── Categorization Rules ────────────────────────────────────────────

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

export function getAllCategorizationRules(): CategorizationRule[] {
  return getCategoriesDb().prepare("SELECT * FROM categorization_rules ORDER BY priority DESC, pattern").all() as CategorizationRule[];
}

export function createCategorizationRule(id: string, type: string, pattern: string, categoryId: string, priority = 5, createdFrom = "manual"): void {
  getCategoriesDb().prepare(
    "INSERT INTO categorization_rules (id, type, pattern, category_id, priority, created_from, hit_count, created_at) VALUES (?,?,?,?,?,?,0,?)"
  ).run(id, type, pattern, categoryId, priority, createdFrom, new Date().toISOString());
}

export function updateCategorizationRule(id: string, updates: Partial<{ type: string; pattern: string; category_id: string }>): void {
  const sets: string[] = [];
  const params: (string)[] = [];
  if (updates.type !== undefined) { sets.push("type = ?"); params.push(updates.type); }
  if (updates.pattern !== undefined) { sets.push("pattern = ?"); params.push(updates.pattern); }
  if (updates.category_id !== undefined) { sets.push("category_id = ?"); params.push(updates.category_id); }
  if (sets.length > 0) {
    params.push(id);
    getCategoriesDb().prepare(`UPDATE categorization_rules SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  }
}

export function deleteCategorizationRule(id: string): void {
  getCategoriesDb().prepare("DELETE FROM categorization_rules WHERE id = ?").run(id);
}

// --- Menu Modifier Aliases ---

function ensureMenuModifierAliasesTable() {
  const db = getCategoriesDb();
  db.exec(`CREATE TABLE IF NOT EXISTS menu_modifier_aliases (
    id TEXT PRIMARY KEY,
    pattern TEXT NOT NULL,
    match_type TEXT NOT NULL DEFAULT 'exact',
    display_name TEXT NOT NULL,
    created_at TEXT
  )`);
}

export function getAllMenuModifierAliases() {
  ensureMenuModifierAliasesTable();
  const db = getCategoriesDb();
  return db.prepare("SELECT * FROM menu_modifier_aliases ORDER BY display_name").all() as {
    id: string; pattern: string; match_type: string; display_name: string; created_at: string;
  }[];
}

export function createMenuModifierAlias(id: string, pattern: string, matchType: string, displayName: string) {
  ensureMenuModifierAliasesTable();
  const db = getCategoriesDb();
  db.prepare("INSERT INTO menu_modifier_aliases (id, pattern, match_type, display_name, created_at) VALUES (?,?,?,?,?)").run(id, pattern, matchType, displayName, new Date().toISOString());
}

export function updateMenuModifierAlias(id: string, updates: { pattern?: string; match_type?: string; display_name?: string }) {
  ensureMenuModifierAliasesTable();
  const db = getCategoriesDb();
  const fields: string[] = [];
  const values: string[] = [];
  if (updates.pattern !== undefined) { fields.push("pattern = ?"); values.push(updates.pattern); }
  if (updates.match_type !== undefined) { fields.push("match_type = ?"); values.push(updates.match_type); }
  if (updates.display_name !== undefined) { fields.push("display_name = ?"); values.push(updates.display_name); }
  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE menu_modifier_aliases SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteMenuModifierAlias(id: string) {
  ensureMenuModifierAliasesTable();
  const db = getCategoriesDb();
  db.prepare("DELETE FROM menu_modifier_aliases WHERE id = ?").run(id);
}

// --- Menu Modifier Ignores ---

function ensureMenuModifierIgnoresTable() {
  const db = getCategoriesDb();
  db.exec(`CREATE TABLE IF NOT EXISTS menu_modifier_ignores (
    id TEXT PRIMARY KEY,
    modifier_name TEXT NOT NULL UNIQUE,
    created_at TEXT
  )`);
}

export function getAllMenuModifierIgnores() {
  ensureMenuModifierIgnoresTable();
  const db = getCategoriesDb();
  return db.prepare("SELECT * FROM menu_modifier_ignores ORDER BY modifier_name").all() as {
    id: string; modifier_name: string; created_at: string;
  }[];
}

export function createMenuModifierIgnore(id: string, modifierName: string) {
  ensureMenuModifierIgnoresTable();
  const db = getCategoriesDb();
  const existing = db.prepare("SELECT 1 FROM menu_modifier_ignores WHERE modifier_name = ?").get(modifierName);
  if (!existing) {
    db.prepare("INSERT INTO menu_modifier_ignores (id, modifier_name, created_at) VALUES (?,?,?)").run(id, modifierName, new Date().toISOString());
  }
}

export function deleteMenuModifierIgnore(modifierName: string) {
  ensureMenuModifierIgnoresTable();
  const db = getCategoriesDb();
  db.prepare("DELETE FROM menu_modifier_ignores WHERE modifier_name = ?").run(modifierName);
}

// --- Menu Categories (user-defined groupings) ---

function ensureMenuCategoriesSchema() {
  const db = getCategoriesDb();
  db.exec(`CREATE TABLE IF NOT EXISTS menu_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT,
    sort_order INTEGER DEFAULT 0,
    square_catalog_id TEXT,
    created_at TEXT
  )`);
  // Add square_catalog_id column if missing (migration for existing DBs)
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
  // Add square_item_id column if missing
  const mapCols = db.prepare("PRAGMA table_info(menu_item_category_map)").all() as { name: string }[];
  if (!mapCols.some(c => c.name === "square_item_id")) {
    db.exec("ALTER TABLE menu_item_category_map ADD COLUMN square_item_id TEXT");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_micm_cat ON menu_item_category_map(category_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_micm_dn ON menu_item_category_map(display_name)");
}

export function getAllMenuCategories() {
  ensureMenuCategoriesSchema();
  const db = getCategoriesDb();
  return db.prepare("SELECT * FROM menu_categories ORDER BY sort_order, name").all() as {
    id: string; name: string; color: string | null; sort_order: number; created_at: string;
  }[];
}

export function createMenuCategory(id: string, name: string, color?: string, sortOrder?: number) {
  ensureMenuCategoriesSchema();
  const db = getCategoriesDb();
  db.prepare("INSERT INTO menu_categories (id, name, color, sort_order, created_at) VALUES (?,?,?,?,?)").run(
    id, name, color || null, sortOrder ?? 0, new Date().toISOString()
  );
}

export function updateMenuCategory(id: string, updates: { name?: string; color?: string; sort_order?: number }) {
  ensureMenuCategoriesSchema();
  const db = getCategoriesDb();
  const fields: string[] = [];
  const values: (string | number)[] = [];
  if (updates.name !== undefined) { fields.push("name = ?"); values.push(updates.name); }
  if (updates.color !== undefined) { fields.push("color = ?"); values.push(updates.color); }
  if (updates.sort_order !== undefined) { fields.push("sort_order = ?"); values.push(updates.sort_order); }
  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE menu_categories SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteMenuCategory(id: string) {
  ensureMenuCategoriesSchema();
  const db = getCategoriesDb();
  db.prepare("DELETE FROM menu_item_category_map WHERE category_id = ?").run(id);
  db.prepare("DELETE FROM menu_categories WHERE id = ?").run(id);
}

export function getItemCategoryMappings() {
  ensureMenuCategoriesSchema();
  const db = getCategoriesDb();
  return db.prepare(`
    SELECT m.display_name, m.category_id, c.name as category_name
    FROM menu_item_category_map m
    JOIN menu_categories c ON m.category_id = c.id
  `).all() as { display_name: string; category_id: string; category_name: string }[];
}

export function assignItemToCategory(id: string, displayName: string, categoryId: string) {
  ensureMenuCategoriesSchema();
  const db = getCategoriesDb();
  const existing = db.prepare("SELECT id FROM menu_item_category_map WHERE display_name = ?").get(displayName) as { id: string } | undefined;
  if (existing) {
    db.prepare("UPDATE menu_item_category_map SET category_id = ? WHERE display_name = ?").run(categoryId, displayName);
  } else {
    db.prepare("INSERT INTO menu_item_category_map (id, display_name, category_id, created_at) VALUES (?,?,?,?)").run(
      id, displayName, categoryId, new Date().toISOString()
    );
  }
}

export function unassignItem(displayName: string) {
  ensureMenuCategoriesSchema();
  const db = getCategoriesDb();
  db.prepare("DELETE FROM menu_item_category_map WHERE display_name = ?").run(displayName);
}

export function bulkAssignItems(items: { id: string; displayName: string; categoryId: string }[]) {
  ensureMenuCategoriesSchema();
  const db = getCategoriesDb();
  const upsert = db.transaction((batch: typeof items) => {
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
  });
  upsert(items);
}

// --- Square Catalog sync helpers ---

export function getCategoryBySquareCatalogId(squareCatalogId: string) {
  ensureMenuCategoriesSchema();
  const db = getCategoriesDb();
  return db.prepare("SELECT * FROM menu_categories WHERE square_catalog_id = ?").get(squareCatalogId) as {
    id: string; name: string; color: string | null; sort_order: number; square_catalog_id: string; created_at: string;
  } | undefined;
}

export function createMenuCategoryFromCatalog(id: string, name: string, squareCatalogId: string, sortOrder?: number) {
  ensureMenuCategoriesSchema();
  const db = getCategoriesDb();
  db.prepare("INSERT OR IGNORE INTO menu_categories (id, name, square_catalog_id, sort_order, created_at) VALUES (?,?,?,?,?)").run(
    id, name, squareCatalogId, sortOrder ?? 0, new Date().toISOString()
  );
}

export function assignItemToCategoryFromCatalog(id: string, displayName: string, categoryId: string, squareItemId?: string) {
  ensureMenuCategoriesSchema();
  const db = getCategoriesDb();
  const existing = db.prepare("SELECT id FROM menu_item_category_map WHERE display_name = ?").get(displayName) as { id: string } | undefined;
  if (existing) {
    db.prepare("UPDATE menu_item_category_map SET category_id = ?, square_item_id = ? WHERE display_name = ?").run(categoryId, squareItemId || null, displayName);
  } else {
    db.prepare("INSERT INTO menu_item_category_map (id, display_name, category_id, square_item_id, created_at) VALUES (?,?,?,?,?)").run(
      id, displayName, categoryId, squareItemId || null, new Date().toISOString()
    );
  }
}
