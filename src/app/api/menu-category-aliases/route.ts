import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { clearMenuCategoryAliasCache } from "@/lib/services/menu-category-aliases";

/**
 * Scan all Square orders' rawData to extract unique category names with totals.
 */
async function getUniqueCategories() {
  const orders = await prisma.platformOrder.findMany({
    where: { platform: "square", rawData: { not: null } },
    select: { rawData: true },
  });

  const categoryMap = new Map<string, { name: string; qty: number; revenue: number }>();

  for (const order of orders) {
    if (!order.rawData) continue;
    try {
      const items = JSON.parse(order.rawData) as Record<string, string>[];
      for (const item of items) {
        const name = (item["category"] || "").trim();
        if (!name) continue;
        const qty = parseFloat(item["qty"] || "0") || 0;
        const revenue = parseFloat((item["net sales"] || "0").replace(/[$,]/g, "")) || 0;
        if (qty <= 0) continue;

        const existing = categoryMap.get(name);
        if (existing) {
          existing.qty += qty;
          existing.revenue += revenue;
        } else {
          categoryMap.set(name, { name, qty, revenue });
        }
      }
    } catch {
      // skip unparseable
    }
  }

  return categoryMap;
}

/**
 * GET /api/menu-category-aliases
 * Returns all aliases + unmatched categories summary + ignored categories.
 */
export async function GET() {
  const [aliases, ignoredRecords] = await Promise.all([
    prisma.menuCategoryAlias.findMany({ orderBy: { displayName: "asc" } }),
    prisma.menuCategoryIgnore.findMany({ orderBy: { categoryName: "asc" } }),
  ]);

  // Build ignored names set for fast lookup
  const ignoredNames = new Set(ignoredRecords.map((r) => r.categoryName.toLowerCase()));

  // Scan all unique category names from Square orders
  const categoryMap = await getUniqueCategories();

  // Build set of all alias names (both patterns and display names)
  const allAliasNames = new Set<string>();
  for (const alias of aliases) {
    allAliasNames.add(alias.displayName.toLowerCase());
    allAliasNames.add(alias.pattern.toLowerCase());
  }

  // Check each category against aliases
  let matchedCount = 0;
  const unmatchedCategories: { name: string; qty: number; revenue: number }[] = [];
  const ignoredCategories: { name: string; qty: number; revenue: number }[] = [];

  for (const cat of categoryMap.values()) {
    const lowerName = cat.name.toLowerCase();

    const matched = allAliasNames.has(lowerName);
    if (matched) {
      matchedCount++;
    } else if (ignoredNames.has(lowerName)) {
      ignoredCategories.push(cat);
    } else {
      unmatchedCategories.push(cat);
    }
  }

  // Sort unmatched by qty descending
  unmatchedCategories.sort((a, b) => b.qty - a.qty);

  // Sort ignored by name
  ignoredCategories.sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({
    aliases,
    totalCategories: categoryMap.size,
    matchedCount,
    unmatchedCount: unmatchedCategories.length,
    unmatched: unmatchedCategories,
    ignoredCount: ignoredCategories.length,
    ignored: ignoredCategories,
  });
}

/**
 * POST /api/menu-category-aliases
 * Create a new alias OR ignore a category.
 * Body: { pattern, matchType, displayName } for alias
 *    OR { action: "ignore", categoryName } to ignore
 *    OR { action: "unignore", categoryName } to unignore
 */
export async function POST(req: NextRequest) {
  const body = await req.json();

  // Handle ignore action
  if (body.action === "ignore") {
    const { categoryName } = body;
    if (!categoryName) {
      return NextResponse.json({ error: "categoryName is required" }, { status: 400 });
    }
    await prisma.menuCategoryIgnore.upsert({
      where: { categoryName },
      create: { categoryName },
      update: {},
    });
    return NextResponse.json({ ignored: true });
  }

  // Handle unignore action
  if (body.action === "unignore") {
    const { categoryName } = body;
    if (!categoryName) {
      return NextResponse.json({ error: "categoryName is required" }, { status: 400 });
    }
    await prisma.menuCategoryIgnore.deleteMany({ where: { categoryName } });
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

  const alias = await prisma.menuCategoryAlias.create({
    data: { pattern, matchType, displayName },
  });

  // Also remove from ignored list if it was there
  await prisma.menuCategoryIgnore.deleteMany({
    where: { categoryName: pattern },
  });

  clearMenuCategoryAliasCache();

  return NextResponse.json({ alias });
}

/**
 * PATCH /api/menu-category-aliases
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

  const alias = await prisma.menuCategoryAlias.update({ where: { id }, data });
  clearMenuCategoryAliasCache();

  return NextResponse.json({ alias });
}

/**
 * DELETE /api/menu-category-aliases?id=<id>
 */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await prisma.menuCategoryAlias.delete({ where: { id } });
  clearMenuCategoryAliasCache();

  return NextResponse.json({ deleted: true });
}
