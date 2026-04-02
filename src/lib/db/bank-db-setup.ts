/**
 * Shared helper for opening bank.db with manual_entries table + view.
 * Use this in API routes that open bank.db directly instead of going through bank-db.ts.
 */
import Database from "better-sqlite3";
import path from "path";

export function openBankDb(readonly = false): Database.Database {
  const db = new Database(path.join(process.cwd(), "databases", "bank.db"), readonly ? { readonly: true } : undefined);
  if (!readonly) {
    ensureBankView(db);
  }
  return db;
}

export function ensureBankView(db: Database.Database): void {
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
  db.exec(`DROP VIEW IF EXISTS all_bank_transactions`);
  db.exec(`CREATE VIEW all_bank_transactions AS SELECT * FROM transactions`);

  // Vendor alias and expense category tables (co-located with transaction data)
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

  // Performance indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tx_account_name ON transactions(account_name)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tx_name ON transactions(name)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tx_display_vendor ON transactions(display_vendor)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tx_source ON transactions(source)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cat_rules_category_id ON categorization_rules(category_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cat_rules_pattern ON categorization_rules(pattern)`);
}
