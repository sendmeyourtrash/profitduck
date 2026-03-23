import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  getAllVendorAliases,
  createVendorAlias,
  updateVendorAlias,
  deleteVendorAlias,
  getAllVendorIgnores,
  createVendorIgnore,
  deleteVendorIgnore,
  getVendorAliasesDb,
} from "@/lib/db/config-db";

/**
 * Re-scan unmatched vendors against all current aliases and ignores.
 * Removes any unmatched vendor that now matches an alias or is ignored.
 */
function cleanupUnmatched() {
  try {
    const db = getVendorAliasesDb();
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='unmatched_vendors'").get();
    if (!tableExists) return;

    const aliases = db.prepare("SELECT pattern, match_type FROM vendor_aliases").all() as { pattern: string; match_type: string }[];
    const ignores = db.prepare("SELECT vendor_name FROM vendor_ignores").all() as { vendor_name: string }[];
    const unmatched = db.prepare("SELECT id, raw_name FROM unmatched_vendors").all() as { id: number; raw_name: string }[];

    const idsToRemove: number[] = [];

    for (const u of unmatched) {
      const name = u.raw_name;
      const nameLower = name.toLowerCase();

      // Check if ignored (case-insensitive)
      if (ignores.some((ig) => ig.vendor_name.toLowerCase() === nameLower)) {
        idsToRemove.push(u.id);
        continue;
      }

      // Check if matches any alias (case-insensitive)
      for (const alias of aliases) {
        let matches = false;
        const patternLower = alias.pattern.toLowerCase();
        if (alias.match_type === "exact") {
          matches = nameLower === patternLower;
        } else if (alias.match_type === "starts_with") {
          matches = nameLower.startsWith(patternLower);
        } else if (alias.match_type === "contains") {
          matches = nameLower.includes(patternLower);
        }
        if (matches) {
          idsToRemove.push(u.id);
          break;
        }
      }
    }

    if (idsToRemove.length > 0) {
      const placeholders = idsToRemove.map(() => "?").join(",");
      db.prepare(`DELETE FROM unmatched_vendors WHERE id IN (${placeholders})`).run(...idsToRemove);
    }
  } catch { /* ignore */ }
}

/**
 * Smart grouping suggestions for unmatched vendors.
 * Priority:
 * 1. Match to existing alias group (e.g. "AMAZON MKTPL*..." → existing "Amazon" alias)
 * 2. Group similar unmatched names together (e.g. multiple "Fine Fare" variants)
 * 3. Solo items get their own suggestion
 */
function getSuggestedGroups() {
  const aliases = getAllVendorAliases();
  const ignored = getAllVendorIgnores();
  const ignoredSet = new Set(ignored.map((i) => i.vendor_name.toLowerCase()));

  // Get all unmatched vendor names from bank.db
  let unmatchedNames: { name: string; count: number; totalAmount: number }[] = [];
  try {
    const Database = require("better-sqlite3");
    const path = require("path");
    const bankDb = new Database(path.join(process.cwd(), "databases", "bank.db"));

    const rows = bankDb.prepare(`
      SELECT COALESCE(NULLIF(custom_name, ''), name) as vendor_name,
             COUNT(*) as cnt,
             ROUND(SUM(CAST(amount AS REAL)), 2) as total_amount
      FROM rocketmoney
      GROUP BY vendor_name
      ORDER BY cnt DESC
    `).all() as { vendor_name: string; cnt: number; total_amount: number }[];

    // Filter to truly unmatched (not aliased, not ignored)
    for (const row of rows) {
      if (!row.vendor_name) continue;
      const nameLower = row.vendor_name.toLowerCase();

      // Skip ignored
      if (ignoredSet.has(nameLower)) continue;

      // Skip if matches any existing alias
      let matched = false;
      for (const alias of aliases) {
        const patLower = alias.pattern.toLowerCase();
        if (alias.match_type === "exact" && nameLower === patLower) { matched = true; break; }
        if (alias.match_type === "starts_with" && nameLower.startsWith(patLower)) { matched = true; break; }
        if (alias.match_type === "contains" && nameLower.includes(patLower)) { matched = true; break; }
      }
      if (matched) continue;

      unmatchedNames.push({ name: row.vendor_name, count: row.cnt, totalAmount: row.total_amount });
    }

    bankDb.close();
  } catch (e) {
    console.error("Suggest groups error:", e);
  }

  // --- Step 1: Check if unmatched names could fit into existing alias groups ---
  interface Suggestion {
    type: "existing_group" | "new_group" | "solo";
    groupName: string;
    suggestedPattern?: string;
    suggestedMatchType?: string;
    existingAliasId?: string;
    members: { name: string; count: number; totalAmount: number }[];
    totalCount: number;
    totalAmount: number;
  }

  const suggestions: Suggestion[] = [];
  const claimed = new Set<string>(); // track which unmatched names are already suggested

  // Check each alias — would any unmatched names match if a broader version of the pattern were applied?
  for (const alias of aliases) {
    const displayLower = alias.display_name.toLowerCase();
    const patLower = alias.pattern.toLowerCase();
    const potentialMembers: typeof unmatchedNames = [];

    for (const u of unmatchedNames) {
      if (claimed.has(u.name)) continue;
      const uLower = u.name.toLowerCase();

      // Only match if the unmatched name contains the alias display name or pattern
      // This is strict — "Amazon" matches "AMAZON MKTPL*..." but not "Fairway" matching "Fine Fare"
      if (uLower.includes(displayLower) || uLower.includes(patLower)) {
        potentialMembers.push(u);
      }
    }

    if (potentialMembers.length > 0) {
      suggestions.push({
        type: "existing_group",
        groupName: alias.display_name,
        existingAliasId: alias.id,
        suggestedPattern: alias.pattern,
        suggestedMatchType: alias.match_type,
        members: potentialMembers,
        totalCount: potentialMembers.reduce((s, m) => s + m.count, 0),
        totalAmount: potentialMembers.reduce((s, m) => s + m.totalAmount, 0),
      });
      potentialMembers.forEach((m) => claimed.add(m.name));
    }
  }

  // --- Step 2: Group remaining unmatched by shared keywords ---
  const remaining = unmatchedNames.filter((u) => !claimed.has(u.name));

  // Extract significant words from each name
  const wordIndex = new Map<string, string[]>(); // word → [names that contain it]
  for (const u of remaining) {
    const words = u.name.toLowerCase()
      .replace(/orig co name:/gi, "")
      .replace(/orig id:\S+/gi, "")
      .replace(/desc date:\S*/gi, "")
      .replace(/co entry descr:/gi, "")
      .replace(/sec:\S+/gi, "")
      .replace(/trace#:\S+/gi, "")
      .replace(/eed:\S+/gi, "")
      .replace(/ind id:\S+/gi, "")
      .replace(/ind name:/gi, "")
      .replace(/trn:\s*\S+/gi, "")
      .replace(/payment to chase card ending in \d+/gi, "cc_payment")
      .split(/[\s\-_*:,#|]+/)
      .filter((w) => w.length > 3)
      .filter((w) => !["orig", "name", "desc", "date", "entry", "descr", "trace", "auto"].includes(w));

    for (const word of words) {
      if (!wordIndex.has(word)) wordIndex.set(word, []);
      wordIndex.get(word)!.push(u.name);
    }
  }

  // Find words that group multiple names
  const groupedByWord = new Map<string, Set<string>>();
  for (const [word, names] of wordIndex) {
    if (names.length >= 2) {
      const key = word;
      if (!groupedByWord.has(key)) groupedByWord.set(key, new Set());
      names.forEach((n) => groupedByWord.get(key)!.add(n));
    }
  }

  // Merge overlapping groups — if two word groups share >50% members, merge them
  const usedInGroup = new Set<string>();
  const sortedGroups = [...groupedByWord.entries()].sort((a, b) => b[1].size - a[1].size);

  for (const [word, nameSet] of sortedGroups) {
    const newMembers = [...nameSet].filter((n) => !usedInGroup.has(n));
    if (newMembers.length < 2) continue;

    const members = newMembers.map((n) => remaining.find((u) => u.name === n)!).filter(Boolean);
    if (members.length < 2) continue;

    // Suggest display name from the keyword
    const displayName = word.charAt(0).toUpperCase() + word.slice(1);

    suggestions.push({
      type: "new_group",
      groupName: displayName,
      suggestedPattern: word,
      suggestedMatchType: "contains",
      members,
      totalCount: members.reduce((s, m) => s + m.count, 0),
      totalAmount: members.reduce((s, m) => s + m.totalAmount, 0),
    });

    newMembers.forEach((n) => { usedInGroup.add(n); claimed.add(n); });
  }

  // --- Step 3: Solo items ---
  const solos = remaining.filter((u) => !claimed.has(u.name));
  for (const u of solos) {
    // Clean up the display name for suggestion
    let suggestedName = u.name
      .replace(/ORIG CO NAME:/gi, "")
      .replace(/\s*ORIG ID:\S+/gi, "")
      .replace(/\s*DESC DATE:\S*/gi, "")
      .replace(/\s*CO ENTRY DESCR:\S+/gi, "")
      .replace(/\s*-SEC:\S+/gi, "")
      .replace(/\s*TRACE#:\S+/gi, "")
      .replace(/\s*EED:\S+/gi, "")
      .replace(/\s*IND ID:\S+/gi, "")
      .replace(/\s*IND NAME:.*/gi, "")
      .replace(/\s*TRN:\s*\S+/gi, "")
      .replace(/[*]+$/, "")
      .trim();

    if (!suggestedName) suggestedName = u.name.slice(0, 30);

    suggestions.push({
      type: "solo",
      groupName: suggestedName,
      suggestedPattern: u.name,
      suggestedMatchType: "exact",
      members: [u],
      totalCount: u.count,
      totalAmount: u.totalAmount,
    });
  }

  // Sort: existing groups first, then new groups by size, then solos
  suggestions.sort((a, b) => {
    const typeOrder = { existing_group: 0, new_group: 1, solo: 2 };
    if (typeOrder[a.type] !== typeOrder[b.type]) return typeOrder[a.type] - typeOrder[b.type];
    return b.totalCount - a.totalCount;
  });

  return NextResponse.json({
    suggestions,
    totalUnmatched: unmatchedNames.length,
    existingGroupCount: suggestions.filter((s) => s.type === "existing_group").length,
    newGroupCount: suggestions.filter((s) => s.type === "new_group").length,
    soloCount: suggestions.filter((s) => s.type === "solo").length,
  });
}

/**
 * GET /api/vendor-aliases
 * Returns all aliases + ignored vendors + unmatched vendors from bank data.
 * ?action=suggest-groups — returns smart grouping suggestions for unmatched vendors.
 * Reads from vendor-aliases.db + bank.db.
 */
export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action");
  if (action === "suggest-groups") {
    return getSuggestedGroups();
  }
  const aliases = getAllVendorAliases();
  const ignored = getAllVendorIgnores();

  // Get unmatched vendors (auto-populated by Step 1 during RM import)
  let unmatched: { raw_name: string; count: number; first_seen: string; last_seen: string }[] = [];
  try {
    const db = getVendorAliasesDb();
    // Check if table exists
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='unmatched_vendors'").get();
    if (tableExists) {
      unmatched = db.prepare("SELECT raw_name, count, first_seen, last_seen FROM unmatched_vendors ORDER BY count DESC").all() as typeof unmatched;
    }
  } catch {
    // Table might not exist yet
  }

  // --- Conflict Detection ---
  // Get all vendor names from bank.db for matching simulation
  let allVendorNames: string[] = [];
  try {
    const Database = require("better-sqlite3");
    const path = require("path");
    const bankDb = new Database(path.join(process.cwd(), "databases", "bank.db"));
    const rows = bankDb.prepare(`
      SELECT DISTINCT COALESCE(NULLIF(custom_name, ''), name) as vendor_name
      FROM rocketmoney
      WHERE vendor_name IS NOT NULL AND vendor_name != ''
    `).all() as { vendor_name: string }[];
    allVendorNames = rows.map(r => r.vendor_name);
    bankDb.close();
  } catch { /* bank.db may not exist */ }

  function matchesAlias(name: string, pattern: string, matchType: string): boolean {
    const lower = name.toLowerCase().trim();
    const lowerPat = pattern.toLowerCase().trim();
    if (matchType === "exact") return lower === lowerPat;
    if (matchType === "starts_with") return lower.startsWith(lowerPat);
    if (matchType === "contains") return lower.includes(lowerPat);
    return false;
  }

  // Track which aliases match each vendor
  const vendorMatches = new Map<string, { aliasIds: string[]; displayNames: string[] }>();
  const aliasMatchMap = new Map<string, string[]>();

  for (const alias of aliases) {
    const matched: string[] = [];
    for (const name of allVendorNames) {
      if (matchesAlias(name, alias.pattern, alias.match_type)) {
        matched.push(name);
        const existing = vendorMatches.get(name) || { aliasIds: [], displayNames: [] };
        existing.aliasIds.push(alias.id);
        existing.displayNames.push(alias.display_name);
        vendorMatches.set(name, existing);
      }
    }
    aliasMatchMap.set(alias.id, matched);
  }

  // --- Conflict Detection: vendors matched by multiple groups ---
  interface Warning {
    type: "conflict";
    severity: "error";
    aliasId: string;
    aliasPattern: string;
    aliasMatchType: string;
    aliasDisplayName: string;
    message: string;
    affectedItems: string[];
  }
  const warnings: Warning[] = [];

  for (const [vendorName, match] of vendorMatches) {
    const uniqueDisplayNames = [...new Set(match.displayNames)];
    if (uniqueDisplayNames.length > 1) {
      for (let i = 0; i < match.aliasIds.length; i++) {
        const alias = aliases.find(a => a.id === match.aliasIds[i]);
        if (!alias) continue;
        warnings.push({
          type: "conflict",
          severity: "error",
          aliasId: alias.id,
          aliasPattern: alias.pattern,
          aliasMatchType: alias.match_type,
          aliasDisplayName: alias.display_name,
          message: `"${vendorName}" matches this rule but also matches another rule that maps to "${uniqueDisplayNames.find(d => d !== alias.display_name)}"`,
          affectedItems: [vendorName],
        });
      }
    }
  }

  // Deduplicate warnings by aliasId
  const seenWarnings = new Map<string, Warning>();
  for (const w of warnings) {
    const key = `${w.aliasId}-${w.type}`;
    if (!seenWarnings.has(key)) {
      seenWarnings.set(key, w);
    }
  }

  return NextResponse.json({
    aliases: aliases.map((a) => ({
      id: a.id,
      pattern: a.pattern,
      matchType: a.match_type,
      displayName: a.display_name,
      autoCreated: a.auto_created === 1,
      createdAt: a.created_at,
      matchCount: (aliasMatchMap.get(a.id) || []).length,
    })),
    matchedCount: aliases.length,
    unmatchedCount: unmatched.length,
    warnings: [...seenWarnings.values()],
    unmatched: (() => {
      // Enrich unmatched vendors with expense count and total from bank.db
      try {
        const Database = require("better-sqlite3");
        const path = require("path");
        const bankDb = new Database(path.join(process.cwd(), "databases", "bank.db"));

        const result = unmatched.map((u) => {
          const row = bankDb.prepare(`
            SELECT COUNT(*) as cnt, COALESCE(ROUND(SUM(CAST(amount AS REAL)), 2), 0) as total
            FROM rocketmoney
            WHERE COALESCE(NULLIF(custom_name, ''), name) = ?
          `).get(u.raw_name) as { cnt: number; total: number } | undefined;

          return {
            name: u.raw_name,
            count: u.count,
            expenseCount: row?.cnt || u.count,
            totalSpent: row?.total || 0,
            firstSeen: u.first_seen,
            lastSeen: u.last_seen,
          };
        });

        bankDb.close();
        return result;
      } catch {
        return unmatched.map((u) => ({
          name: u.raw_name,
          count: u.count,
          expenseCount: u.count,
          totalSpent: 0,
          firstSeen: u.first_seen,
          lastSeen: u.last_seen,
        }));
      }
    })(),
    ignoredCount: ignored.length,
    ignored: (() => {
      try {
        const Database = require("better-sqlite3");
        const path = require("path");
        const bankDb = new Database(path.join(process.cwd(), "databases", "bank.db"));
        const allAliases = getAllVendorAliases();

        const result = ignored.map((i) => {
          // Check if this ignored name matches any alias pattern to get the right raw names
          const row = bankDb.prepare(`
            SELECT COUNT(*) as cnt, COALESCE(ROUND(SUM(CAST(amount AS REAL)), 2), 0) as total
            FROM rocketmoney
            WHERE COALESCE(NULLIF(custom_name, ''), name) LIKE ?
          `).get(`%${i.vendor_name}%`) as { cnt: number; total: number } | undefined;

          return {
            id: i.id,
            name: i.vendor_name,
            expenseCount: row?.cnt || 0,
            totalSpent: row?.total || 0,
          };
        });

        bankDb.close();
        return result;
      } catch {
        return ignored.map((i) => ({
          id: i.id,
          name: i.vendor_name,
          expenseCount: 0,
          totalSpent: 0,
        }));
      }
    })(),
  });
}

/**
 * POST /api/vendor-aliases
 * Create a new alias, or action: "ignore" / "unignore".
 */
export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.action === "ignore") {
    const { vendorName } = body;
    if (!vendorName) {
      return NextResponse.json({ error: "vendorName is required" }, { status: 400 });
    }
    createVendorIgnore(uuidv4(), vendorName);
    cleanupUnmatched();
    return NextResponse.json({ ignored: true });
  }

  if (body.action === "unignore") {
    const { vendorName } = body;
    if (!vendorName) {
      return NextResponse.json({ error: "vendorName is required" }, { status: 400 });
    }
    deleteVendorIgnore(vendorName);
    // Add back to unmatched list so it shows up for aliasing
    try {
      const db = getVendorAliasesDb();
      const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='unmatched_vendors'").get();
      if (tableExists) {
        const exists = db.prepare("SELECT 1 FROM unmatched_vendors WHERE raw_name = ?").get(vendorName);
        if (!exists) {
          // Get count from bank.db
          let count = 1;
          try {
            const Database = require("better-sqlite3");
            const path = require("path");
            const bankDb = new Database(path.join(process.cwd(), "databases", "bank.db"));
            const row = bankDb.prepare("SELECT COUNT(*) as cnt FROM rocketmoney WHERE name = ?").get(vendorName) as { cnt: number } | undefined;
            if (row) count = row.cnt;
            bankDb.close();
          } catch { /* fallback to count=1 */ }
          db.prepare("INSERT INTO unmatched_vendors (raw_name, count) VALUES (?, ?)").run(vendorName, count);
        }
      }
    } catch { /* ignore */ }
    return NextResponse.json({ unignored: true });
  }

  if (body.action === "apply" || body.action === "seed") {
    return NextResponse.json({ applied: true });
  }

  // Create new alias
  const { pattern, matchType, displayName } = body;
  if (!pattern || !matchType || !displayName) {
    return NextResponse.json(
      { error: "pattern, matchType, and displayName are required" },
      { status: 400 }
    );
  }

  const id = uuidv4();
  createVendorAlias(id, pattern, matchType, displayName);
  deleteVendorIgnore(pattern);
  cleanupUnmatched();

  return NextResponse.json({
    alias: { id, pattern, matchType, displayName, autoCreated: false },
  });
}

/**
 * PATCH /api/vendor-aliases
 */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, pattern, matchType, displayName } = body;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  updateVendorAlias(id, {
    pattern,
    match_type: matchType,
    display_name: displayName,
  });
  cleanupUnmatched();

  return NextResponse.json({ alias: { id, pattern, matchType, displayName } });
}

/**
 * DELETE /api/vendor-aliases?id=<id>
 */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  deleteVendorAlias(id);
  cleanupUnmatched();
  return NextResponse.json({ deleted: true });
}
