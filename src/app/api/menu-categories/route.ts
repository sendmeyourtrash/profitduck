import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  getAllMenuCategories,
  createMenuCategory,
  updateMenuCategory,
  deleteMenuCategory,
  getItemCategoryMappings,
  assignItemToCategory,
  unassignItem,
  bulkAssignItems,
} from "@/lib/db/sales-db";
import { getSalesDb } from "@/lib/db/sales-db";
import { step3ApplyAliases } from "@/lib/services/pipeline-step3-aliases";
import { bigramSimilarity } from "@/lib/utils/string-similarity";
import Database from "better-sqlite3";
import path from "path";

/**
 * Fast category update for a single item — updates only matching rows
 * instead of re-running the full pipeline.
 * Opens a writable connection since getSalesDb() is readonly.
 */
function quickCategoryUpdate(displayName: string, categoryName: string | null) {
  const db = new Database(path.join(process.cwd(), "databases", "sales.db"));
  try {
    if (categoryName) {
      db.prepare(
        "UPDATE order_items SET display_category = ? WHERE display_name = ? COLLATE NOCASE"
      ).run(categoryName, displayName);
    } else {
      db.prepare(
        "UPDATE order_items SET display_category = 'Uncategorized' WHERE display_name = ? COLLATE NOCASE"
      ).run(displayName);
    }
  } finally {
    db.close();
  }
}

// Default colors for seeded categories
const CATEGORY_COLORS = [
  "#f59e0b", "#10b981", "#6366f1", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#06b6d4", "#84cc16",
];

// Generic junk category names to filter out during seeding.
// These are common POS status/size strings, not real menu categories.
const JUNK_CATEGORIES = new Set([
  "large", "medium", "small", "regular", "uncategorized", "",
  "completed", "cancelled", "unfulfilled", "adjustment", "credit",
  "other", "refund", "pending", "none", "default", "misc",
  "error_charge", "error", "void",
]);

/**
 * Get all unique menu items with stats from sales.db
 */
function getItemStats() {
  const db = getSalesDb();
  return db.prepare(`
    SELECT display_name, SUM(qty) as qty, ROUND(SUM(net_sales), 2) as revenue,
           TRIM(category) as raw_category
    FROM order_items
    WHERE event_type = 'Payment' AND qty > 0
      AND display_name IS NOT NULL AND display_name != ''
    GROUP BY display_name
    ORDER BY qty DESC
  `).all() as { display_name: string; qty: number; revenue: number; raw_category: string }[];
}

/**
 * Compute suggestion for which category an unmapped item might belong to.
 */
function computeSuggestion(
  itemName: string,
  categories: { id: string; name: string }[],
  mappedItems: Map<string, string> // display_name → category_name
): { categoryId: string; categoryName: string; score: number } | null {
  let bestScore = 0;
  let bestCat: { id: string; name: string } | null = null;

  // Compare against category names
  for (const cat of categories) {
    const score = bigramSimilarity(itemName, cat.name);
    if (score > bestScore) {
      bestScore = score;
      bestCat = cat;
    }
  }

  // Compare against items already in each category (peer matching)
  for (const [mappedName, catName] of mappedItems) {
    const score = bigramSimilarity(itemName, mappedName);
    if (score > bestScore) {
      bestScore = score;
      bestCat = categories.find((c) => c.name === catName) || null;
    }
  }

  if (bestCat && bestScore > 0.3) {
    return { categoryId: bestCat.id, categoryName: bestCat.name, score: bestScore };
  }
  return null;
}

/**
 * GET /api/menu-categories
 */
export async function GET() {
  const categories = getAllMenuCategories();
  const mappings = getItemCategoryMappings();
  const allItems = getItemStats();

  // Build lookup maps
  const itemToCategory = new Map<string, { categoryId: string; categoryName: string }>();
  for (const m of mappings) {
    itemToCategory.set(m.display_name, { categoryId: m.category_id, categoryName: m.category_name });
  }

  const mappedItemNames = new Map<string, string>();
  for (const m of mappings) {
    mappedItemNames.set(m.display_name, m.category_name);
  }

  // Build per-category item lists
  const categoryItems = new Map<string, { displayName: string; qty: number; revenue: number }[]>();
  const categoryRevenue = new Map<string, number>();
  for (const cat of categories) {
    categoryItems.set(cat.id, []);
    categoryRevenue.set(cat.id, 0);
  }

  const unmapped: {
    displayName: string; qty: number; revenue: number;
    rawCategory: string;
    suggestion: { categoryId: string; categoryName: string; score: number } | null;
  }[] = [];

  for (const item of allItems) {
    const mapping = itemToCategory.get(item.display_name);
    if (mapping) {
      const list = categoryItems.get(mapping.categoryId);
      if (list) {
        list.push({ displayName: item.display_name, qty: item.qty, revenue: item.revenue });
        categoryRevenue.set(mapping.categoryId, (categoryRevenue.get(mapping.categoryId) || 0) + item.revenue);
      }
    } else {
      unmapped.push({
        displayName: item.display_name,
        qty: item.qty,
        revenue: item.revenue,
        rawCategory: item.raw_category || "",
        suggestion: computeSuggestion(item.display_name, categories, mappedItemNames),
      });
    }
  }

  return NextResponse.json({
    categories: categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      color: cat.color,
      sortOrder: cat.sort_order,
      itemCount: (categoryItems.get(cat.id) || []).length,
      revenue: Math.round((categoryRevenue.get(cat.id) || 0) * 100) / 100,
      items: (categoryItems.get(cat.id) || []).sort((a, b) => b.qty - a.qty),
    })),
    unmapped,
    stats: {
      totalCategories: categories.length,
      mappedItems: mappings.length,
      unmappedItems: unmapped.length,
    },
  });
}

/**
 * POST /api/menu-categories
 */
export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.action === "create-category") {
    const { name, color } = body;
    if (!name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
    const id = uuidv4();
    const cats = getAllMenuCategories();
    const sortOrder = cats.length;
    try {
      createMenuCategory(id, name.trim(), color, sortOrder);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes("UNIQUE")) {
        return NextResponse.json({ error: "Category already exists" }, { status: 409 });
      }
      throw e;
    }
    return NextResponse.json({ category: { id, name: name.trim(), color, sortOrder } });
  }

  if (body.action === "assign") {
    const { displayName, categoryId } = body;
    if (!displayName || !categoryId) return NextResponse.json({ error: "displayName and categoryId required" }, { status: 400 });
    const id = uuidv4();
    assignItemToCategory(id, displayName, categoryId);
    // Fast path: update only this item's rows instead of full pipeline
    const cat = getAllMenuCategories().find(c => c.id === categoryId);
    quickCategoryUpdate(displayName, cat?.name || null);
    return NextResponse.json({ assigned: true });
  }

  if (body.action === "bulk-assign") {
    const { items } = body as { items: { displayName: string; categoryId: string }[] };
    if (!items?.length) return NextResponse.json({ error: "items array required" }, { status: 400 });
    bulkAssignItems(items.map((i) => ({ id: uuidv4(), displayName: i.displayName, categoryId: i.categoryId })));
    // Fast path: update each item
    const cats = getAllMenuCategories();
    const catMap = new Map(cats.map(c => [c.id, c.name]));
    for (const item of items) {
      quickCategoryUpdate(item.displayName, catMap.get(item.categoryId) || null);
    }
    return NextResponse.json({ assigned: items.length });
  }

  if (body.action === "unassign") {
    const { displayName } = body;
    if (!displayName) return NextResponse.json({ error: "displayName required" }, { status: 400 });
    unassignItem(displayName);
    quickCategoryUpdate(displayName, null);
    return NextResponse.json({ unassigned: true });
  }

  if (body.action === "suggest") {
    // Read display_category (aliased values) for better suggestions
    const db = getSalesDb();
    const catRows = db.prepare(`
      SELECT display_category as name, COUNT(DISTINCT display_name) as item_count, SUM(qty) as total_qty
      FROM order_items
      WHERE event_type = 'Payment' AND qty > 0
        AND display_category IS NOT NULL AND display_category != ''
      GROUP BY display_category
      ORDER BY total_qty DESC
    `).all() as { name: string; item_count: number; total_qty: number }[];

    // Strict filtering: must have 2+ items AND not be junk
    const suggestions = catRows
      .filter((c) =>
        !JUNK_CATEGORIES.has(c.name.toLowerCase().trim()) &&
        c.item_count >= 2
      )
      .map((c) => ({ name: c.name, itemCount: c.item_count, qty: c.total_qty }));

    return NextResponse.json({ suggestions });
  }

  if (body.action === "seed") {
    const categories = getAllMenuCategories();
    if (categories.length > 0) {
      return NextResponse.json({ error: "Categories already exist. Use 'reset' to start over." }, { status: 400 });
    }

    // Create only the categories the user selected
    const { categoryNames } = body as { categoryNames: string[] };
    if (!categoryNames?.length) {
      return NextResponse.json({ error: "categoryNames array required" }, { status: 400 });
    }

    const createdCats: { id: string; name: string }[] = [];
    for (let i = 0; i < categoryNames.length; i++) {
      const name = categoryNames[i].trim();
      if (!name) continue;
      const id = uuidv4();
      const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
      try {
        createMenuCategory(id, name, color, i);
        createdCats.push({ id, name });
      } catch { /* skip duplicates */ }
    }

    return NextResponse.json({
      seeded: true,
      categoriesCreated: createdCats.length,
      itemsMapped: 0,
    });
  }

  if (body.action === "reset") {
    // Clear all mappings and categories — start fresh
    // menu_categories and menu_item_category_map now live in sales.db
    const { getWritableSalesDb } = await import("@/lib/db/sales-db");
    const db = getWritableSalesDb();
    try {
      db.exec("DELETE FROM menu_item_category_map");
      db.exec("DELETE FROM menu_categories");
    } catch { /* tables may not exist */ } finally {
      db.close();
    }
    step3ApplyAliases();
    return NextResponse.json({ reset: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

/**
 * PATCH /api/menu-categories
 */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, name, color, sortOrder } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const nameChanged = name !== undefined;
  updateMenuCategory(id, {
    name,
    color,
    sort_order: sortOrder,
  });

  if (nameChanged) {
    step3ApplyAliases();
  }

  return NextResponse.json({ updated: true });
}

/**
 * DELETE /api/menu-categories?id=<id>
 */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  deleteMenuCategory(id);
  step3ApplyAliases();
  return NextResponse.json({ deleted: true });
}
