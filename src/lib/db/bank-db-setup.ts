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
  db.exec(`CREATE TABLE IF NOT EXISTS manual_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT, original_date TEXT, account_type TEXT, account_name TEXT DEFAULT 'Manual Entry',
    account_number TEXT, institution_name TEXT, name TEXT, custom_name TEXT,
    amount TEXT, description TEXT, category TEXT, note TEXT,
    ignored_from TEXT, tax_deductible TEXT, transaction_tags TEXT,
    source TEXT DEFAULT 'manual'
  )`);
  db.exec(`DROP VIEW IF EXISTS all_bank_transactions`);
  db.exec(`CREATE VIEW all_bank_transactions AS
    SELECT *, 'rocketmoney' as _source_table FROM rocketmoney
    UNION ALL
    SELECT *, 'manual_entries' as _source_table FROM manual_entries
  `);
}
