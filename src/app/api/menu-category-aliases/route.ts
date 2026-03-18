import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  getAllMenuCategoryAliases,
  createMenuCategoryAlias,
  updateMenuCategoryAlias,
  deleteMenuCategoryAlias,
  getCategoriesDb,
} from "@/lib/db/config-db";
import { getSalesDb } from "@/lib/db/sales-db";
import { step3ApplyAliases } from "@/lib/services/pipeline-step3-aliases";

/**
 * Scan Square items from sales.db to extract unique category names.
 */
function getUniqueCategories() {
  const db = getSalesDb();
  const rows = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(category), ''), 'Uncategorized') as name,
           SUM(qty) as qty, SUM(net_sales) as revenue
    FROM order_items
    WHERE qty > 0 AND event_type = 'Payment' AND platform = 'square'
    GROUP BY COALESCE(NULLIF(TRIM(category), ''), 'Uncategorized')
    ORDER BY qty DESC
  `).all() as { name: string; qty: number; revenue: number }[];
  return rows;
}

/**
 * GET /api/menu-category-aliases
 */
export async function GET() {
  const aliases = getAllMenuCategoryAliases();

  // Menu category ignores — check if table exists
  const catDb = getCategoriesDb();
  let ignored: { id: string; category_name: string; created_at: string }[] = [];
  try {
    const tableExists = catDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='menu_category_ignores'").get();
    if (tableExists) {
      ignored = catDb.prepare("SELECT * FROM menu_category_ignores ORDER BY category_name").all() as typeof ignored;
    }
  } catch { /* table doesn't exist yet */ }
  const ignoredNames = new Set(ignored.map((r) => r.category_name.toLowerCase()));

  const allCategories = getUniqueCategories();

  const allAliasNames = new Set<string>();
  for (const alias of aliases) {
    allAliasNames.add(alias.display_name.toLowerCase());
    allAliasNames.add(alias.pattern.toLowerCase());
  }

  let matchedCount = 0;
  const unmatchedCategories: { name: string; qty: number; revenue: number }[] = [];
  const ignoredCategories: { name: string; qty: number; revenue: number }[] = [];

  for (const cat of allCategories) {
    const lowerName = cat.name.toLowerCase();
    if (allAliasNames.has(lowerName)) {
      matchedCount++;
    } else if (ignoredNames.has(lowerName)) {
      ignoredCategories.push(cat);
    } else {
      unmatchedCategories.push(cat);
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
    totalCategories: allCategories.length,
    matchedCount,
    unmatchedCount: unmatchedCategories.length,
    unmatched: unmatchedCategories,
    ignoredCount: ignoredCategories.length,
    ignored: ignoredCategories,
  });
}

/**
 * POST /api/menu-category-aliases
 */
export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.action === "ignore") {
    const { categoryName } = body;
    if (!categoryName) return NextResponse.json({ error: "categoryName is required" }, { status: 400 });
    const catDb = getCategoriesDb();
    catDb.exec(`CREATE TABLE IF NOT EXISTS menu_category_ignores (
      id TEXT PRIMARY KEY, category_name TEXT NOT NULL UNIQUE, created_at TEXT
    )`);
    const existing = catDb.prepare("SELECT 1 FROM menu_category_ignores WHERE category_name = ?").get(categoryName);
    if (!existing) {
      catDb.prepare("INSERT INTO menu_category_ignores (id, category_name, created_at) VALUES (?,?,?)").run(uuidv4(), categoryName, new Date().toISOString());
    }
    return NextResponse.json({ ignored: true });
  }

  if (body.action === "unignore") {
    const { categoryName } = body;
    if (!categoryName) return NextResponse.json({ error: "categoryName is required" }, { status: 400 });
    const catDb = getCategoriesDb();
    try { catDb.prepare("DELETE FROM menu_category_ignores WHERE category_name = ?").run(categoryName); } catch { /* ok */ }
    return NextResponse.json({ unignored: true });
  }

  const { pattern, matchType, displayName } = body;
  if (!pattern || !matchType || !displayName) {
    return NextResponse.json({ error: "pattern, matchType, and displayName are required" }, { status: 400 });
  }

  const id = uuidv4();
  createMenuCategoryAlias(id, pattern, matchType, displayName);
  step3ApplyAliases();
  return NextResponse.json({ alias: { id, pattern, matchType, displayName } });
}

/**
 * PATCH /api/menu-category-aliases
 */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, pattern, matchType, displayName } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  updateMenuCategoryAlias(id, { pattern, match_type: matchType, display_name: displayName });
  step3ApplyAliases();
  return NextResponse.json({ alias: { id, pattern, matchType, displayName } });
}

/**
 * DELETE /api/menu-category-aliases?id=<id>
 */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  deleteMenuCategoryAlias(id);
  step3ApplyAliases();
  return NextResponse.json({ deleted: true });
}
