import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { parse } from "csv-parse/sync";
import path from "path";

const DB_DIR = path.join(process.cwd(), "databases");
const DATA_DIR = path.join(process.cwd(), "Data Exports");

function slugify(s: string) {
  return s.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").toLowerCase();
}

function safeCol(s: string) {
  return slugify(s.trim().replace(/\|.*/, "").trim());
}

function importCSV(dbPath: string, tableName: string, csvPath: string) {
  const raw = readFileSync(csvPath, "utf-8");
  const records = parse(raw, { columns: true, skip_empty_lines: true, relax_column_count: true });

  if (records.length === 0) {
    console.log(`  ⚠️  No records in ${path.basename(csvPath)}`);
    return 0;
  }

  const headers = Object.keys(records[0]);
  const cols = headers.map(safeCol);

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  // Create table with all text columns + auto ID
  const colDefs = cols.map((c) => `"${c}" TEXT`).join(", ");
  db.exec(`CREATE TABLE IF NOT EXISTS "${tableName}" (id INTEGER PRIMARY KEY AUTOINCREMENT, ${colDefs})`);

  // Insert all rows
  const placeholders = cols.map(() => "?").join(", ");
  const colNames = cols.map((c) => `"${c}"`).join(", ");
  const stmt = db.prepare(`INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders})`);

  const insertMany = db.transaction((rows: any[]) => {
    for (const row of rows) {
      const values = headers.map((h) => row[h] ?? null);
      stmt.run(...values);
    }
  });

  insertMany(records);
  const count = db.prepare(`SELECT COUNT(*) as c FROM "${tableName}"`).get() as any;
  db.close();

  return count.c;
}

// ============================================================
// 1. ROCKET MONEY
// ============================================================
console.log("\n🚀 ROCKET MONEY");
const rmDb = path.join(DB_DIR, "rocketmoney.db");
const rmCsv = path.join(DATA_DIR, "Rocket Money", "Rocket Money 2026-03-13T01_00_34.116Z-transactions.csv");
const rmCount = importCSV(rmDb, "transactions", rmCsv);
console.log(`  ✅ ${rmCount} rows → rocketmoney.db`);

// ============================================================
// 2. SQUAREUP
// ============================================================
console.log("\n🟧 SQUAREUP");
const sqDb = path.join(DB_DIR, "squareup.db");
const sqCsv = path.join(DATA_DIR, "SquareUp", "SquareUp items-2023-08-01-2026-03-13.csv");
const sqCount = importCSV(sqDb, "items", sqCsv);
console.log(`  ✅ ${sqCount} rows → squareup.db`);

// ============================================================
// 3. GRUBHUB (3 files → same table)
// ============================================================
console.log("\n🟢 GRUBHUB");
const ghDb = path.join(DB_DIR, "grubhub.db");
const ghFiles = [
  "Aug_23_-_July_24.csv",
  "Aug_24_-_July_25.csv",
  "Aug_25_-_Mar_12_26.csv",
];
let ghTotal = 0;
for (const f of ghFiles) {
  const csvPath = path.join(DATA_DIR, "GrubHub", f);
  const count = importCSV(ghDb, "orders", csvPath);
  console.log(`  ✅ ${count - ghTotal} rows from ${f}`);
  ghTotal = count;
}
console.log(`  📊 Total: ${ghTotal} rows → grubhub.db`);

// ============================================================
// 4. DOORDASH
// ============================================================
console.log("\n🔴 DOORDASH");
const ddDb = path.join(DB_DIR, "doordash.db");
const ddDir = path.join(
  DATA_DIR,
  "DoorDash financial_2025-12-12_2026-03-11_HQVnr_2026-03-13T01-08-35Z"
);
const ddFiles = [
  { file: "FINANCIAL_DETAILED_TRANSACTIONS_2025-12-12_2026-03-11_HQVnr_2026-03-13T01-08-35Z.csv", table: "detailed_transactions" },
  { file: "FINANCIAL_PAYOUT_SUMMARY_2025-12-12_2026-03-11_HQVnr_2026-03-13T01-08-35Z.csv", table: "payout_summary" },
  { file: "FINANCIAL_SIMPLIFIED_TRANSACTIONS_2025-12-12_2026-03-11_HQVnr_2026-03-13T01-08-35Z.csv", table: "simplified_transactions" },
  { file: "FINANCIAL_ERROR_CHARGES_AND_ADJUSTMENTS_2025-12-12_2026-03-11_HQVnr_2026-03-13T01-08-35Z.csv", table: "error_charges" },
];
for (const { file, table } of ddFiles) {
  const csvPath = path.join(ddDir, file);
  const count = importCSV(ddDb, table, csvPath);
  console.log(`  ✅ ${count} rows → ${table}`);
}

// ============================================================
// 5. UBER EATS
// ============================================================
console.log("\n🟩 UBER EATS");
const ueDb = path.join(DB_DIR, "ubereats.db");
const ueCsv = path.join(DATA_DIR, "Uber Eats", "Uber Eats.csv");
const ueCount = importCSV(ueDb, "orders", ueCsv);
console.log(`  ✅ ${ueCount} rows → ubereats.db`);

// ============================================================
// SUMMARY
// ============================================================
console.log("\n" + "=".repeat(50));
console.log("📁 Source Databases Created:");
console.log("=".repeat(50));

const dbs = [
  { name: "rocketmoney.db", desc: "Bank + CC activity (source of truth)" },
  { name: "squareup.db", desc: "POS item-level sales" },
  { name: "grubhub.db", desc: "Delivery orders" },
  { name: "doordash.db", desc: "Delivery orders + payouts" },
  { name: "ubereats.db", desc: "Delivery orders" },
];

for (const { name, desc } of dbs) {
  const dbPath = path.join(DB_DIR, name);
  const db = new Database(dbPath);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name != 'sqlite_sequence'").all() as any[];
  for (const t of tables) {
    const count = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get() as any;
    console.log(`  ${name.padEnd(18)} │ ${t.name.padEnd(25)} │ ${String(count.c).padStart(6)} rows │ ${desc}`);
  }
  db.close();
}

console.log("\n✅ All source databases ready in /databases/");
console.log("⏭️  Next: Create unified dev.db from these sources");
