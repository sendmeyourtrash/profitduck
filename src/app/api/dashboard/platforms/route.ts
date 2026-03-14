import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawStart = searchParams.get("startDate");
  const rawEnd = searchParams.get("endDate");
  const rawDays = searchParams.get("days");

  let startDate: Date;
  let endDate: Date | undefined;

  if (rawStart) {
    startDate = new Date(rawStart);
    if (rawEnd) {
      endDate = new Date(rawEnd);
      endDate.setHours(23, 59, 59, 999);
    }
  } else if (rawDays) {
    const days = parseInt(rawDays);
    startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
  } else {
    startDate = new Date(0);
  }

  const dateFilter = { gte: startDate, ...(endDate ? { lte: endDate } : {}) };

  // Platform order stats
  const platformStats = await prisma.platformOrder.groupBy({
    by: ["platform"],
    where: { orderDatetime: dateFilter },
    _sum: {
      subtotal: true,
      tax: true,
      tip: true,
      commissionFee: true,
      serviceFee: true,
      deliveryFee: true,
      netPayout: true,
    },
    _avg: {
      subtotal: true,
      netPayout: true,
      commissionFee: true,
    },
    _count: true,
  });

  // Commission rate per platform
  const platforms = platformStats.map((p) => {
    const grossRevenue =
      (p._sum.subtotal || 0) + (p._sum.tax || 0) + (p._sum.tip || 0);
    const totalFees = (p._sum.commissionFee || 0) + (p._sum.serviceFee || 0);
    const commissionRate = grossRevenue > 0 ? (totalFees / grossRevenue) * 100 : 0;

    return {
      platform: p.platform,
      orderCount: p._count,
      grossRevenue,
      totalFees,
      netPayout: p._sum.netPayout || 0,
      commissionRate: Math.round(commissionRate * 10) / 10,
      avgOrderValue: p._avg.subtotal || 0,
      avgNetPayout: p._avg.netPayout || 0,
      tips: p._sum.tip || 0,
    };
  });

  // Daily orders by platform
  const dailyOrders = await prisma.$queryRawUnsafe<
    { date: string; platform: string; orders: number; revenue: number }[]
  >(
    `SELECT date(order_datetime) as date, platform,
            COUNT(*) as orders, SUM(subtotal + tax + tip) as revenue
     FROM platform_orders
     WHERE order_datetime >= ?${endDate ? " AND order_datetime <= ?" : ""}
     GROUP BY date(order_datetime), platform
     ORDER BY date ASC`,
    ...[startDate.toISOString(), ...(endDate ? [endDate.toISOString()] : [])]
  );

  return NextResponse.json({
    platforms,
    dailyOrders: dailyOrders.map((d) => ({
      ...d,
      orders: Number(d.orders),
      revenue: Number(d.revenue),
    })),
  });
}
