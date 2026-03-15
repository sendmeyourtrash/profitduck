import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { clearMenuItemAliasCache } from "@/lib/services/menu-item-aliases";

/**
 * Scan all Square orders' rawData to extract unique item names with totals.
 */
async function getUniqueItems() {
  const orders = await prisma.platformOrder.findMany({
    where: { platform: "square", rawData: { not: null } },
    select: { rawData: true },
  });

  const itemMap = new Map<string, { name: string; qty: number; revenue: number }>();

  for (const order of orders) {
    if (!order.rawData) continue;
    try {
      const items = JSON.parse(order.rawData) as Record<string, string>[];
      for (const item of items) {
        const name = (item["item"] || "").trim();
        if (!name) continue;
        const qty = parseFloat(item["qty"] || "0") || 0;
        const revenue = parseFloat((item["net sales"] || "0").replace(/[$,]/g, "")) || 0;
        if (qty <= 0) continue;

        const existing = itemMap.get(name);
        if (existing) {
          existing.qty += qty;
          existing.revenue += revenue;
        } else {
          itemMap.set(name, { name, qty, revenue });
        }
      }
    } catch {
      // skip unparseable
    }
  }

  return itemMap;
}

/**
 * GET /api/menu-item-aliases
 * Returns all aliases + unmatched items summary + ignored items.
 */
export async function GET() {
  const [aliases, ignoredRecords] = await Promise.all([
    prisma.menuItemAlias.findMany({ orderBy: { displayName: "asc" } }),
    prisma.menuItemIgnore.findMany({ orderBy: { itemName: "asc" } }),
  ]);

  // Build ignored names set for fast lookup
  const ignoredNames = new Set(ignoredRecords.map((r) => r.itemName.toLowerCase()));

  // Scan all unique item names from Square orders
  const itemMap = await getUniqueItems();

  // Build set of display names (canonical names) — these are implicitly matched
  const displayNames = new Set(aliases.map((a) => a.displayName.toLowerCase()));

  // Check each item against aliases
  let matchedCount = 0;
  const unmatchedItems: { name: string; qty: number; revenue: number }[] = [];
  const ignoredItems: { name: string; qty: number; revenue: number }[] = [];

  for (const item of itemMap.values()) {
    const lowerName = item.name.toLowerCase();

    // Item is matched if it IS a display name (canonical) or matches an alias pattern
    let matched = displayNames.has(lowerName);
    if (!matched) {
      for (const alias of aliases) {
        const lowerPattern = alias.pattern.toLowerCase();
        if (
          (alias.matchType === "exact" && lowerName === lowerPattern) ||
          (alias.matchType === "starts_with" && lowerName.startsWith(lowerPattern)) ||
          (alias.matchType === "contains" && lowerName.includes(lowerPattern))
        ) {
          matched = true;
          break;
        }
      }
    }
    if (matched) {
      matchedCount++;
    } else if (ignoredNames.has(lowerName)) {
      ignoredItems.push(item);
    } else {
      unmatchedItems.push(item);
    }
  }

  // Sort unmatched by qty descending, take top 50
  unmatchedItems.sort((a, b) => b.qty - a.qty);
  const topUnmatched = unmatchedItems.slice(0, 50);

  // Sort ignored by name
  ignoredItems.sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({
    aliases,
    totalItems: itemMap.size,
    matchedCount,
    unmatchedCount: unmatchedItems.length,
    unmatched: topUnmatched,
    ignoredCount: ignoredItems.length,
    ignored: ignoredItems,
  });
}

/**
 * POST /api/menu-item-aliases
 * Create a new alias OR ignore an item.
 * Body: { pattern, matchType, displayName } for alias
 *    OR { action: "ignore", itemName } to ignore an item
 */
export async function POST(req: NextRequest) {
  const body = await req.json();

  // Handle ignore action
  if (body.action === "ignore") {
    const { itemName } = body;
    if (!itemName) {
      return NextResponse.json({ error: "itemName is required" }, { status: 400 });
    }
    // Upsert to avoid unique constraint errors
    await prisma.menuItemIgnore.upsert({
      where: { itemName },
      create: { itemName },
      update: {},
    });
    return NextResponse.json({ ignored: true });
  }

  // Handle unignore action
  if (body.action === "unignore") {
    const { itemName } = body;
    if (!itemName) {
      return NextResponse.json({ error: "itemName is required" }, { status: 400 });
    }
    await prisma.menuItemIgnore.deleteMany({ where: { itemName } });
    return NextResponse.json({ unignored: true });
  }

  // Default: create alias
  const { pattern, matchType, displayName } = body;

  if (!pattern || !matchType || !displayName) {
    return NextResponse.json(
      { error: "pattern, matchType, and displayName are required" },
      { status: 400 }
    );
  }

  const alias = await prisma.menuItemAlias.create({
    data: { pattern, matchType, displayName },
  });

  // Also remove from ignored list if it was there
  await prisma.menuItemIgnore.deleteMany({
    where: { itemName: pattern },
  });

  clearMenuItemAliasCache();

  return NextResponse.json({ alias });
}

/**
 * PATCH /api/menu-item-aliases
 * Update an existing alias.
 */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, pattern, matchType, displayName } = body;

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const data: Record<string, string> = {};
  if (pattern !== undefined) data.pattern = pattern;
  if (matchType !== undefined) data.matchType = matchType;
  if (displayName !== undefined) data.displayName = displayName;

  const alias = await prisma.menuItemAlias.update({ where: { id }, data });
  clearMenuItemAliasCache();

  return NextResponse.json({ alias });
}

/**
 * DELETE /api/menu-item-aliases?id=<id>
 */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await prisma.menuItemAlias.delete({ where: { id } });
  clearMenuItemAliasCache();

  return NextResponse.json({ deleted: true });
}
