import { NextRequest, NextResponse } from "next/server";
import { ensureBankView } from "@/lib/db/bank-db-setup";
import { v4 as uuidv4 } from "uuid";
import {
  getAllExpenseCategories,
  createExpenseCategory,
  updateExpenseCategory,
  deleteExpenseCategory,
  getAllCategorizationRules,
  getAllVendorAliases,
  getVendorAliasesDb,
  getAllCategoryIgnores,
  createCategoryIgnore,
  deleteCategoryIgnore,
} from "@/lib/db/config-db";
import Database from "better-sqlite3";
import path from "path";

/**
 * GET /api/expense-categories
 * List all expense categories with expense counts from bank.db.
 * Categories and rules come from categories.db.
 * Vendor aliases from vendor-aliases.db map bank transactions to categories.
 */
export async function GET() {
  const categories = getAllExpenseCategories();
  const rules = getAllCategorizationRules();
  const aliases = getAllVendorAliases();

  // Count rules per category
  const ruleCountMap = new Map<string, number>();
  for (const r of rules) {
    if (r.category_id) {
      ruleCountMap.set(r.category_id, (ruleCountMap.get(r.category_id) || 0) + 1);
    }
  }

  // Build vendor_match rules: display_name → category_id
  const vendorToCategoryId = new Map<string, string>();
  for (const rule of rules) {
    if (rule.type === "vendor_match" && rule.category_id) {
      vendorToCategoryId.set(rule.pattern.toLowerCase(), rule.category_id);
    }
  }

  // Count bank transactions and sum amounts per category by resolving vendor aliases
  const expenseCountMap = new Map<string, number>();
  const expenseAmountMap = new Map<string, number>();
  const vendorsByCategory = new Map<string, { name: string; count: number; amount: number }[]>();
  let uncategorizedCount = 0;
  let uncategorizedAmount = 0;

  try {
    const bankDb = new Database(path.join(process.cwd(), "databases", "bank.db"));
    ensureBankView(bankDb);
    const rows = bankDb.prepare(`
      SELECT COALESCE(NULLIF(custom_name, ''), name) as vendor_name,
             COUNT(*) as cnt,
             COALESCE(SUM(CAST(amount AS REAL)), 0) as total_amount
      FROM all_bank_transactions
      WHERE 1=1
      GROUP BY vendor_name
    `).all() as { vendor_name: string; cnt: number; total_amount: number }[];

    for (const row of rows) {
      // Resolve vendor alias
      let displayName = row.vendor_name;
      for (const alias of aliases) {
        const patLower = alias.pattern.toLowerCase();
        const nameLower = row.vendor_name.toLowerCase();
        if (alias.match_type === "exact" && nameLower === patLower) {
          displayName = alias.display_name;
          break;
        } else if (alias.match_type === "starts_with" && nameLower.startsWith(patLower)) {
          displayName = alias.display_name;
          break;
        } else if (alias.match_type === "contains" && nameLower.includes(patLower)) {
          displayName = alias.display_name;
          break;
        }
      }

      // Find category for this vendor
      const categoryId = vendorToCategoryId.get(displayName.toLowerCase());
      if (categoryId) {
        expenseCountMap.set(categoryId, (expenseCountMap.get(categoryId) || 0) + row.cnt);
        expenseAmountMap.set(categoryId, Math.round(((expenseAmountMap.get(categoryId) || 0) + row.total_amount) * 100) / 100);
        if (!vendorsByCategory.has(categoryId)) vendorsByCategory.set(categoryId, []);
        vendorsByCategory.get(categoryId)!.push({ name: displayName, count: row.cnt, amount: row.total_amount });
      } else {
        uncategorizedCount += row.cnt;
        uncategorizedAmount = Math.round((uncategorizedAmount + row.total_amount) * 100) / 100;
      }
    }

    bankDb.close();
  } catch (e) {
    console.error("Failed to count bank expenses:", e);
  }

  const result = categories.map((c) => ({
    id: c.id,
    name: c.name,
    parentId: c.parent_id,
    color: c.color,
    icon: c.icon,
    createdAt: c.created_at,
    _count: {
      expenses: expenseCountMap.get(c.id) || 0,
      rules: ruleCountMap.get(c.id) || 0,
      amount: expenseAmountMap.get(c.id) || 0,
    },
    topVendors: (vendorsByCategory.get(c.id) || [])
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 10)
      .map((v) => ({ name: v.name, count: v.count, amount: Math.round(v.amount * 100) / 100 })),
    children: categories.filter((ch) => ch.parent_id === c.id).map((ch) => ({
      id: ch.id,
      name: ch.name,
      parentId: ch.parent_id,
      color: ch.color,
      icon: ch.icon,
    })),
  })).filter((c) => !c.parentId); // Only return top-level, children are nested

  // Get ignored categories
  const ignoredCategories = getAllCategoryIgnores().map((ic) => ({
    id: ic.id,
    categoryName: ic.category_name,
    createdAt: ic.created_at,
    // Find count from the result
    count: result.find((c) => c.name.toLowerCase() === ic.category_name.toLowerCase())?._count.expenses || 0,
  }));

  return NextResponse.json({ categories: result, uncategorizedCount, uncategorizedAmount, ignoredCategories });
}

/**
 * POST /api/expense-categories
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, categoryName, name, color, icon, parentId } = body;

    // Handle ignore/unignore actions
    if (action === "ignore-category") {
      if (!categoryName) return NextResponse.json({ error: "categoryName is required" }, { status: 400 });
      createCategoryIgnore(categoryName);
      return NextResponse.json({ success: true, action: "ignored", categoryName });
    }

    if (action === "unignore-category") {
      if (!categoryName) return NextResponse.json({ error: "categoryName is required" }, { status: 400 });
      deleteCategoryIgnore(categoryName);
      return NextResponse.json({ success: true, action: "unignored", categoryName });
    }

    // Default: create new category
    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const id = uuidv4();
    createExpenseCategory(id, name, color, icon, parentId);

    return NextResponse.json({
      category: { id, name, color, icon, parentId },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/expense-categories
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, color, icon } = body;

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    updateExpenseCategory(id, { name, color, icon });
    return NextResponse.json({ category: { id, name, color, icon } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/expense-categories?id=...
 */
export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    deleteExpenseCategory(id); // Also deletes associated rules
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
