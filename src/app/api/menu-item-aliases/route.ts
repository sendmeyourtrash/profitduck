import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import Database from "better-sqlite3";
import path from "path";
import {
  getAllMenuItemAliases,
  createMenuItemAlias,
  updateMenuItemAlias,
  deleteMenuItemAlias,
  getAllMenuItemIgnores,
  createMenuItemIgnore,
  deleteMenuItemIgnore,
} from "@/lib/db/config-db";
import { getSalesDb } from "@/lib/db/sales-db";
import { step3ApplyAliases } from "@/lib/services/pipeline-step3-aliases";
import { bigramSimilarity } from "@/lib/utils/string-similarity";

const DB_DIR = path.join(process.cwd(), "databases");

/**
 * Targeted alias apply — updates only affected rows instead of full step3.
 * For alias add/edit: apply one alias rule to matching items.
 * For alias delete: reset affected items, then re-apply all remaining aliases to them.
 * For group rename: just update display_name where it matches old name.
 */
function applyOneAlias(pattern: string, matchType: string, displayName: string) {
  const salesDb = new Database(path.join(DB_DIR, "sales.db"));
  try {
    if (matchType === "exact") {
      salesDb.prepare("UPDATE order_items SET display_name = ? WHERE TRIM(item_name) = ? COLLATE NOCASE").run(displayName, pattern);
    } else if (matchType === "starts_with") {
      salesDb.prepare("UPDATE order_items SET display_name = ? WHERE TRIM(item_name) LIKE ? COLLATE NOCASE").run(displayName, `${pattern}%`);
    } else if (matchType === "contains") {
      salesDb.prepare("UPDATE order_items SET display_name = ? WHERE TRIM(item_name) LIKE ? COLLATE NOCASE").run(displayName, `%${pattern}%`);
    }
    // Update denormalized display_categories on orders
    salesDb.prepare(`
      UPDATE orders SET display_categories = (
        SELECT GROUP_CONCAT(DISTINCT oi.display_category)
        FROM order_items oi
        WHERE oi.order_id = orders.order_id AND oi.platform = orders.platform
        AND oi.display_category IS NOT NULL AND oi.display_category != ''
      )
    `).run();
  } finally {
    salesDb.close();
  }
}

function resetAndReapply(pattern: string, matchType: string) {
  const salesDb = new Database(path.join(DB_DIR, "sales.db"));
  const catDb = new Database(path.join(DB_DIR, "categories.db"), { readonly: true });
  try {
    // Reset affected items back to raw name
    if (matchType === "exact") {
      salesDb.prepare("UPDATE order_items SET display_name = TRIM(item_name) WHERE TRIM(item_name) = ? COLLATE NOCASE").run(pattern);
    } else if (matchType === "starts_with") {
      salesDb.prepare("UPDATE order_items SET display_name = TRIM(item_name) WHERE TRIM(item_name) LIKE ? COLLATE NOCASE").run(`${pattern}%`);
    } else if (matchType === "contains") {
      salesDb.prepare("UPDATE order_items SET display_name = TRIM(item_name) WHERE TRIM(item_name) LIKE ? COLLATE NOCASE").run(`%${pattern}%`);
    }
    // Re-apply remaining aliases to those items (another alias might still cover them)
    const aliases = catDb.prepare("SELECT pattern, match_type, display_name FROM menu_item_aliases").all() as { pattern: string; match_type: string; display_name: string }[];
    for (const a of aliases) {
      const p = a.pattern.trim();
      const d = a.display_name.trim();
      if (a.match_type === "exact") {
        salesDb.prepare("UPDATE order_items SET display_name = ? WHERE TRIM(item_name) = ? COLLATE NOCASE AND display_name = TRIM(item_name)").run(d, p);
      } else if (a.match_type === "starts_with") {
        salesDb.prepare("UPDATE order_items SET display_name = ? WHERE TRIM(item_name) LIKE ? COLLATE NOCASE AND display_name = TRIM(item_name)").run(d, `${p}%`);
      } else if (a.match_type === "contains") {
        salesDb.prepare("UPDATE order_items SET display_name = ? WHERE TRIM(item_name) LIKE ? COLLATE NOCASE AND display_name = TRIM(item_name)").run(d, `%${p}%`);
      }
    }
    salesDb.prepare(`
      UPDATE orders SET display_categories = (
        SELECT GROUP_CONCAT(DISTINCT oi.display_category)
        FROM order_items oi
        WHERE oi.order_id = orders.order_id AND oi.platform = orders.platform
        AND oi.display_category IS NOT NULL AND oi.display_category != ''
      )
    `).run();
  } finally {
    salesDb.close();
    catDb.close();
  }
}

function renameDisplayName(oldName: string, newName: string) {
  const salesDb = new Database(path.join(DB_DIR, "sales.db"));
  try {
    salesDb.prepare("UPDATE order_items SET display_name = ? WHERE display_name = ? COLLATE NOCASE").run(newName, oldName);
    salesDb.prepare(`
      UPDATE orders SET display_categories = (
        SELECT GROUP_CONCAT(DISTINCT oi.display_category)
        FROM order_items oi
        WHERE oi.order_id = orders.order_id AND oi.platform = orders.platform
        AND oi.display_category IS NOT NULL AND oi.display_category != ''
      )
    `).run();
  } finally {
    salesDb.close();
  }
}

/**
 * Scan Square items from sales.db to extract unique item names with totals.
 */
function getUniqueItems() {
  const db = getSalesDb();
  const rows = db.prepare(`
    SELECT TRIM(item_name) as item, SUM(qty) as total_qty, SUM(net_sales) as total_revenue
    FROM order_items
    WHERE item_name IS NOT NULL AND TRIM(item_name) != '' AND event_type = 'Payment'
      AND item_name NOT LIKE '% Order'
    GROUP BY TRIM(item_name)
    ORDER BY total_qty DESC
  `).all() as { item: string; total_qty: number; total_revenue: number }[];

  return rows.map((r) => ({ name: r.item.trim(), qty: r.total_qty, revenue: r.total_revenue }));
}

// Simulate alias matching (same logic as pipeline-step3-aliases.ts)
function matchesAlias(itemName: string, pattern: string, matchType: string): boolean {
  const lower = itemName.toLowerCase().trim();
  const lowerPat = pattern.toLowerCase().trim();
  if (matchType === "exact") return lower === lowerPat;
  if (matchType === "starts_with") return lower.startsWith(lowerPat);
  if (matchType === "contains") return lower.includes(lowerPat);
  return false;
}

/**
 * GET /api/menu-item-aliases
 * Returns all aliases + unmatched items summary + ignored items.
 * Now reads from categories.db and sales.db.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const isPreview = url.searchParams.get("preview") === "1";
  const previewPattern = url.searchParams.get("pattern") || "";
  const previewMatchType = url.searchParams.get("matchType") || "exact";

  if (isPreview && previewPattern) {
    const allItems = getUniqueItems();
    const aliases = getAllMenuItemAliases();
    const matches = allItems.filter(item => matchesAlias(item.name, previewPattern, previewMatchType)).map(item => {
      // Check if already matched by existing alias
      let alreadyMatched = false;
      let existingGroup: string | undefined;
      for (const alias of aliases) {
        if (matchesAlias(item.name, alias.pattern, alias.match_type)) {
          alreadyMatched = true;
          existingGroup = alias.display_name;
          break;
        }
      }
      return { name: item.name, qty: item.qty, alreadyMatched, existingGroup };
    });
    return NextResponse.json({ matches });
  }

  const aliases = getAllMenuItemAliases();
  const ignored = getAllMenuItemIgnores();

  const ignoredNames = new Set(ignored.map((r) => r.item_name.toLowerCase()));

  const allItems = getUniqueItems();

  // Track which aliases match each item
  const itemMatches = new Map<string, { aliasIds: string[]; displayNames: string[] }>();
  // Track which items each alias matches
  const aliasMatches = new Map<string, string[]>();

  for (const alias of aliases) {
    const matched: string[] = [];
    for (const item of allItems) {
      if (matchesAlias(item.name, alias.pattern, alias.match_type)) {
        matched.push(item.name);
        const existing = itemMatches.get(item.name) || { aliasIds: [], displayNames: [] };
        existing.aliasIds.push(alias.id);
        existing.displayNames.push(alias.display_name);
        itemMatches.set(item.name, existing);
      }
    }
    aliasMatches.set(alias.id, matched);
  }

  let matchedCount = 0;
  const unmatchedItems: { name: string; qty: number; revenue: number }[] = [];
  const ignoredItems: { name: string; qty: number; revenue: number }[] = [];
  const ignoredSeen = new Set<string>();

  for (const item of allItems) {
    if (itemMatches.has(item.name)) {
      matchedCount++;
    } else if (ignoredNames.has(item.name.toLowerCase())) {
      ignoredItems.push(item);
      ignoredSeen.add(item.name.toLowerCase());
    } else {
      unmatchedItems.push(item);
    }
  }

  // Include ignored items that have no sales data so they still appear in the UI
  for (const ign of ignored) {
    if (!ignoredSeen.has(ign.item_name.toLowerCase())) {
      ignoredItems.push({ name: ign.item_name, qty: 0, revenue: 0 });
    }
  }

  // Compute suggestions for unmatched items
  const aliasGroupNames = [...new Set(aliases.map(a => a.display_name))];
  function computeSuggestions(itemName: string) {
    const scored: { displayName: string; score: number }[] = [];
    for (const groupName of aliasGroupNames) {
      const score = bigramSimilarity(itemName, groupName);
      if (score > 0.3) scored.push({ displayName: groupName, score });
    }
    // Also check against alias patterns
    for (const alias of aliases) {
      const score = bigramSimilarity(itemName, alias.pattern);
      if (score > 0.3) {
        const existing = scored.find(s => s.displayName === alias.display_name);
        if (existing) {
          existing.score = Math.max(existing.score, score);
        } else {
          scored.push({ displayName: alias.display_name, score });
        }
      }
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, 2);
  }

  // --- Conflict Detection: items matched by multiple groups ---
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

  for (const [itemName, match] of itemMatches) {
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
          message: `"${itemName}" matches this rule but also matches another rule that maps to "${uniqueDisplayNames.find(d => d !== alias.display_name)}"`,
          affectedItems: [itemName],
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

  // Compute group-level stats (qty + revenue per display_name)
  const groupStats = new Map<string, { qty: number; revenue: number }>();
  for (const item of allItems) {
    const match = itemMatches.get(item.name);
    if (match && match.displayNames.length > 0) {
      const groupName = match.displayNames[0]; // Use first (winning) alias
      const existing = groupStats.get(groupName) || { qty: 0, revenue: 0 };
      existing.qty += item.qty;
      existing.revenue += item.revenue;
      groupStats.set(groupName, existing);
    }
  }

  return NextResponse.json({
    aliases: aliases.map((a) => ({
      id: a.id,
      pattern: a.pattern,
      matchType: a.match_type,
      displayName: a.display_name,
      createdAt: a.created_at,
      matchCount: (aliasMatches.get(a.id) || []).length,
      matchedItems: (aliasMatches.get(a.id) || []).slice(0, 20),
    })),
    groupStats: Object.fromEntries(groupStats),
    totalItems: allItems.length,
    matchedCount,
    unmatchedCount: unmatchedItems.length,
    unmatched: unmatchedItems.map(item => ({
      ...item,
      suggestions: computeSuggestions(item.name),
    })),
    ignoredCount: ignoredItems.length,
    ignored: ignoredItems,
    warnings: [...seenWarnings.values()],
  });
}

/**
 * POST /api/menu-item-aliases
 */
export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.action === "ignore") {
    const { itemName } = body;
    if (!itemName) return NextResponse.json({ error: "itemName is required" }, { status: 400 });
    createMenuItemIgnore(uuidv4(), itemName);
    return NextResponse.json({ ignored: true });
  }

  if (body.action === "unignore") {
    const { itemName } = body;
    if (!itemName) return NextResponse.json({ error: "itemName is required" }, { status: 400 });
    deleteMenuItemIgnore(itemName);
    return NextResponse.json({ unignored: true });
  }

  if (body.action === "delete-group") {
    const { displayName: groupName } = body;
    if (!groupName) return NextResponse.json({ error: "displayName required" }, { status: 400 });
    const all = getAllMenuItemAliases();
    const toDelete = all.filter((a) => a.display_name === groupName);
    // Reset and reapply for each deleted alias pattern
    for (const alias of toDelete) {
      deleteMenuItemAlias(alias.id);
      resetAndReapply(alias.pattern, alias.match_type);
    }
    return NextResponse.json({ deleted: toDelete.length });
  }

  if (body.action === "rename-group") {
    const { oldName, newName } = body;
    if (!oldName || !newName) return NextResponse.json({ error: "oldName and newName required" }, { status: 400 });
    const all = getAllMenuItemAliases();
    const toUpdate = all.filter((a) => a.display_name === oldName);
    for (const alias of toUpdate) updateMenuItemAlias(alias.id, { display_name: newName });
    renameDisplayName(oldName, newName);
    return NextResponse.json({ renamed: toUpdate.length });
  }

  const { pattern, matchType, displayName } = body;
  if (!pattern || !matchType || !displayName) {
    return NextResponse.json({ error: "pattern, matchType, and displayName are required" }, { status: 400 });
  }

  const id = uuidv4();
  createMenuItemAlias(id, pattern, matchType, displayName);
  deleteMenuItemIgnore(pattern);
  applyOneAlias(pattern, matchType, displayName);

  return NextResponse.json({ alias: { id, pattern, matchType, displayName } });
}

/**
 * PATCH /api/menu-item-aliases
 */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, pattern, matchType, displayName } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Get old alias to reset its affected items first
  const oldAlias = getAllMenuItemAliases().find((a) => a.id === id);
  updateMenuItemAlias(id, { pattern, match_type: matchType, display_name: displayName });
  if (oldAlias) {
    resetAndReapply(oldAlias.pattern, oldAlias.match_type);
  }
  applyOneAlias(pattern, matchType, displayName);
  return NextResponse.json({ alias: { id, pattern, matchType, displayName } });
}

/**
 * DELETE /api/menu-item-aliases?id=<id>
 */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const alias = getAllMenuItemAliases().find((a) => a.id === id);
  deleteMenuItemAlias(id);
  if (alias) {
    resetAndReapply(alias.pattern, alias.match_type);
  }
  return NextResponse.json({ deleted: true });
}
