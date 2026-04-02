/**
 * Menu Modifiers API — reads modifier data from sales.db order_items.
 * Splits comma-separated modifier strings and aggregates usage stats.
 * Now also supports alias management (CRUD) via config-db.
 */
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getSalesDb } from "@/lib/db/sales-db";
import {
  getAllMenuModifierAliases,
  createMenuModifierAlias,
  updateMenuModifierAlias,
  deleteMenuModifierAlias,
  getAllMenuModifierIgnores,
  createMenuModifierIgnore,
  deleteMenuModifierIgnore,
} from "@/lib/db/sales-db";
import { bigramSimilarity } from "@/lib/utils/string-similarity";

// Simulate alias matching (same logic as item/category aliases)
function matchesAlias(name: string, pattern: string, matchType: string): boolean {
  const lower = name.toLowerCase().trim();
  const lowerPat = pattern.toLowerCase().trim();
  if (matchType === "exact") return lower === lowerPat;
  if (matchType === "starts_with") return lower.startsWith(lowerPat);
  if (matchType === "contains") return lower.includes(lowerPat);
  return false;
}

/**
 * Build aggregate modifier data from sales.db.
 */
function getModifierData() {
  const salesDb = getSalesDb();

  // Get all modifier strings with their item context
  const rows = salesDb.prepare(
    `SELECT item_name, display_name, modifiers, COUNT(*) as cnt,
            ROUND(SUM(gross_sales), 2) as revenue
     FROM order_items
     WHERE length(modifiers) > 0 AND event_type = 'Payment'
     GROUP BY item_name, modifiers
     ORDER BY cnt DESC`
  ).all() as {
    item_name: string; display_name: string; modifiers: string;
    cnt: number; revenue: number;
  }[];

  // Split and aggregate individual modifiers
  const modifierMap = new Map<string, {
    count: number;
    revenue: number;
    items: Map<string, number>;
  }>();

  for (const row of rows) {
    const mods = row.modifiers.split(",").map((m: string) => m.trim()).filter(Boolean);
    for (const mod of mods) {
      const existing = modifierMap.get(mod);
      const itemName = row.display_name || row.item_name;
      if (existing) {
        existing.count += row.cnt;
        existing.revenue += row.revenue;
        existing.items.set(itemName, (existing.items.get(itemName) || 0) + row.cnt);
      } else {
        const items = new Map<string, number>();
        items.set(itemName, row.cnt);
        modifierMap.set(mod, { count: row.cnt, revenue: row.revenue, items });
      }
    }
  }

  // Build response
  const modifiers = [...modifierMap.entries()]
    .map(([name, data]) => ({
      name,
      count: data.count,
      revenue: Math.round(data.revenue * 100) / 100,
      itemCount: data.items.size,
      topItems: [...data.items.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([item, count]) => ({ item, count })),
    }))
    .sort((a, b) => b.count - a.count);

  // Summary stats
  const totalWithMods = salesDb.prepare(
    `SELECT COUNT(*) as cnt FROM order_items WHERE length(modifiers) > 0 AND event_type = 'Payment'`
  ).get() as { cnt: number };
  const totalItems = salesDb.prepare(
    `SELECT COUNT(*) as cnt FROM order_items WHERE event_type = 'Payment'`
  ).get() as { cnt: number };

  // Top modifier combos (full strings, not split)
  const topCombos = salesDb.prepare(
    `SELECT modifiers, COUNT(*) as cnt, display_name as item
     FROM order_items
     WHERE length(modifiers) > 0 AND event_type = 'Payment'
     GROUP BY modifiers, display_name
     ORDER BY cnt DESC
     LIMIT 15`
  ).all() as { modifiers: string; cnt: number; item: string }[];

  return {
    modifiers,
    totalModifiers: modifiers.length,
    totalItemsWithMods: totalWithMods.cnt,
    totalItems: totalItems.cnt,
    modifierRate: totalItems.cnt > 0
      ? Math.round((totalWithMods.cnt / totalItems.cnt) * 1000) / 10
      : 0,
    topCombos: topCombos.map((c) => ({
      combo: c.modifiers,
      item: c.item,
      count: c.cnt,
    })),
  };
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const isPreview = url.searchParams.get("preview") === "1";
  const previewPattern = url.searchParams.get("pattern") || "";
  const previewMatchType = url.searchParams.get("matchType") || "exact";

  if (isPreview && previewPattern) {
    const { modifiers: allModifiers } = getModifierData();
    const aliases = getAllMenuModifierAliases();
    const matches = allModifiers
      .filter(mod => matchesAlias(mod.name, previewPattern, previewMatchType))
      .map(mod => {
        // Check if already matched by existing alias
        let alreadyMatched = false;
        let existingGroup: string | undefined;
        for (const alias of aliases) {
          if (matchesAlias(mod.name, alias.pattern, alias.match_type)) {
            alreadyMatched = true;
            existingGroup = alias.display_name;
            break;
          }
        }
        return { name: mod.name, qty: mod.count, alreadyMatched, existingGroup };
      });
    return NextResponse.json({ matches });
  }

  // Full response: aggregate stats + alias management data
  const aggregateData = getModifierData();
  const aliases = getAllMenuModifierAliases();
  const ignored = getAllMenuModifierIgnores();
  const ignoredNames = new Set(ignored.map(r => r.modifier_name.toLowerCase()));

  // Track which aliases match each modifier
  const modMatches = new Map<string, { aliasIds: string[]; displayNames: string[] }>();
  const aliasMatches = new Map<string, string[]>();

  for (const alias of aliases) {
    const matched: string[] = [];
    for (const mod of aggregateData.modifiers) {
      if (matchesAlias(mod.name, alias.pattern, alias.match_type)) {
        matched.push(mod.name);
        const existing = modMatches.get(mod.name) || { aliasIds: [], displayNames: [] };
        existing.aliasIds.push(alias.id);
        existing.displayNames.push(alias.display_name);
        modMatches.set(mod.name, existing);
      }
    }
    aliasMatches.set(alias.id, matched);
  }

  let matchedCount = 0;
  const unmatchedModifiers: { name: string; qty: number; revenue: number }[] = [];
  const ignoredModifiers: { name: string; qty: number; revenue: number }[] = [];

  for (const mod of aggregateData.modifiers) {
    if (modMatches.has(mod.name)) {
      matchedCount++;
    } else if (ignoredNames.has(mod.name.toLowerCase())) {
      ignoredModifiers.push({ name: mod.name, qty: mod.count, revenue: mod.revenue });
    } else {
      unmatchedModifiers.push({ name: mod.name, qty: mod.count, revenue: mod.revenue });
    }
  }

  // Compute suggestions for unmatched modifiers
  const aliasGroupNames = [...new Set(aliases.map(a => a.display_name))];
  function computeSuggestions(modName: string) {
    const scored: { displayName: string; score: number }[] = [];
    for (const groupName of aliasGroupNames) {
      const score = bigramSimilarity(modName, groupName);
      if (score > 0.3) scored.push({ displayName: groupName, score });
    }
    // Also check against alias patterns
    for (const alias of aliases) {
      const score = bigramSimilarity(modName, alias.pattern);
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

  // --- Conflict Detection: modifiers matched by multiple groups ---
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

  for (const [modName, match] of modMatches) {
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
          message: `"${modName}" matches this rule but also matches another rule that maps to "${uniqueDisplayNames.find(d => d !== alias.display_name)}"`,
          affectedItems: [modName],
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
    // Aggregate stats (existing data for stats header)
    ...aggregateData,
    // Alias management data (for AliasManager)
    aliases: aliases.map((a) => ({
      id: a.id,
      pattern: a.pattern,
      matchType: a.match_type,
      displayName: a.display_name,
      createdAt: a.created_at,
      matchCount: (aliasMatches.get(a.id) || []).length,
      matchedItems: (aliasMatches.get(a.id) || []).slice(0, 20),
    })),
    matchedCount,
    unmatchedCount: unmatchedModifiers.length,
    unmatched: unmatchedModifiers.map(mod => ({
      ...mod,
      suggestions: computeSuggestions(mod.name),
    })),
    ignoredCount: ignoredModifiers.length,
    ignored: ignoredModifiers,
    warnings: [...seenWarnings.values()],
  });
}

/**
 * POST /api/menu-modifiers
 */
export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.action === "ignore") {
    const { modifierName } = body;
    if (!modifierName) return NextResponse.json({ error: "modifierName is required" }, { status: 400 });
    createMenuModifierIgnore(uuidv4(), modifierName);
    return NextResponse.json({ ignored: true });
  }

  if (body.action === "unignore") {
    const { modifierName } = body;
    if (!modifierName) return NextResponse.json({ error: "modifierName is required" }, { status: 400 });
    deleteMenuModifierIgnore(modifierName);
    return NextResponse.json({ unignored: true });
  }

  const { pattern, matchType, displayName } = body;
  if (!pattern || !matchType || !displayName) {
    return NextResponse.json({ error: "pattern, matchType, and displayName are required" }, { status: 400 });
  }

  const id = uuidv4();
  createMenuModifierAlias(id, pattern, matchType, displayName);
  deleteMenuModifierIgnore(pattern);

  return NextResponse.json({ alias: { id, pattern, matchType, displayName } });
}

/**
 * PATCH /api/menu-modifiers
 */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, pattern, matchType, displayName } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  updateMenuModifierAlias(id, { pattern, match_type: matchType, display_name: displayName });
  return NextResponse.json({ alias: { id, pattern, matchType, displayName } });
}

/**
 * DELETE /api/menu-modifiers?id=<id>
 */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  deleteMenuModifierAlias(id);
  return NextResponse.json({ deleted: true });
}
