import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "30");

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Revenue by platform
  const revenueByPlatform = await prisma.transaction.groupBy({
    by: ["sourcePlatform"],
    where: {
      type: "income",
      date: { gte: startDate },
    },
    _sum: { amount: true },
    _count: true,
  });

  // Revenue by day (via platform orders for detailed breakdown)
  const dailyRevenue = await prisma.$queryRawUnsafe<
    { date: string; total: number; count: number }[]
  >(
    `SELECT date(date) as date, SUM(amount) as total, COUNT(*) as count
     FROM transactions
     WHERE type = 'income' AND date >= ?
     GROUP BY date(date)
     ORDER BY date(date) ASC`,
    startDate.toISOString()
  );

  // Average order value by platform
  const avgOrderByPlatform = await prisma.platformOrder.groupBy({
    by: ["platform"],
    where: { orderDatetime: { gte: startDate } },
    _avg: { subtotal: true, netPayout: true },
    _count: true,
  });

  // Daily revenue by platform
  const dailyByPlatform = await prisma.$queryRawUnsafe<
    { date: string; platform: string; total: number }[]
  >(
    `SELECT date(date) as date, source_platform as platform, SUM(amount) as total
     FROM transactions
     WHERE type = 'income' AND date >= ?
     GROUP BY date(date), source_platform
     ORDER BY date(date) ASC`,
    startDate.toISOString()
  );

  return NextResponse.json({
    revenueByPlatform: revenueByPlatform.map((r) => ({
      platform: r.sourcePlatform,
      revenue: r._sum.amount || 0,
      count: r._count,
    })),
    dailyRevenue: dailyRevenue.map((d) => ({
      date: d.date,
      total: Number(d.total),
      count: Number(d.count),
    })),
    avgOrderByPlatform: avgOrderByPlatform.map((a) => ({
      platform: a.platform,
      avgSubtotal: a._avg.subtotal || 0,
      avgNetPayout: a._avg.netPayout || 0,
      orderCount: a._count,
    })),
    dailyByPlatform,
  });
}
