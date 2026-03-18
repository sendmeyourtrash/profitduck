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
