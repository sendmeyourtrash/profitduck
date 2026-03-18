import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";

/**
 * Returns the min/max date range across all data, plus available
 * platforms and categories for filter dropdowns.
 *
 * Reads from sales.db (unified orders table) and bank.db.
 */
export async function GET(request: NextRequest) {
  const salesDbPath = path.join(process.cwd(), "databases", "sales.db");
  const bankDbPath = path.join(process.cwd(), "databases", "bank.db");

  let salesDb: InstanceType<typeof Database> | null = null;
  let bankDb: InstanceType<typeof Database> | null = null;

  try {
    salesDb = new Database(salesDbPath, { readonly: true });
    bankDb = new Database(bankDbPath, { readonly: true });

    // Date range from sales.db orders
    const salesRange = salesDb.prepare(
      "SELECT MIN(date) as min_date, MAX(date) as max_date FROM orders"
    ).get() as { min_date: string | null; max_date: string | null };

    // Date range from bank.db rocketmoney
    const bankRange = bankDb.prepare(
      "SELECT MIN(date) as min_date, MAX(date) as max_date FROM rocketmoney"
    ).get() as { min_date: string | null; max_date: string | null };

    // Combine date ranges
    const allMins = [salesRange.min_date, bankRange.min_date].filter(Boolean) as string[];
    const allMaxs = [salesRange.max_date, bankRange.max_date].filter(Boolean) as string[];
    const minDate = allMins.length > 0 ? allMins.sort()[0] : null;
    const maxDate = allMaxs.length > 0 ? allMaxs.sort().reverse()[0] : null;

    // Platforms from sales.db
    const platforms = salesDb.prepare(
      "SELECT DISTINCT platform FROM orders WHERE platform IS NOT NULL ORDER BY platform"
    ).all() as { platform: string }[];

    // Categories from sales.db (using display_category after aliases applied)
    const categories = salesDb.prepare(`
      SELECT DISTINCT display_category as category FROM order_items
      WHERE display_category IS NOT NULL AND display_category != ''
      AND platform = 'square' AND event_type = 'Payment'
      ORDER BY display_category
    `).all() as { category: string }[];

    // Bank sources
    const bankSources = bankDb.prepare(
      "SELECT DISTINCT category FROM rocketmoney WHERE category IS NOT NULL AND category != '' ORDER BY category"
    ).all() as { category: string }[];

    return NextResponse.json({
      dateRange: {
        min: minDate ? `${minDate}T00:00:00.000Z` : null,
        max: maxDate ? `${maxDate}T23:59:59.000Z` : null,
      },
      platforms: platforms.map((p) => p.platform),
      categories: categories.map((c) => c.category),
      bankCategories: bankSources.map((c) => c.category),
      vendors: [],
    });
  } catch (error) {
    console.error("[data-range] Error:", error);
    return NextResponse.json({
      dateRange: { min: null, max: null },
      platforms: ["square", "grubhub", "doordash", "ubereats"],
      categories: [],
      vendors: [],
    });
  } finally {
    salesDb?.close();
    bankDb?.close();
  }
}
