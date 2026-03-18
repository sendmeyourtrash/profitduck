import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  getAllCategorizationRules,
  createCategorizationRule,
  updateCategorizationRule,
  deleteCategorizationRule,
  getAllExpenseCategories,
  getAllVendorAliases,
  getCategoriesDb,
  getVendorAliasesDb,
} from "@/lib/db/config-db";
import Database from "better-sqlite3";
import path from "path";

/**
 * GET /api/categorization-rules
 * List all categorization rules with category info.
 * ?action=suggest — returns uncategorized vendors with suggested categories.
 * Now reads from categories.db.
 */
export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action");

  if (action === "suggest") {
    return getUncategorizedSuggestions();
  }

  const rules = getAllCategorizationRules();
  const categories = getAllExpenseCategories();
  const catMap = new Map(categories.map((c) => [c.id, c]));

  const result = rules.map((r) => {
    const cat = r.category_id ? catMap.get(r.category_id) : null;
    return {
      id: r.id,
      type: r.type,
      pattern: r.pattern,
      categoryId: r.category_id,
      priority: r.priority,
      createdFrom: r.created_from,
      hitCount: r.hit_count,
      createdAt: r.created_at,
      category: cat ? { id: cat.id, name: cat.name, color: cat.color, icon: cat.icon } : null,
    };
  });

  return NextResponse.json({ rules: result });
}

/**
 * Returns uncategorized vendors with suggested categories based on RM category names.
 * Scans bank.db expenses, resolves vendor aliases, finds vendors without categorization rules,
 * and suggests categories based on the RM category field.
 */
function getUncategorizedSuggestions() {
  const aliases = getAllVendorAliases();
  const rules = getAllCategorizationRules();
  const categories = getAllExpenseCategories();

  // Get ignored vendors
  const vaDb = getVendorAliasesDb();
  const ignoredVendors = new Set(
    (vaDb.prepare("SELECT vendor_name FROM vendor_ignores").all() as { vendor_name: string }[])
      .map((r) => r.vendor_name.toLowerCase())
  );
  vaDb.close();

  // Build lookup: vendor display name → existing rule
  const existingRules = new Set(
    rules.filter((r) => r.type === "vendor_match").map((r) => r.pattern.toLowerCase())
  );

  // Build category name → id lookup
  const categoryByName = new Map<string, { id: string; name: string; color: string | null }>();
  for (const c of categories) {
    categoryByName.set(c.name.toLowerCase(), { id: c.id, name: c.name, color: c.color });
  }

  // RM category → expense category mapping (best-guess suggestions)
  const rmCategoryMap: Record<string, string> = {
    "shopping": "Shopping",
    "groceries": "Groceries & Ingredients",
    "bills & utilities": "Rent & Utilities",
    "salary": "Payroll & Salary",
    "insurance": "Insurance",
    "rent": "Rent & Utilities",
    "ads": "Marketing & Advertising",
    "permits": "Permits & Licenses",
    "construction": "Construction & Maintenance",
    "taxes": "Taxes",
    "auto & transport": "Auto & Transport",
    "software & tech": "Software & Tech",
    "security": "Security",
    "home & garden": "Other",
    "dining & drinks": "Dining & Drinks",
    "fees": "Fees & Charges",
    "funding": "Other",
  };

  const suggestions: {
    vendorName: string;
    count: number;
    totalAmount: number;
    rmCategory: string;
    suggestedCategory: { id: string; name: string; color: string | null } | null;
  }[] = [];

  try {
    const bankDb = new Database(path.join(process.cwd(), "databases", "bank.db"));
    const rows = bankDb.prepare(`
      SELECT COALESCE(NULLIF(custom_name, ''), name) as vendor_name,
             category as rm_category,
             COUNT(*) as cnt,
             ROUND(SUM(CAST(amount AS REAL)), 2) as total_amount
      FROM rocketmoney
      GROUP BY vendor_name, rm_category
      ORDER BY cnt DESC
    `).all() as { vendor_name: string; rm_category: string; cnt: number; total_amount: number }[];

    for (const row of rows) {
      // Resolve vendor alias
      let displayName = row.vendor_name;
      for (const alias of aliases) {
        const patLower = alias.pattern.toLowerCase();
        const nameLower = row.vendor_name.toLowerCase();
        if (alias.match_type === "exact" && nameLower === patLower) {
          displayName = alias.display_name; break;
        } else if (alias.match_type === "starts_with" && nameLower.startsWith(patLower)) {
          displayName = alias.display_name; break;
        } else if (alias.match_type === "contains" && nameLower.includes(patLower)) {
          displayName = alias.display_name; break;
        }
      }

      // Skip if already has a rule, is ignored, or trivially small
      if (existingRules.has(displayName.toLowerCase())) continue;
      if (ignoredVendors.has(displayName.toLowerCase())) continue;
      if (Math.abs(row.total_amount) < 1 && row.cnt <= 1) continue;

      // Suggest category based on RM category
      const rmCatLower = (row.rm_category || "").toLowerCase();
      const suggestedName = rmCategoryMap[rmCatLower];
      const suggested = suggestedName ? categoryByName.get(suggestedName.toLowerCase()) || null : null;

      // Dedupe by display name (multiple raw names may resolve to same alias)
      const existing = suggestions.find((s) => s.vendorName.toLowerCase() === displayName.toLowerCase());
      if (existing) {
        existing.count += row.cnt;
        existing.totalAmount += row.total_amount;
      } else {
        suggestions.push({
          vendorName: displayName,
          count: row.cnt,
          totalAmount: row.total_amount,
          rmCategory: row.rm_category || "",
          suggestedCategory: suggested,
        });
      }
    }

    bankDb.close();
  } catch (e) {
    console.error("Suggestion scan error:", e);
  }

  // Sort by count descending
  suggestions.sort((a, b) => b.count - a.count);

  return NextResponse.json({
    suggestions,
    categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    totalUncategorized: suggestions.reduce((sum, s) => sum + s.count, 0),
  });
}

/**
 * POST /api/categorization-rules
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.action === "learn") {
      const { vendorName, categoryId } = body;
      if (!vendorName || !categoryId) {
        return NextResponse.json({ error: "vendorName and categoryId required" }, { status: 400 });
      }
      createCategorizationRule(uuidv4(), "vendor_match", vendorName, categoryId, 5, "auto_learned");
      return NextResponse.json({ success: true });
    }

    if (body.action === "run") {
      // Scan bank.db, resolve vendor aliases, match categorization rules, update hit counts
      const aliases = getAllVendorAliases();
      const rules = getAllCategorizationRules();
      const catDb = getCategoriesDb();

      // Build vendor_match rules: pattern (lowercase) → rule id
      const vendorRules = rules.filter((r) => r.type === "vendor_match" && r.category_id);

      // Reset all hit counts
      if (body.rerunAll) {
        catDb.prepare("UPDATE categorization_rules SET hit_count = 0").run();
      }

      let categorized = 0;

      try {
        const bankDb = new Database(path.join(process.cwd(), "databases", "bank.db"));
        const rows = bankDb.prepare(`
          SELECT COALESCE(NULLIF(custom_name, ''), name) as vendor_name, COUNT(*) as cnt
          FROM rocketmoney
          WHERE 1=1
          GROUP BY vendor_name
        `).all() as { vendor_name: string; cnt: number }[];

        const hitCounts = new Map<string, number>();

        for (const row of rows) {
          // Resolve vendor alias
          let displayName = row.vendor_name;
          for (const alias of aliases) {
            const patLower = alias.pattern.toLowerCase();
            const nameLower = row.vendor_name.toLowerCase();
            if (alias.match_type === "exact" && nameLower === patLower) {
              displayName = alias.display_name; break;
            } else if (alias.match_type === "starts_with" && nameLower.startsWith(patLower)) {
              displayName = alias.display_name; break;
            } else if (alias.match_type === "contains" && nameLower.includes(patLower)) {
              displayName = alias.display_name; break;
            }
          }

          // Match against categorization rules
          for (const rule of vendorRules) {
            if (rule.pattern.toLowerCase() === displayName.toLowerCase()) {
              hitCounts.set(rule.id, (hitCounts.get(rule.id) || 0) + row.cnt);
              categorized += row.cnt;
              break;
            }
          }
        }

        // Update hit counts in categories.db
        const updateStmt = catDb.prepare("UPDATE categorization_rules SET hit_count = ? WHERE id = ?");
        for (const [ruleId, count] of hitCounts) {
          updateStmt.run(count, ruleId);
        }

        bankDb.close();
      } catch (e) {
        console.error("Recategorize error:", e);
      }

      catDb.close();
      return NextResponse.json({ categorized });
    }

    const { type, pattern, categoryId, priority } = body;
    if (!type || !pattern || !categoryId) {
      return NextResponse.json({ error: "type, pattern, and categoryId required" }, { status: 400 });
    }

    const id = uuidv4();
    createCategorizationRule(id, type, pattern, categoryId, priority || 0, "manual");

    const categories = getAllExpenseCategories();
    const cat = categories.find((c) => c.id === categoryId);

    return NextResponse.json({
      rule: {
        id, type, pattern, categoryId, priority: priority || 0, createdFrom: "manual",
        category: cat ? { id: cat.id, name: cat.name, color: cat.color, icon: cat.icon } : null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/categorization-rules
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, type, pattern, categoryId } = body;

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    updateCategorizationRule(id, { type, pattern, category_id: categoryId });
    return NextResponse.json({ rule: { id, type, pattern, categoryId } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/categorization-rules
 */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  deleteCategorizationRule(id);
  return NextResponse.json({ success: true });
}
