import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveItemNames } from "@/lib/services/menu-item-aliases";

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
  const rawStart = searchParams.get("startDate");
  const rawEnd = searchParams.get("endDate");
  const rawDays = searchParams.get("days");
  const page = parseInt(searchParams.get("page") || "0");
  const limit = parseInt(searchParams.get("limit") || "50");

  let startDate: Date;
  let endDate: Date | undefined;

  if (rawStart) {
    startDate = new Date(rawStart + "T00:00:00.000Z");
    if (rawEnd) {
      endDate = new Date(rawEnd + "T23:59:59.999Z");
    }
  } else if (rawDays) {
    const days = parseInt(rawDays);
    startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
  } else {
    startDate = new Date(0);
  }

  const dateFilter = { gte: startDate, ...(endDate ? { lte: endDate } : {}) };
  const where = { platform, orderDatetime: dateFilter };

  // Run all queries in parallel
  const queries: Promise<unknown>[] = [
    // [0] Aggregate stats
    prisma.platformOrder.aggregate({
      where,
      _sum: {
        subtotal: true,
        tax: true,
        tip: true,
        commissionFee: true,
        serviceFee: true,
        deliveryFee: true,
        marketingFees: true,
        customerFees: true,
        netPayout: true,
        discounts: true,
        refunds: true,
        adjustments: true,
      },
      _avg: { subtotal: true },
      _count: true,
    }),

    // [1] Daily revenue trend
    prisma.$queryRawUnsafe<
      { date: string; total: number; orders: number }[]
    >(
      `SELECT date(order_datetime) as date,
              SUM(subtotal + tax + tip) as total,
              COUNT(*) as orders
       FROM platform_orders
       WHERE platform = ? AND order_datetime >= ?${endDate ? " AND order_datetime <= ?" : ""}
       GROUP BY date(order_datetime)
       ORDER BY date ASC`,
      platform,
      startDate.toISOString(),
      ...(endDate ? [endDate.toISOString()] : [])
    ),

    // [2] Paginated orders
    prisma.platformOrder.findMany({
      where,
      orderBy: { orderDatetime: "desc" },
      skip: page * limit,
      take: limit,
    }),

    // [3] Total order count for pagination
    prisma.platformOrder.count({ where }),
  ];

  // Square-specific: payment type breakdown
  if (platform === "square") {
    queries.push(
      // [4] Card brand grouping
      prisma.platformOrder.groupBy({
        by: ["cardBrand"],
        where,
        _sum: { netPayout: true, subtotal: true, tax: true, tip: true },
        _count: true,
      }),
      // [5] Dining option grouping
      prisma.platformOrder.groupBy({
        by: ["diningOption"],
        where,
        _sum: { subtotal: true, tax: true, tip: true, netPayout: true },
        _count: true,
      })
    );
  }

  // Delivery platforms: order type breakdown
  if (platform === "doordash" || platform === "ubereats") {
    queries.push(
      // [4] Channel grouping (Marketplace vs Storefront, etc.)
      prisma.platformOrder.groupBy({
        by: ["channel"],
        where,
        _sum: { subtotal: true, tax: true, tip: true, netPayout: true, commissionFee: true, serviceFee: true, deliveryFee: true },
        _count: true,
      })
    );
  }

  if (platform === "grubhub") {
    queries.push(
      // [4] Fulfillment type grouping (delivery/pickup)
      prisma.platformOrder.groupBy({
        by: ["fulfillmentType"],
        where,
        _sum: { subtotal: true, tax: true, tip: true, netPayout: true, commissionFee: true, serviceFee: true, deliveryFee: true },
        _count: true,
      })
    );
  }

  const results = await Promise.all(queries);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agg = results[0] as any;
  const dailyRevenue = (results[1] as { date: string; total: number; orders: number }[]).map((d) => ({
    date: d.date,
    total: Number(d.total),
    orders: Number(d.orders),
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orders = results[2] as any[];
  const totalCount = results[3] as number;

  const grossRevenue = (agg._sum.subtotal || 0) + (agg._sum.tax || 0) + (agg._sum.tip || 0);
  const totalFees = (agg._sum.commissionFee || 0) + (agg._sum.serviceFee || 0);
  const commissionRate = grossRevenue > 0 ? Math.round((totalFees / grossRevenue) * 1000) / 10 : 0;

  // Build response
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response: Record<string, any> = {
    platform,
    orderCount: agg._count,
    grossRevenue,
    totalFees,
    netPayout: agg._sum.netPayout || 0,
    commissionRate,
    avgOrderValue: agg._avg.subtotal || 0,
    tips: agg._sum.tip || 0,
    feeBreakdown: {
      commission: agg._sum.commissionFee || 0,
      service: agg._sum.serviceFee || 0,
      delivery: agg._sum.deliveryFee || 0,
      marketing: agg._sum.marketingFees || 0,
      customer: agg._sum.customerFees || 0,
    },
    dailyRevenue,
    orders: orders.map((o) => ({
      id: o.id,
      orderId: o.orderId,
      datetime: o.orderDatetime,
      subtotal: o.subtotal,
      tax: o.tax,
      tip: o.tip,
      fees: o.commissionFee + o.serviceFee + o.deliveryFee,
      netPayout: o.netPayout,
      cardBrand: o.cardBrand,
      diningOption: o.diningOption,
      channel: o.channel,
      fulfillmentType: o.fulfillmentType,
    })),
    totalOrders: totalCount,
    totalPages: Math.ceil(totalCount / limit),
  };

  // Square-specific breakdowns
  if (platform === "square" && results[4]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cardBrandData = results[4] as any[];
    response.paymentTypeBreakdown = cardBrandData
      .map((e) => {
        const brand = (e.cardBrand || "").trim();
        let label: string;
        if (!brand) {
          label = "Cash";
        } else if (brand.includes(",")) {
          label = "Split Payment";
        } else {
          label = brand;
        }
        return {
          type: label,
          total: e._sum.netPayout || 0,
          subtotal: e._sum.subtotal || 0,
          tax: e._sum.tax || 0,
          tip: e._sum.tip || 0,
          count: e._count,
        };
      })
      .reduce<{ type: string; total: number; subtotal: number; tax: number; tip: number; count: number }[]>(
        (acc, cur) => {
          const existing = acc.find((a) => a.type === cur.type);
          if (existing) {
            existing.total += cur.total;
            existing.subtotal += cur.subtotal;
            existing.tax += cur.tax;
            existing.tip += cur.tip;
            existing.count += cur.count;
          } else {
            acc.push({ ...cur });
          }
          return acc;
        },
        []
      )
      .sort((a, b) => b.total - a.total);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const diningData = results[5] as any[];
    response.diningOptionBreakdown = diningData
      .map((d) => ({
        option: d.diningOption || "Unknown",
        count: d._count,
        revenue: (d._sum.subtotal || 0) + (d._sum.tax || 0) + (d._sum.tip || 0),
      }))
      .sort((a, b) => b.revenue - a.revenue);

    // Parse rawData to get item-level analytics
    const allSquareOrders = await prisma.platformOrder.findMany({
      where,
      select: { rawData: true },
    });

    // First pass: collect all unique raw item names
    const rawItemNames = new Set<string>();
    const parsedOrders: { name: string; category: string; qty: number; netSales: number }[][] = [];

    for (const order of allSquareOrders) {
      if (!order.rawData) continue;
      try {
        const items = JSON.parse(order.rawData) as Record<string, string>[];
        const orderItems: { name: string; category: string; qty: number; netSales: number }[] = [];
        for (const item of items) {
          const name = (item["item"] || "").trim();
          const category = (item["category"] || "Uncategorized").trim();
          const qty = parseFloat(item["qty"] || "0") || 0;
          const netSales = parseFloat((item["net sales"] || "0").replace(/[$,]/g, "")) || 0;
          if (!name || qty <= 0) continue;
          rawItemNames.add(name);
          orderItems.push({ name, category, qty, netSales });
        }
        parsedOrders.push(orderItems);
      } catch {
        // skip unparseable rawData
      }
    }

    // Resolve all item names through aliases in one batch
    const aliasMap = await resolveItemNames([...rawItemNames]);

    // Second pass: aggregate using resolved names
    const itemMap = new Map<string, { name: string; category: string; qty: number; revenue: number }>();
    const categoryMap = new Map<string, { category: string; qty: number; revenue: number; itemCount: number }>();

    for (const orderItems of parsedOrders) {
      for (const item of orderItems) {
        const resolvedName = aliasMap.get(item.name) || item.name;

        // Item-level aggregation (keyed by resolved name)
        const existing = itemMap.get(resolvedName);
        if (existing) {
          existing.qty += item.qty;
          existing.revenue += item.netSales;
        } else {
          itemMap.set(resolvedName, { name: resolvedName, category: item.category, qty: item.qty, revenue: item.netSales });
        }

        // Category-level aggregation
        const catExisting = categoryMap.get(item.category);
        if (catExisting) {
          catExisting.qty += item.qty;
          catExisting.revenue += item.netSales;
          catExisting.itemCount++;
        } else {
          categoryMap.set(item.category, { category: item.category, qty: item.qty, revenue: item.netSales, itemCount: 1 });
        }
      }
    }

    response.topItems = [...itemMap.values()]
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 20);

    response.categoryBreakdown = [...categoryMap.values()]
      .sort((a, b) => b.revenue - a.revenue);
  }

  // Delivery platform breakdowns
  if ((platform === "doordash" || platform === "ubereats") && results[4]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const channelData = results[4] as any[];
    response.orderTypeBreakdown = channelData
      .map((d) => ({
        type: d.channel || "Unknown",
        count: d._count,
        revenue: (d._sum.subtotal || 0) + (d._sum.tax || 0) + (d._sum.tip || 0),
        netPayout: d._sum.netPayout || 0,
        fees: (d._sum.commissionFee || 0) + (d._sum.serviceFee || 0) + (d._sum.deliveryFee || 0),
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  if (platform === "grubhub" && results[4]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fulfillmentData = results[4] as any[];
    response.orderTypeBreakdown = fulfillmentData
      .map((d) => ({
        type: d.fulfillmentType || "Unknown",
        count: d._count,
        revenue: (d._sum.subtotal || 0) + (d._sum.tax || 0) + (d._sum.tip || 0),
        netPayout: d._sum.netPayout || 0,
        fees: (d._sum.commissionFee || 0) + (d._sum.serviceFee || 0) + (d._sum.deliveryFee || 0),
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  return NextResponse.json(response);
}
