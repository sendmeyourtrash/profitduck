/**
 * Bank DB Query Layer
 * ===================
 *
 * Reads from databases/bank.db (Rocket Money + Chase statements).
 * Powers the Bank Activity page.
 *
 * @see PIPELINE.md for database architecture
 */

import Database from "better-sqlite3";
import path from "path";

function getDb() {
  return new Database(path.join(process.cwd(), "databases", "bank.db"));
}

function getVendorAliasDb() {
  return new Database(path.join(process.cwd(), "databases", "vendor-aliases.db"));
}

// ── Vendor alias resolution ──

interface VendorAlias {
  pattern: string;
  match_type: string;
  display_name: string;
}

let cachedAliases: VendorAlias[] | null = null;

function getVendorAliases(): VendorAlias[] {
  if (cachedAliases) return cachedAliases;
  const db = getVendorAliasDb();
  try {
    cachedAliases = db.prepare("SELECT pattern, match_type, display_name FROM vendor_aliases").all() as VendorAlias[];
    return cachedAliases;
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
function resolveVendorFromRecord(name: string, customName: string, description: string): string {
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
    try {
      const { getAllCategorizationRules, getAllExpenseCategories } = require("@/lib/db/config-db");
      const rules = getAllCategorizationRules() as { type: string; pattern: string; category_id: string }[];
      const expCats = getAllExpenseCategories() as { id: string; name: string }[];

      // Find category IDs for selected category names
      const selectedCatIds = new Set(
        expCats.filter((c) => p.categories!.includes(c.name)).map((c) => c.id)
      );

      // Find vendor display names that map to those categories
      const matchingVendors = rules
        .filter((r) => r.type === "vendor_match" && selectedCatIds.has(r.category_id))
        .map((r) => r.pattern);

      if (matchingVendors.length > 0) {
        // Get all aliases for these vendors, build SQL conditions
        const aliases = getVendorAliases();
        const vendorConds: string[] = [];
        for (const vendorName of matchingVendors) {
          // Find alias patterns that map TO this vendor display name
          const matchingAliases = aliases.filter((a) => a.display_name.toLowerCase() === vendorName.toLowerCase());
          if (matchingAliases.length > 0) {
            for (const alias of matchingAliases) {
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
            // No alias — match raw vendor name directly
            vendorConds.push("(name = ? OR custom_name = ?)");
            params.push(vendorName, vendorName);
          }
        }
        if (vendorConds.length > 0) {
          conditions.push(`(${vendorConds.join(" OR ")})`);
        }
      } else {
        // No matching vendors → return nothing
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

  // Search
  if (p.search) {
    conditions.push("(name LIKE ? OR description LIKE ? OR custom_name LIKE ?)");
    const searchTerm = `%${p.search}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  if (mode === "count") {
    return { sql: `SELECT COUNT(*) as cnt FROM rocketmoney ${where}`, params };
  }

  if (mode === "summary") {
    return {
      sql: `SELECT
        COUNT(*) as total_records,
        COALESCE(SUM(CASE WHEN CAST(amount AS REAL) < 0 THEN ABS(CAST(amount AS REAL)) ELSE 0 END), 0) as total_deposits,
        SUM(CASE WHEN CAST(amount AS REAL) < 0 THEN 1 ELSE 0 END) as deposits_count,
        COALESCE(SUM(CASE WHEN CAST(amount AS REAL) > 0 THEN CAST(amount AS REAL) ELSE 0 END), 0) as total_expenses,
        SUM(CASE WHEN CAST(amount AS REAL) > 0 THEN 1 ELSE 0 END) as expenses_count,
        COALESCE(SUM(CAST(amount AS REAL)), 0) as net
      FROM rocketmoney ${where}`,
      params,
    };
  }

  // Rows mode
  const validSortCols = ["date", "amount", "category", "name", "account_name"];
  const sortCol = p.sortBy && validSortCols.includes(p.sortBy) ? p.sortBy : "date";
  const sortDir = p.sortDir || "desc";
  const sortExpr = sortCol === "amount" ? `CAST(amount AS REAL) ${sortDir}` : `${sortCol} ${sortDir}`;

  const limit = p.limit || 50;
  const offset = p.offset || 0;

  return {
    sql: `SELECT * FROM rocketmoney ${where} ORDER BY ${sortExpr} LIMIT ? OFFSET ?`,
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

    // Enrich with display account names and vendor aliases
    // Clear cache each query to pick up new aliases from Settings
    cachedAliases = null;
    const enriched = records.map((r) => {
      const displayName = resolveVendorFromRecord(r.name, r.custom_name, r.description);
      return {
        ...r,
        amount: parseFloat(String(r.amount)),
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
  // Return expense categories from categories.db (Settings → Categories tab)
  // instead of raw RM categories
  try {
    const { getAllExpenseCategories } = require("@/lib/db/config-db");
    const categories = getAllExpenseCategories() as { id: string; name: string }[];
    return categories.map((c) => c.name).sort();
  } catch {
    // Fallback to raw RM categories if categories.db is unavailable
    const db = getDb();
    try {
      const rows = db.prepare(`
        SELECT DISTINCT category FROM rocketmoney
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
      SELECT DISTINCT account_name FROM rocketmoney
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
  const vaDb = getVendorAliasDb();
  try {
    cachedAliases = null;

    // Get ignored vendor names (case-insensitive lookup)
    const ignoredRows = vaDb.prepare("SELECT vendor_name FROM vendor_ignores").all() as { vendor_name: string }[];
    const ignoredNamesLower = new Set(ignoredRows.map((r) => r.vendor_name.toLowerCase()));
    const ignoredNames = new Set(ignoredRows.map((r) => r.vendor_name));

    // Get all alias display names
    const aliases = getVendorAliases();
    const aliasDisplayNames = new Set(aliases.map((a) => a.display_name));

    // Get all unique vendor names from bank data
    const rows = db.prepare(`
      SELECT CASE WHEN custom_name IS NOT NULL AND custom_name != '' THEN custom_name ELSE name END as raw_name,
             COUNT(*) as cnt
      FROM rocketmoney
      WHERE name IS NOT NULL AND name != ''
      GROUP BY raw_name
      ORDER BY cnt DESC
    `).all() as { raw_name: string; cnt: number }[];

    // Resolve and categorize
    const grouped = new Map<string, number>();   // aliased vendors
    const ignored = new Map<string, number>();   // ignored vendors
    const unmatched = new Map<string, number>(); // no alias, not ignored

    for (const r of rows) {
      if (!r.raw_name) continue;
      const display = resolveVendorAlias(r.raw_name) || r.raw_name;

      if (ignoredNames.has(display) || ignoredNames.has(r.raw_name) || ignoredNamesLower.has(display.toLowerCase()) || ignoredNamesLower.has(r.raw_name.toLowerCase())) {
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
    vaDb.close();
  }
}

export function queryBankDateRange() {
  const db = getDb();
  try {
    const row = db.prepare("SELECT MIN(date) as min_date, MAX(date) as max_date FROM rocketmoney").get() as { min_date: string; max_date: string };
    return { min: row.min_date, max: row.max_date };
  } finally {
    db.close();
  }
}
