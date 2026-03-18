/**
 * Platforms overview API — reads from sales.db
 */
import { NextRequest, NextResponse } from "next/server";
import { getSalesDb } from "@/lib/db/sales-db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  const db = getSalesDb();

  const conditions: string[] = [];
  const params: string[] = [];

  if (startDate) {
    conditions.push("date >= ?");
    params.push(startDate);
  }
  if (endDate) {
    conditions.push("date <= ?");
    params.push(endDate);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Platform stats from orders table
  const platformStats = db.prepare(`
    SELECT platform,
      COUNT(*) as order_count,
      ROUND(SUM(gross_sales), 2) as gross_sales,
      ROUND(SUM(tax), 2) as tax,
      ROUND(SUM(tip), 2) as tip,
      ROUND(SUM(fees_total), 2) as fees_total,
      ROUND(SUM(marketing_total), 2) as marketing_total,
      ROUND(SUM(net_sales), 2) as net_sales,
      ROUND(AVG(gross_sales), 2) as avg_order,
      ROUND(AVG(net_sales), 2) as avg_net,
      ROUND(SUM(commission_fee), 2) as commission_fee,
      ROUND(SUM(processing_fee), 2) as processing_fee,
      ROUND(SUM(delivery_fee), 2) as delivery_fee,
      ROUND(SUM(discounts), 2) as discounts
    FROM orders ${where}
    GROUP BY platform
    ORDER BY SUM(gross_sales) DESC
  `).all(...params) as {
    platform: string; order_count: number; gross_sales: number; tax: number;
    tip: number; fees_total: number; marketing_total: number; net_sales: number;
    avg_order: number; avg_net: number; commission_fee: number;
    processing_fee: number; delivery_fee: number; discounts: number;
  }[];

  const platforms = platformStats.map((p) => {
    const grossRevenue = p.gross_sales + p.tax + p.tip;
    const commissionRate = grossRevenue > 0 ? (Math.abs(p.fees_total) / grossRevenue) * 100 : 0;

    return {
      platform: p.platform,
      orderCount: p.order_count,
      grossRevenue,
      grossSales: p.gross_sales,
      totalFees: p.fees_total,
      marketingTotal: p.marketing_total,
      netPayout: p.net_sales,
      netRevenue: p.gross_sales + p.fees_total + p.marketing_total + (p.discounts || 0),
      commissionRate: Math.round(commissionRate * 10) / 10,
      avgOrderValue: p.avg_order,
      avgNetPayout: p.avg_net,
      tips: p.tip,
      tax: p.tax,
      commissionFee: p.commission_fee,
      processingFee: p.processing_fee,
      deliveryFee: p.delivery_fee,
      discounts: p.discounts,
    };
  });

  // Daily orders by platform
  const dailyOrders = db.prepare(`
    SELECT date, platform,
      COUNT(*) as orders,
      ROUND(SUM(gross_sales), 2) as revenue
    FROM orders ${where}
    GROUP BY date, platform
    ORDER BY date ASC
  `).all(...params) as { date: string; platform: string; orders: number; revenue: number }[];

  return NextResponse.json({
    platforms,
    dailyOrders: dailyOrders.map((d) => ({
      ...d,
      orders: Number(d.orders),
      revenue: Number(d.revenue),
    })),
  });
}
