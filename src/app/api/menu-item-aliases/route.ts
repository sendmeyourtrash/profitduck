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

  const allAliasNames = new Set<string>();
  for (const alias of aliases) {
    allAliasNames.add(alias.display_name.trim().toLowerCase());
    allAliasNames.add(alias.pattern.trim().toLowerCase());
  }

  let matchedCount = 0;
  const unmatchedItems: { name: string; qty: number; revenue: number }[] = [];
  const ignoredItems: { name: string; qty: number; revenue: number }[] = [];

  for (const item of allItems) {
    const lowerName = item.name.toLowerCase();
    if (allAliasNames.has(lowerName)) {
      matchedCount++;
    } else if (ignoredNames.has(lowerName)) {
      ignoredItems.push(item);
    } else {
      unmatchedItems.push(item);
    }
  }

  return NextResponse.json({
    aliases: aliases.map((a) => ({
      id: a.id,
      pattern: a.pattern,
      matchType: a.match_type,
      displayName: a.display_name,
      createdAt: a.created_at,
    })),
    totalItems: allItems.length,
    matchedCount,
    unmatchedCount: unmatchedItems.length,
    unmatched: unmatchedItems,
    ignoredCount: ignoredItems.length,
    ignored: ignoredItems,
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
