/**
 * Migrate manual entries from rocketmoney table to manual_entries table.
 *
 * Before the manual_entries table was created, manual entries were stored
 * in rocketmoney with account_name = 'Manual'. This script moves them
 * to their own table so pipeline rebuilds don't wipe them.
 *
 * Safe to run multiple times — skips if no rows to migrate.
 *
 * Usage: npx tsx scripts/migrate-manual-entries.ts
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "databases", "bank.db");

function run() {
  const db = new Database(DB_PATH);

  // Ensure manual_entries table exists
  db.exec(`CREATE TABLE IF NOT EXISTS manual_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT, original_date TEXT, account_type TEXT, account_name TEXT DEFAULT 'Manual Entry',
    account_number TEXT, institution_name TEXT, name TEXT, custom_name TEXT,
    amount TEXT, description TEXT, category TEXT, note TEXT,
    ignored_from TEXT, tax_deductible TEXT, transaction_tags TEXT,
    source TEXT DEFAULT 'manual'
  )`);

  // Find manual entries in rocketmoney
  const rows = db.prepare(
    "SELECT * FROM rocketmoney WHERE account_name = 'Manual'"
  ).all() as Record<string, unknown>[];

  if (rows.length === 0) {
    console.log("No manual entries found in rocketmoney table. Nothing to migrate.");
    db.close();
    return;
  }

  console.log(`Found ${rows.length} manual entries in rocketmoney to migrate.`);

  const insert = db.prepare(
    `INSERT INTO manual_entries (date, original_date, account_type, account_name, account_number,
     institution_name, name, custom_name, amount, description, category, note,
     ignored_from, tax_deductible, transaction_tags, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const deleteRow = db.prepare("DELETE FROM rocketmoney WHERE id = ?");

  const migrate = db.transaction(() => {
    let migrated = 0;
    for (const row of rows) {
      insert.run(
        row.date, row.original_date, row.account_type, "Manual Entry",
        row.account_number, row.institution_name, row.name, row.custom_name,
        row.amount, row.description, row.category, row.note,
        row.ignored_from, row.tax_deductible, row.transaction_tags, "manual"
      );
      deleteRow.run(row.id);
      migrated++;
    }
    return migrated;
  });

  const count = migrate();
  console.log(`Migrated ${count} manual entries from rocketmoney → manual_entries.`);

  // Verify
  const remaining = db.prepare(
    "SELECT COUNT(*) as cnt FROM rocketmoney WHERE account_name = 'Manual'"
  ).get() as { cnt: number };
  const newCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM manual_entries"
  ).get() as { cnt: number };

  console.log(`Remaining in rocketmoney (Manual): ${remaining.cnt}`);
  console.log(`Total in manual_entries: ${newCount.cnt}`);

  db.close();
}

run();
