/**
 * Menu Performance API — item, category, and modifier analytics.
 *
 * GET /api/dashboard/menu?startDate=X&endDate=Y[&category=Z][&platform=P]
 */
import { NextRequest, NextResponse } from "next/server";
import { getSalesDb } from "@/lib/db/sales-db";
import { getCategoriesDb } from "@/lib/db/config-db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const categoryFilter = searchParams.get("category");
    const platformFilter = searchParams.get("platform");

    const db = getSalesDb();

    // Build WHERE conditions
    const conditions: string[] = ["oi.event_type = 'Payment'", "oi.qty > 0"];
    const params: (string | number)[] = [];

    if (startDate) { conditions.push("oi.date >= ?"); params.push(startDate); }
    if (endDate) { conditions.push("oi.date <= ?"); params.push(endDate); }
    if (categoryFilter) { conditions.push("oi.display_category = ?"); params.push(categoryFilter); }
    if (platformFilter) { conditions.push("oi.platform = ?"); params.push(platformFilter); }

    // Load ignore lists
    const catDb = getCategoriesDb();
    const itemIgnores = (catDb.prepare("SELECT item_name FROM menu_item_ignores").all() as { item_name: string }[])
      .map(r => r.item_name);
    let categoryIgnores: string[] = [];
    try {
      categoryIgnores = (catDb.prepare("SELECT category_name FROM category_ignores").all() as { category_name: string }[])
        .map(r => r.category_name);
    } catch { /* table may not exist */ }

    const itemIgnoreFilter = itemIgnores.length > 0
      ? ` AND oi.display_name NOT IN (${itemIgnores.map(() => "?").join(",")})`
      : "";
    const catIgnoreFilter = categoryIgnores.length > 0
      ? ` AND oi.display_category NOT IN (${categoryIgnores.map(() => "?").join(",")})`
      : "";

    const where = `WHERE ${conditions.join(" AND ")}`;
    const itemParams = [...params, ...itemIgnores];
    const catParams = [...params, ...categoryIgnores];

    // ---- Summary Stats ----
    const summary = db.prepare(`
      SELECT SUM(oi.qty) as totalQty, ROUND(SUM(oi.gross_sales), 2) as totalRevenue,
        COUNT(DISTINCT oi.display_name) as totalItems
      FROM order_items oi ${where}${itemIgnoreFilter}
    `).get(...itemParams) as { totalQty: number; totalRevenue: number; totalItems: number } | undefined;

    const totalQty = summary?.totalQty || 0;
    const totalRevenue = summary?.totalRevenue || 0;
    const totalItems = summary?.totalItems || 0;
    const avgPrice = totalQty > 0 ? Math.round((totalRevenue / totalQty) * 100) / 100 : 0;

    // Prior period for trends
    let prevQty = 0;
    let prevRevenue = 0;
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const daysDiff = Math.round((end.getTime() - start.getTime()) / 86400000);
      const prevStart = new Date(start.getTime() - (daysDiff + 1) * 86400000).toISOString().split("T")[0];
      const prevEnd = new Date(start.getTime() - 86400000).toISOString().split("T")[0];

      const prev = db.prepare(`
        SELECT SUM(oi.qty) as qty, ROUND(SUM(oi.gross_sales), 2) as revenue
        FROM order_items oi
        WHERE oi.event_type = 'Payment' AND oi.qty > 0
          AND oi.date >= ? AND oi.date <= ?
          ${categoryFilter ? "AND oi.display_category = ?" : ""}
          ${platformFilter ? "AND oi.platform = ?" : ""}
          ${itemIgnoreFilter}
      `).get(
        prevStart, prevEnd,
        ...(categoryFilter ? [categoryFilter] : []),
        ...(platformFilter ? [platformFilter] : []),
        ...itemIgnores
      ) as { qty: number; revenue: number } | undefined;
      prevQty = prev?.qty || 0;
      prevRevenue = prev?.revenue || 0;
    }

    // ---- Modifier Revenue ----
    const modRows = db.prepare(`
      SELECT oi.modifiers FROM order_items oi
      ${where} AND oi.modifiers LIKE '[%'${itemIgnoreFilter}
    `).all(...itemParams) as { modifiers: string }[];

    let modifierRevenueCents = 0;
    let paidModCount = 0;
    let freeModCount = 0;
    const modCounts = new Map<string, { name: string; group: string; count: number; paidCount: number; freeCount: number; revenueCents: number; items: Map<string, number> }>();

    // Also need display_name for per-item modifier tracking
    const modRowsWithItem = db.prepare(`
      SELECT oi.modifiers, oi.display_name FROM order_items oi
      ${where} AND oi.modifiers LIKE '[%'${itemIgnoreFilter}
    `).all(...itemParams) as { modifiers: string; display_name: string }[];

    for (const row of modRowsWithItem) {
      try {
        const mods = JSON.parse(row.modifiers) as { group: string; name: string; price: number }[];
        for (const m of mods) {
          const priceCents = Math.round((m.price || 0) * 100);
          modifierRevenueCents += priceCents;
          if (priceCents > 0) paidModCount++; else freeModCount++;

          const key = m.name;
          const existing = modCounts.get(key) || { name: m.name, group: m.group || "", count: 0, paidCount: 0, freeCount: 0, revenueCents: 0, items: new Map() };
          existing.count++;
          if (priceCents > 0) existing.paidCount++; else existing.freeCount++;
          existing.revenueCents += priceCents;
          existing.items.set(row.display_name, (existing.items.get(row.display_name) || 0) + 1);
          modCounts.set(key, existing);
        }
      } catch { /* skip malformed JSON */ }
    }

    const totalOrders = (db.prepare(`
      SELECT COUNT(*) as cnt FROM orders
      WHERE date >= ? AND date <= ? AND platform != ''
        ${platformFilter ? "AND platform = ?" : ""}
    `).get(
      startDate || "2000-01-01", endDate || "2099-12-31",
      ...(platformFilter ? [platformFilter] : [])
    ) as { cnt: number })?.cnt || 1;

    const modifierAnalytics = [...modCounts.values()]
      .sort((a, b) => b.count - a.count)
      .map(m => ({
        name: m.name,
        group: m.group,
        count: m.count,
        paidCount: m.paidCount,
        freeCount: m.freeCount,
        revenue: m.revenueCents / 100,
        avgPrice: m.count > 0 ? Math.round(m.revenueCents / m.count) / 100 : 0,
        paidAvgPrice: m.paidCount > 0 ? Math.round(m.revenueCents / m.paidCount) / 100 : 0,
        attachRate: Math.round((m.count / totalOrders) * 1000) / 10,
        topItems: [...m.items.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name),
      }));

    // ---- Category Performance ----
    const categoryColors: Record<string, string> = {};
    try {
      const cats = catDb.prepare("SELECT name, color FROM menu_categories").all() as { name: string; color: string }[];
      for (const c of cats) categoryColors[c.name] = c.color;
    } catch { /* table may not exist */ }

    const categories = db.prepare(`
      SELECT oi.display_category as name, COUNT(DISTINCT oi.display_name) as itemCount,
        SUM(oi.qty) as qty, ROUND(SUM(oi.gross_sales), 2) as revenue
      FROM order_items oi ${where}${itemIgnoreFilter}${catIgnoreFilter}
      GROUP BY oi.display_category
      ORDER BY revenue DESC
    `).all(...itemParams, ...categoryIgnores) as { name: string; itemCount: number; qty: number; revenue: number }[];

    const catTotalRev = categories.reduce((s, c) => s + c.revenue, 0);
    const categoriesWithPct = categories.map(c => ({
      ...c,
      color: categoryColors[c.name] || "#6366f1",
      pctOfTotal: catTotalRev > 0 ? Math.round((c.revenue / catTotalRev) * 1000) / 10 : 0,
    }));

    // ---- Items ----
    const items = db.prepare(`
      SELECT oi.display_name as name, oi.display_category as category,
        SUM(oi.qty) as qty, ROUND(SUM(oi.gross_sales), 2) as revenue,
        GROUP_CONCAT(DISTINCT oi.platform) as platforms
      FROM order_items oi ${where}${itemIgnoreFilter}
      GROUP BY oi.display_name
      ORDER BY revenue DESC
    `).all(...itemParams) as { name: string; category: string; qty: number; revenue: number; platforms: string }[];

    // Prior period per item
    const prevItemMap = new Map<string, number>();
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const daysDiff = Math.round((end.getTime() - start.getTime()) / 86400000);
      const prevStart = new Date(start.getTime() - (daysDiff + 1) * 86400000).toISOString().split("T")[0];
      const prevEnd = new Date(start.getTime() - 86400000).toISOString().split("T")[0];

      const prevItems = db.prepare(`
        SELECT oi.display_name as name, SUM(oi.qty) as qty
        FROM order_items oi
        WHERE oi.event_type = 'Payment' AND oi.qty > 0
          AND oi.date >= ? AND oi.date <= ?${itemIgnoreFilter}
        GROUP BY oi.display_name
      `).all(prevStart, prevEnd, ...itemIgnores) as { name: string; qty: number }[];
      for (const p of prevItems) prevItemMap.set(p.name, p.qty);
    }

    // Daily sparkline data (last 30 points)
    const dailyData = db.prepare(`
      SELECT oi.date, oi.display_name as name, SUM(oi.qty) as qty
      FROM order_items oi ${where}${itemIgnoreFilter}
      GROUP BY oi.date, oi.display_name
    `).all(...itemParams) as { date: string; name: string; qty: number }[];

    const dailyByItem = new Map<string, Map<string, number>>();
    const allDates = new Set<string>();
    for (const d of dailyData) {
      allDates.add(d.date);
      if (!dailyByItem.has(d.name)) dailyByItem.set(d.name, new Map());
      dailyByItem.get(d.name)!.set(d.date, d.qty);
    }
    const sortedDates = [...allDates].sort();

    // Per-item modifier breakdown
    const itemModifiers = new Map<string, Map<string, { count: number; revenueCents: number }>>();
    for (const row of modRowsWithItem) {
      try {
        const mods = JSON.parse(row.modifiers) as { name: string; price: number }[];
        if (!itemModifiers.has(row.display_name)) itemModifiers.set(row.display_name, new Map());
        const modMap = itemModifiers.get(row.display_name)!;
        for (const m of mods) {
          const key = m.name;
          const existing = modMap.get(key) || { count: 0, revenueCents: 0 };
          existing.count++;
          existing.revenueCents += Math.round((m.price || 0) * 100);
          modMap.set(key, existing);
        }
      } catch { /* skip */ }
    }

    const itemsWithDetails = items.map(item => ({
      name: item.name,
      category: item.category,
      qty: item.qty,
      revenue: item.revenue,
      avgPrice: item.qty > 0 ? Math.round((item.revenue / item.qty) * 100) / 100 : 0,
      platforms: item.platforms ? item.platforms.split(",") : [],
      trend: sortedDates.map(d => dailyByItem.get(item.name)?.get(d) || 0),
      prevQty: prevItemMap.get(item.name) || 0,
      modifiers: itemModifiers.has(item.name)
        ? [...itemModifiers.get(item.name)!.entries()]
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 10)
            .map(([name, data]) => ({
              name,
              count: data.count,
              revenue: data.revenueCents / 100,
              avgPrice: data.count > 0 ? Math.round(data.revenueCents / data.count) / 100 : 0,
            }))
        : [],
    }));

    // ---- Cross-Platform Comparison ----
    const platformItems = db.prepare(`
      SELECT oi.display_name as name, oi.platform,
        SUM(oi.qty) as qty, ROUND(SUM(oi.gross_sales), 2) as revenue
      FROM order_items oi ${where}${itemIgnoreFilter}
      GROUP BY oi.display_name, oi.platform
      ORDER BY oi.display_name
    `).all(...itemParams) as { name: string; platform: string; qty: number; revenue: number }[];

    const crossPlatformMap = new Map<string, { platform: string; qty: number; revenue: number }[]>();
    for (const row of platformItems) {
      if (!crossPlatformMap.has(row.name)) crossPlatformMap.set(row.name, []);
      crossPlatformMap.get(row.name)!.push({ platform: row.platform, qty: row.qty, revenue: row.revenue });
    }

    const crossPlatform = [...crossPlatformMap.entries()]
      .filter(([, platforms]) => platforms.length > 1)
      .map(([name, platforms]) => ({ name, platforms }))
      .sort((a, b) => {
        const aTotal = a.platforms.reduce((s, p) => s + p.revenue, 0);
        const bTotal = b.platforms.reduce((s, p) => s + p.revenue, 0);
        return bTotal - aTotal;
      });

    return NextResponse.json({
      summary: {
        totalItems,
        totalQty,
        totalRevenue,
        avgPrice,
        modifierRevenue: modifierRevenueCents / 100,
        prevQty,
        prevRevenue,
        paidModCount,
        freeModCount,
        totalModSelections: paidModCount + freeModCount,
      },
      categories: categoriesWithPct,
      items: itemsWithDetails,
      modifiers: modifierAnalytics,
      crossPlatform,
      dates: sortedDates,
    });
  } catch (error) {
    console.error("[Menu Performance] Error:", error);
    return NextResponse.json({ error: "Failed to load menu performance data" }, { status: 500 });
  }
}
