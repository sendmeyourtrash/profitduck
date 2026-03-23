import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
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

/**
 * Scan Square items from sales.db to extract unique item names with totals.
 */
function getUniqueItems() {
  const db = getSalesDb();
  const rows = db.prepare(`
    SELECT TRIM(item_name) as item, SUM(qty) as total_qty, SUM(net_sales) as total_revenue
    FROM order_items
    WHERE item_name IS NOT NULL AND TRIM(item_name) != '' AND qty > 0 AND event_type = 'Payment'
      AND platform = 'square'
    GROUP BY TRIM(item_name)
    ORDER BY total_qty DESC
  `).all() as { item: string; total_qty: number; total_revenue: number }[];

  return rows.map((r) => ({ name: r.item.trim(), qty: r.total_qty, revenue: r.total_revenue }));
}

/**
 * GET /api/menu-item-aliases
 * Returns all aliases + unmatched items summary + ignored items.
 * Now reads from categories.db and sales.db.
 */
export async function GET() {
  const aliases = getAllMenuItemAliases();
  const ignored = getAllMenuItemIgnores();

  const ignoredNames = new Set(ignored.map((r) => r.item_name.toLowerCase()));

  const allItems = getUniqueItems();

  // Simulate alias matching (same logic as pipeline-step3-aliases.ts)
  // For each item, find ALL aliases that would match it
  function matchesAlias(itemName: string, pattern: string, matchType: string): boolean {
    const lower = itemName.toLowerCase().trim();
    const lowerPat = pattern.toLowerCase().trim();
    if (matchType === "exact") return lower === lowerPat;
    if (matchType === "starts_with") return lower.startsWith(lowerPat);
    if (matchType === "contains") return lower.includes(lowerPat);
    return false;
  }

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

  for (const item of allItems) {
    if (itemMatches.has(item.name)) {
      matchedCount++;
    } else if (ignoredNames.has(item.name.toLowerCase())) {
      ignoredItems.push(item);
    } else {
      unmatchedItems.push(item);
    }
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
    totalItems: allItems.length,
    matchedCount,
    unmatchedCount: unmatchedItems.length,
    unmatched: unmatchedItems,
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

  const { pattern, matchType, displayName } = body;
  if (!pattern || !matchType || !displayName) {
    return NextResponse.json({ error: "pattern, matchType, and displayName are required" }, { status: 400 });
  }

  const id = uuidv4();
  createMenuItemAlias(id, pattern, matchType, displayName);
  deleteMenuItemIgnore(pattern);
  step3ApplyAliases();

  return NextResponse.json({ alias: { id, pattern, matchType, displayName } });
}

/**
 * PATCH /api/menu-item-aliases
 */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, pattern, matchType, displayName } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  updateMenuItemAlias(id, { pattern, match_type: matchType, display_name: displayName });
  step3ApplyAliases();
  return NextResponse.json({ alias: { id, pattern, matchType, displayName } });
}

/**
 * DELETE /api/menu-item-aliases?id=<id>
 */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  deleteMenuItemAlias(id);
  step3ApplyAliases();
  return NextResponse.json({ deleted: true });
}
