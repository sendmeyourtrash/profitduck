/**
 * Dashboard Revenue API — Daily revenue data from sales.db
 *
 * Returns daily revenue totals, platform breakdown, and daily-by-platform data
 * for the revenue chart and platform pie chart on the dashboard.
 */
import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";

const DB_DIR = path.join(process.cwd(), "databases");

function openDb(name: string) {
  return new Database(path.join(DB_DIR, name), { readonly: true });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  const db = openDb("sales.db");

  try {
    const baseConds = ["order_status = 'completed'"];
    const baseParams: string[] = [];
    if (startDate) { baseConds.push("date >= ?"); baseParams.push(startDate); }
    if (endDate) { baseConds.push("date <= ?"); baseParams.push(endDate); }
    const where = baseConds.join(" AND ");

    // Daily revenue
    const dailyRevenue = db.prepare(`
      SELECT date, ROUND(SUM(gross_sales), 2) as total, COUNT(*) as count
      FROM orders WHERE ${where}
      GROUP BY date ORDER BY date ASC
    `).all(...baseParams) as { date: string; total: number; count: number }[];

    // Revenue by platform
    const revenueByPlatform = db.prepare(`
      SELECT platform, ROUND(SUM(gross_sales), 2) as revenue, COUNT(*) as count
      FROM orders WHERE ${where}
      GROUP BY platform ORDER BY revenue DESC
    `).all(...baseParams) as { platform: string; revenue: number; count: number }[];

    // Average order value by platform
    const avgOrderByPlatform = db.prepare(`
      SELECT platform,
        ROUND(AVG(gross_sales), 2) as avg_gross,
        ROUND(AVG(net_sales), 2) as avg_net,
        COUNT(*) as order_count
      FROM orders WHERE ${where}
      GROUP BY platform ORDER BY avg_gross DESC
    `).all(...baseParams) as { platform: string; avg_gross: number; avg_net: number; order_count: number }[];

    // Daily revenue by platform
    const dailyByPlatform = db.prepare(`
      SELECT date, platform, ROUND(SUM(gross_sales), 2) as total
      FROM orders WHERE ${where}
      GROUP BY date, platform ORDER BY date ASC
    `).all(...baseParams) as { date: string; platform: string; total: number }[];

    return NextResponse.json({
      dailyRevenue: dailyRevenue.map((d) => ({
        date: d.date,
        total: Number(d.total),
        count: Number(d.count),
      })),
      revenueByPlatform: revenueByPlatform.map((r) => ({
        platform: r.platform,
        revenue: Number(r.revenue),
        count: Number(r.count),
      })),
      avgOrderByPlatform: avgOrderByPlatform.map((a) => ({
        platform: a.platform,
        avgSubtotal: Number(a.avg_gross),
        avgNetPayout: Number(a.avg_net),
        orderCount: Number(a.order_count),
      })),
      dailyByPlatform: dailyByPlatform.map((d) => ({
        date: d.date,
        platform: d.platform,
        total: Number(d.total),
      })),
    });
  } finally {
    db.close();
  }
}
