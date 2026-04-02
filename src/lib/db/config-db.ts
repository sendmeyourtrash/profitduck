/**
 * Config Database Helpers
 * =======================
 *
 * Provides access to the configuration database:
 *   - categories.db — settings, closed days, imports, reconciliation
 *
 * Vendor aliases, expense categories, categorization rules, and menu
 * aliases/categories have all moved to bank-db.ts or sales-db.ts.
 */

import Database from "better-sqlite3";
import path from "path";

const DB_DIR = path.join(process.cwd(), "databases");

let _categoriesDb: InstanceType<typeof Database> | null = null;

export function getCategoriesDb(): InstanceType<typeof Database> {
  if (!_categoriesDb || !_categoriesDb.open) {
    _categoriesDb = new Database(path.join(DB_DIR, "categories.db"));
    _categoriesDb.pragma("journal_mode = WAL");
  }
  return _categoriesDb;
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
