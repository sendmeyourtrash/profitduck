/**
 * Per-platform detail API — reads from sales.db orders + order_items
 */
import { NextRequest, NextResponse } from "next/server";
import { getSalesDb } from "@/lib/db/sales-db";
import { getCategoriesDb } from "@/lib/db/config-db";

const VALID_PLATFORMS = new Set(["square", "doordash", "ubereats", "grubhub"]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params;

  if (!VALID_PLATFORMS.has(platform)) {
    return NextResponse.json({ error: "Invalid platform" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const page = parseInt(searchParams.get("page") || "0");
  const limit = parseInt(searchParams.get("limit") || "50");

  const db = getSalesDb();

  const conditions = ["platform = ?"];
  const queryParams: (string | number)[] = [platform];

  if (startDate) { conditions.push("date >= ?"); queryParams.push(startDate); }
  if (endDate) { conditions.push("date <= ?"); queryParams.push(endDate); }

  const where = `WHERE ${conditions.join(" AND ")}`;

  // Aggregate stats
  const agg = db.prepare(`
    SELECT COUNT(*) as order_count,
      ROUND(SUM(gross_sales), 2) as gross_sales,
      ROUND(SUM(tax), 2) as tax,
      ROUND(SUM(tip), 2) as tip,
      ROUND(SUM(fees_total), 2) as fees_total,
      ROUND(SUM(marketing_total), 2) as marketing_total,
      ROUND(SUM(net_sales), 2) as net_sales,
      ROUND(AVG(gross_sales), 2) as avg_order,
      ROUND(SUM(commission_fee), 2) as commission_fee,
      ROUND(SUM(processing_fee), 2) as processing_fee,
      ROUND(SUM(delivery_fee), 2) as delivery_fee,
      ROUND(SUM(marketing_fee), 2) as marketing_fee,
      ROUND(SUM(discounts), 2) as discounts,
      ROUND(SUM(refunds_total), 2) as refunds_total,
      ROUND(SUM(adjustments_total), 2) as adjustments_total
    FROM orders ${where}
  `).get(...queryParams) as Record<string, number>;

  const grossRevenue = (agg.gross_sales || 0) + (agg.tax || 0) + (agg.tip || 0);
  const commissionRate = grossRevenue > 0 ? Math.round((Math.abs(agg.fees_total || 0) / grossRevenue) * 1000) / 10 : 0;

  // Daily revenue trend
  const dailyRevenue = db.prepare(`
    SELECT date, ROUND(SUM(gross_sales), 2) as total, COUNT(*) as orders
    FROM orders ${where}
    GROUP BY date ORDER BY date ASC
  `).all(...queryParams) as { date: string; total: number; orders: number }[];

  // Paginated orders
  const orders = db.prepare(`
    SELECT * FROM orders ${where}
    ORDER BY date DESC, time DESC
    LIMIT ? OFFSET ?
  `).all(...queryParams, limit, page * limit) as Record<string, unknown>[];

  const totalCount = (db.prepare(`SELECT COUNT(*) as cnt FROM orders ${where}`).get(...queryParams) as { cnt: number }).cnt;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response: Record<string, any> = {
    platform,
    orderCount: agg.order_count,
    grossRevenue,
    grossSales: agg.gross_sales,
    totalFees: agg.fees_total,
    marketingTotal: agg.marketing_total,
    netPayout: agg.net_sales,
    netRevenue: (agg.gross_sales || 0) + (agg.fees_total || 0) + (agg.marketing_total || 0) + (agg.discounts || 0),
    commissionRate,
    avgOrderValue: agg.avg_order,
    tips: agg.tip,
    tax: agg.tax,
    feeBreakdown: {
      commission: agg.commission_fee || 0,
      processing: agg.processing_fee || 0,
      delivery: agg.delivery_fee || 0,
      marketing: agg.marketing_fee || 0,
    },
    dailyRevenue: dailyRevenue.map((d) => ({ date: d.date, total: Number(d.total), orders: Number(d.orders) })),
    orders: orders.map((o) => ({
      id: `${o.platform}-${o.order_id}`,
      orderId: o.order_id,
      datetime: o.date,
      subtotal: o.gross_sales,
      tax: o.tax,
      tip: o.tip,
      fees: o.fees_total,
      netPayout: o.net_sales,
      items: o.items,
      cardBrand: o.payment_method || "",
      diningOption: o.dining_option,
      orderStatus: o.order_status,
    })),
    totalOrders: totalCount,
    totalPages: Math.ceil(totalCount / limit),
  };

  // Item and category analytics from order_items (using display names after aliases)
  if (platform === "square") {
    const itemConditions = conditions.map(c => c.replace("platform", "oi.platform").replace("date", "oi.date"));
    const itemWhere = `WHERE ${itemConditions.join(" AND ")}`;

    // Load ignore lists from categories.db
    const catDb = getCategoriesDb();
    const itemIgnores = (catDb.prepare("SELECT item_name FROM menu_item_ignores").all() as { item_name: string }[])
      .map(r => r.item_name);
    let categoryIgnores: string[] = [];
    try {
      categoryIgnores = (catDb.prepare("SELECT category_name FROM category_ignores").all() as { category_name: string }[])
        .map(r => r.category_name);
    } catch { /* table may not exist yet */ }

    // Build ignore filter for items
    const itemIgnoreFilter = itemIgnores.length > 0
      ? ` AND oi.display_name NOT IN (${itemIgnores.map(() => "?").join(",")})`
      : "";
    const itemQueryParams = [...queryParams, ...itemIgnores];

    // Top items (using display_name, filtered by ignore list)
    const topItems = db.prepare(`
      SELECT oi.display_name as name, oi.display_category as category,
        ROUND(SUM(oi.qty), 0) as qty, ROUND(SUM(oi.net_sales), 2) as revenue
      FROM order_items oi
      ${itemWhere} AND oi.event_type = 'Payment' AND oi.qty > 0${itemIgnoreFilter}
      GROUP BY oi.display_name
      ORDER BY qty DESC
    `).all(...itemQueryParams) as { name: string; category: string; qty: number; revenue: number }[];

    response.topItems = topItems;

    // Build ignore filter for categories
    const catIgnoreFilter = categoryIgnores.length > 0
      ? ` AND oi.display_category NOT IN (${categoryIgnores.map(() => "?").join(",")})`
      : "";
    const catQueryParams = [...queryParams, ...categoryIgnores];

    // Category breakdown (using display_category, filtered by ignore list)
    const categoryBreakdown = db.prepare(`
      SELECT oi.display_category as category,
        ROUND(SUM(oi.qty), 0) as qty, ROUND(SUM(oi.net_sales), 2) as revenue,
        COUNT(*) as itemCount
      FROM order_items oi
      ${itemWhere} AND oi.event_type = 'Payment' AND oi.qty > 0${catIgnoreFilter}
      GROUP BY oi.display_category
      ORDER BY revenue DESC
    `).all(...catQueryParams) as { category: string; qty: number; revenue: number; itemCount: number }[];

    response.categoryBreakdown = categoryBreakdown;

    // Payment type breakdown
    const paymentBreakdown = db.prepare(`
      SELECT payment_method, COUNT(*) as count,
        ROUND(SUM(gross_sales), 2) as subtotal,
        ROUND(SUM(tax), 2) as tax,
        ROUND(SUM(tip), 2) as tip,
        ROUND(SUM(net_sales), 2) as total
      FROM orders ${where} AND payment_method IS NOT NULL AND payment_method != ''
      GROUP BY payment_method ORDER BY total DESC
    `).all(...queryParams) as { payment_method: string; count: number; subtotal: number; tax: number; tip: number; total: number }[];

    response.paymentTypeBreakdown = paymentBreakdown.map((p) => ({
      type: p.payment_method || "Cash",
      count: p.count,
      subtotal: p.subtotal,
      tax: p.tax,
      tip: p.tip,
      total: p.total,
    }));

    // Dining option breakdown
    const diningBreakdown = db.prepare(`
      SELECT dining_option, COUNT(*) as count,
        ROUND(SUM(gross_sales + tax + tip), 2) as revenue
      FROM orders ${where}
      GROUP BY dining_option ORDER BY revenue DESC
    `).all(...queryParams) as { dining_option: string; count: number; revenue: number }[];

    response.diningOptionBreakdown = diningBreakdown.map((d) => ({
      option: d.dining_option || "Unknown",
      count: d.count,
      revenue: d.revenue,
    }));
  }

  // Delivery platform breakdowns
  if (platform === "doordash" || platform === "ubereats" || platform === "grubhub") {
    const diningBreakdown = db.prepare(`
      SELECT dining_option as type, COUNT(*) as count,
        ROUND(SUM(gross_sales + tax + tip), 2) as revenue,
        ROUND(SUM(net_sales), 2) as netPayout,
        ROUND(SUM(fees_total), 2) as fees
      FROM orders ${where}
      GROUP BY dining_option ORDER BY revenue DESC
    `).all(...queryParams) as { type: string; count: number; revenue: number; netPayout: number; fees: number }[];

    response.orderTypeBreakdown = diningBreakdown;
  }

  return NextResponse.json(response);
}
