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

  try {

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
    orders: (() => {
      // Batch-fetch order_items for this page (same pattern as /api/transactions)
      const orderKeys = orders
        .filter(o => o.order_id)
        .map(o => ({ id: o.order_id as string, platform: o.platform as string }));
      let orderItemsMap: Record<string, { item_name: string; qty: number; unit_price: number; gross_sales: number; modifiers: string; display_name: string }[]> = {};

      if (orderKeys.length > 0) {
        try {
          const conds = orderKeys.map(() => "(order_id = ? AND platform = ?)").join(" OR ");
          const params = orderKeys.flatMap(k => [k.id, k.platform]);
          const itemRows = db.prepare(
            `SELECT order_id, platform, item_name, qty, unit_price, gross_sales, modifiers, display_name
             FROM order_items WHERE (${conds}) AND event_type = 'Payment'`
          ).all(...params) as { order_id: string; platform: string; item_name: string; qty: number; unit_price: number; gross_sales: number; modifiers: string; display_name: string }[];

          for (const row of itemRows) {
            const key = `${row.order_id}:${row.platform}`;
            if (!orderItemsMap[key]) orderItemsMap[key] = [];
            orderItemsMap[key].push(row);
          }
        } catch (e) {
          console.warn("[Platform Detail] Failed to fetch order_items:", e);
        }
      }

      return orders.map((o) => ({
        id: `${o.platform}-${o.order_id}`,
        order_id: o.order_id,
        orderId: o.order_id,
        datetime: o.date,
        date: o.date,
        time: o.time,
        platform: o.platform,
        order_status: o.order_status || "completed",
        gross_sales: o.gross_sales,
        subtotal: o.gross_sales,
        tax: o.tax,
        tip: o.tip,
        net_sales: o.net_sales,
        fees: o.fees_total,
        netPayout: o.net_sales,
        items: o.items,
        discounts: o.discounts || 0,
        dining_option: o.dining_option,
        customer_name: o.customer_name,
        payment_method: o.payment_method,
        cardBrand: o.payment_method || "",
        diningOption: o.dining_option,
        orderStatus: o.order_status,
        commission_fee: o.commission_fee || 0,
        processing_fee: o.processing_fee || 0,
        delivery_fee: o.delivery_fee || 0,
        marketing_fee: o.marketing_fee || 0,
        fees_total: o.fees_total || 0,
        marketing_total: o.marketing_total || 0,
        refunds_total: o.refunds_total || 0,
        adjustments_total: o.adjustments_total || 0,
        other_total: o.other_total || 0,
        order_items: orderItemsMap[`${o.order_id}:${o.platform}`] || [],
      }));
    })(),
    totalOrders: totalCount,
    totalPages: Math.ceil(totalCount / limit),
  };

  // ---- Item & Category Analytics (all platforms with order_items) ----
  {
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

    // Top items (all platforms)
    const topItems = db.prepare(`
      SELECT oi.display_name as name, oi.display_category as category,
        ROUND(SUM(oi.qty), 0) as qty, ROUND(SUM(oi.net_sales), 2) as revenue
      FROM order_items oi
      ${itemWhere} AND oi.event_type = 'Payment' AND oi.qty > 0${itemIgnoreFilter}
      GROUP BY oi.display_name
      ORDER BY qty DESC
    `).all(...itemQueryParams) as { name: string; category: string; qty: number; revenue: number }[];

    if (topItems.length > 0) {
      response.topItems = topItems;
    }

    // Build ignore filter for categories
    const catIgnoreFilter = categoryIgnores.length > 0
      ? ` AND oi.display_category NOT IN (${categoryIgnores.map(() => "?").join(",")})`
      : "";
    const catQueryParams = [...queryParams, ...categoryIgnores];

    // Category breakdown (all platforms)
    const categoryBreakdown = db.prepare(`
      SELECT oi.display_category as category,
        ROUND(SUM(oi.qty), 0) as qty, ROUND(SUM(oi.net_sales), 2) as revenue,
        COUNT(*) as itemCount
      FROM order_items oi
      ${itemWhere} AND oi.event_type = 'Payment' AND oi.qty > 0${catIgnoreFilter}
      GROUP BY oi.display_category
      ORDER BY revenue DESC
    `).all(...catQueryParams) as { category: string; qty: number; revenue: number; itemCount: number }[];

    if (categoryBreakdown.length > 0) {
      response.categoryBreakdown = categoryBreakdown;
    }

    // ---- Modifier Analytics (all platforms with JSON modifiers) ----
    const modRows = db.prepare(`
      SELECT oi.modifiers FROM order_items oi
      ${itemWhere} AND oi.event_type = 'Payment' AND oi.modifiers LIKE '[%'
    `).all(...queryParams) as { modifiers: string }[];

    if (modRows.length > 0) {
      // Accumulate in integer cents to avoid float drift
      const modCounts = new Map<string, { name: string; group: string; count: number; revenueCents: number }>();
      let totalItemsWithMods = 0;

      for (const row of modRows) {
        try {
          const mods = JSON.parse(row.modifiers) as { group: string; name: string; price: number }[];
          totalItemsWithMods++;
          for (const m of mods) {
            const key = m.name;
            const existing = modCounts.get(key) || { name: m.name, group: m.group || "", count: 0, revenueCents: 0 };
            existing.count++;
            existing.revenueCents += Math.round((m.price || 0) * 100);
            modCounts.set(key, existing);
          }
        } catch { /* skip malformed JSON */ }
      }

      const totalOrders = (response as any).orderCount || 0;
      response.modifierAnalytics = [...modCounts.values()]
        .sort((a, b) => b.count - a.count)
        .map(m => ({
          name: m.name,
          group: m.group,
          count: m.count,
          revenue: m.revenueCents / 100,
          avgPrice: m.count > 0 ? Math.round(m.revenueCents / m.count) / 100 : 0,
          pctOfOrders: totalOrders > 0 ? Math.round((m.count / totalOrders) * 1000) / 10 : 0,
        }));
      response.totalItemsWithModifiers = totalItemsWithMods;
      response.totalModifierRevenue = [...modCounts.values()].reduce((s, m) => s + m.revenueCents, 0) / 100;
    }
  }

  // ---- Square-only: Payment type breakdown ----
  if (platform === "square") {
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
  }

  // ---- Dining option / Order type breakdown (all platforms, only when data exists) ----
  {
    const diningBreakdown = db.prepare(`
      SELECT dining_option, COUNT(*) as count,
        ROUND(SUM(gross_sales + tax + tip), 2) as revenue,
        ROUND(SUM(net_sales), 2) as netPayout,
        ROUND(SUM(fees_total), 2) as fees
      FROM orders ${where}
      GROUP BY dining_option ORDER BY revenue DESC
    `).all(...queryParams) as { dining_option: string; count: number; revenue: number; netPayout: number; fees: number }[];

    const filtered = diningBreakdown.filter(d => d.dining_option && d.dining_option.trim() !== "");

    if (filtered.length > 0) {
      response.diningOptionBreakdown = filtered.map(d => ({
        option: d.dining_option,
        count: d.count,
        revenue: d.revenue,
      }));

      // For delivery platforms, also provide the richer orderTypeBreakdown
      if (platform === "doordash" || platform === "ubereats" || platform === "grubhub") {
        response.orderTypeBreakdown = filtered.map(d => ({
          type: d.dining_option,
          count: d.count,
          revenue: d.revenue,
          netPayout: d.netPayout,
          fees: d.fees,
        }));
      }
    }
  }

  return NextResponse.json(response);

  } catch (error) {
    console.error(`[Platform Detail] Error for ${platform}:`, error);
    return NextResponse.json({ error: "Failed to load platform data" }, { status: 500 });
  }
}
