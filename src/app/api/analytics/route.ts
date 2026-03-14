import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

/* ── Cached Intl formatters (created once, reused for every record) ── */
const fmtParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "numeric",
  minute: "numeric",
  weekday: "short",
  hour12: false,
});

/** Parse all Eastern-time components in a single Intl call. */
function getEasternParts(d: Date) {
  const parts = fmtParts.formatToParts(d);
  let hour = 0, minute = 0, day = 0, year = "", month = "", dayOfMonth = "";
  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  for (const p of parts) {
    switch (p.type) {
      case "hour": hour = parseInt(p.value, 10); break;
      case "minute": minute = parseInt(p.value, 10); break;
      case "weekday": day = dayMap[p.value] ?? 0; break;
      case "year": year = p.value; break;
      case "month": month = p.value; break;
      case "day": dayOfMonth = p.value; break;
    }
  }
  // hour 24 → 0 (midnight edge case in some locales)
  if (hour === 24) hour = 0;
  return { hour, minute, day, dateStr: `${year}-${month}-${dayOfMonth}` };
}

/* ── Simple in-memory response cache (TTL-based) ── */
const responseCache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 30_000; // 30 seconds

function getCached(key: string): unknown | null {
  const entry = responseCache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}

function setCache(key: string, data: unknown) {
  responseCache.set(key, { data, ts: Date.now() });
  // Evict stale entries periodically
  if (responseCache.size > 50) {
    const now = Date.now();
    for (const [k, v] of responseCache) {
      if (now - v.ts > CACHE_TTL) responseCache.delete(k);
    }
  }
}

/* ── Legacy helpers (used outside of hot loops) ── */
function getEasternDateStr(d: Date): string {
  return getEasternParts(d).dateStr;
}

/**
 * GET /api/analytics
 * Financial analytics: revenue by time period, fee analysis, busy times.
 * Query params: type (revenue_by_hour | revenue_by_dow | fee_analysis | busy_times | daily_summary)
 *               platform, startDate, endDate
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "daily_summary";
  const platform = searchParams.get("platform");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const dowFilter = searchParams.get("dow"); // 0=Sunday..6=Saturday
  const excludeClosed = searchParams.get("excludeClosed") === "true";
  const granularity = parseInt(searchParams.get("granularity") || "60", 10); // 60, 30, or 15 minutes

  // Check response cache
  const cacheKey = `${type}|${platform}|${startDate}|${endDate}|${dowFilter}|${excludeClosed}|${granularity}`;
  const cached = getCached(cacheKey);
  if (cached) return NextResponse.json(cached);

  // Load closed days set if needed
  let closedDateSet: Set<string> | null = null;
  if (excludeClosed) {
    const closedDays = await prisma.closedDay.findMany({
      select: { date: true },
    });
    closedDateSet = new Set(
      closedDays.map((cd) => getEasternDateStr(new Date(cd.date)))
    );
  }

  // Base where clause for platform orders
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orderWhere: any = {};
  if (platform) orderWhere.platform = platform;
  if (startDate || endDate) {
    orderWhere.orderDatetime = {};
    if (startDate) orderWhere.orderDatetime.gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      orderWhere.orderDatetime.lte = end;
    }
  }

  // Base where clause for transactions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const txWhere: any = {};
  if (platform) txWhere.sourcePlatform = platform;
  if (startDate || endDate) {
    txWhere.date = {};
    if (startDate) txWhere.date.gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      txWhere.date.lte = end;
    }
  }

  switch (type) {
    case "revenue_by_hour": {
      // Revenue breakdown by time of day with configurable granularity (60/30/15 min)
      // Exclude platforms without time data (UberEats only has dates)
      const orders = await prisma.platformOrder.findMany({
        where: { ...orderWhere, platform: orderWhere.platform ?? { not: "ubereats" } },
        select: { orderDatetime: true, subtotal: true, platform: true },
      });

      const slotsPerHour = 60 / granularity;
      const totalSlots = 24 * slotsPerHour;

      const hourly = Array.from({ length: totalSlots }, (_, i) => {
        const hour = Math.floor(i / slotsPerHour);
        const minuteOffset = (i % slotsPerHour) * granularity;
        const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
        const suffix = hour < 12 ? "am" : "pm";
        const label =
          granularity === 60
            ? `${h12}${suffix}`
            : `${h12}:${String(minuteOffset).padStart(2, "0")}${suffix}`;

        return {
          slot: i,
          hour,
          minute: minuteOffset,
          label,
          orderCount: 0,
          revenue: 0,
          avgOrderValue: 0,
          square: 0,
          doordash: 0,
          grubhub: 0,
          ubereats: 0,
        };
      });

      const dowNum = dowFilter !== null ? parseInt(dowFilter, 10) : null;
      const uniqueDays = new Set<string>();

      for (const o of orders) {
        const p = getEasternParts(new Date(o.orderDatetime));
        if (closedDateSet?.has(p.dateStr)) continue;
        if (dowNum !== null && p.day !== dowNum) continue;
        uniqueDays.add(p.dateStr);
        const slotIndex = p.hour * slotsPerHour + Math.floor(p.minute / granularity);
        const slot = hourly[slotIndex];
        slot.orderCount++;
        slot.revenue += o.subtotal;
        const plat = o.platform as keyof Pick<typeof slot, "square" | "doordash" | "grubhub" | "ubereats">;
        if (plat in slot) slot[plat] += o.subtotal;
      }

      for (const h of hourly) {
        h.avgOrderValue =
          h.orderCount > 0 ? h.revenue / h.orderCount : 0;
      }

      const result = { hourly, granularity, daysInSample: uniqueDays.size || 1 };
      setCache(cacheKey, result);
      return NextResponse.json(result);
    }

    case "revenue_by_dow": {
      // Revenue by day of week (0=Sunday, 6=Saturday) with per-platform breakdown
      const orders = await prisma.platformOrder.findMany({
        where: orderWhere,
        select: { orderDatetime: true, subtotal: true, netPayout: true, platform: true },
      });

      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const dowData = days.map((name, i) => ({
        dow: i,
        name,
        shortName: name.slice(0, 3),
        orderCount: 0,
        revenue: 0,
        avgRevenue: 0,
        uniqueDays: new Set<string>(),
        square: 0,
        doordash: 0,
        grubhub: 0,
        ubereats: 0,
      }));

      for (const o of orders) {
        const p = getEasternParts(new Date(o.orderDatetime));
        if (closedDateSet?.has(p.dateStr)) continue;
        const entry = dowData[p.day];
        entry.orderCount++;
        entry.revenue += o.subtotal;
        entry.uniqueDays.add(p.dateStr);
        const plat = o.platform as keyof Pick<typeof entry, "square" | "doordash" | "grubhub" | "ubereats">;
        if (plat in entry) entry[plat] += o.subtotal;
      }

      const dowResult = dowData.map((d) => ({
        dow: d.dow,
        name: d.name,
        shortName: d.shortName,
        orderCount: d.orderCount,
        revenue: d.revenue,
        avgRevenue: d.uniqueDays.size > 0 ? d.revenue / d.uniqueDays.size : 0,
        avgOrders: d.uniqueDays.size > 0 ? d.orderCount / d.uniqueDays.size : 0,
        daysInSample: d.uniqueDays.size,
        square: d.uniqueDays.size > 0 ? d.square / d.uniqueDays.size : 0,
        doordash: d.uniqueDays.size > 0 ? d.doordash / d.uniqueDays.size : 0,
        grubhub: d.uniqueDays.size > 0 ? d.grubhub / d.uniqueDays.size : 0,
        ubereats: d.uniqueDays.size > 0 ? d.ubereats / d.uniqueDays.size : 0,
      }));

      const dowResponse = { byDayOfWeek: dowResult };
      setCache(cacheKey, dowResponse);
      return NextResponse.json(dowResponse);
    }

    case "fee_analysis": {
      // Fee breakdown by platform
      const orders = await prisma.platformOrder.findMany({
        where: orderWhere,
        select: {
          platform: true,
          subtotal: true,
          deliveryFee: true,
          serviceFee: true,
          commissionFee: true,
          tip: true,
          netPayout: true,
        },
      });

      const byPlatform: Record<
        string,
        {
          platform: string;
          orderCount: number;
          totalRevenue: number;
          totalDeliveryFee: number;
          totalServiceFee: number;
          totalCommissionFee: number;
          totalTips: number;
          totalNetPayout: number;
          totalFees: number;
          feeRate: number;
        }
      > = {};

      for (const o of orders) {
        if (!byPlatform[o.platform]) {
          byPlatform[o.platform] = {
            platform: o.platform,
            orderCount: 0,
            totalRevenue: 0,
            totalDeliveryFee: 0,
            totalServiceFee: 0,
            totalCommissionFee: 0,
            totalTips: 0,
            totalNetPayout: 0,
            totalFees: 0,
            feeRate: 0,
          };
        }
        const p = byPlatform[o.platform];
        p.orderCount++;
        p.totalRevenue += o.subtotal;
        p.totalDeliveryFee += o.deliveryFee;
        p.totalServiceFee += o.serviceFee;
        p.totalCommissionFee += o.commissionFee;
        p.totalTips += o.tip;
        p.totalNetPayout += o.netPayout;
        p.totalFees += o.deliveryFee + o.serviceFee + o.commissionFee;
      }

      for (const p of Object.values(byPlatform)) {
        p.feeRate = p.totalRevenue > 0 ? (p.totalFees / p.totalRevenue) * 100 : 0;
      }

      const feeResponse = { feeAnalysis: Object.values(byPlatform) };
      setCache(cacheKey, feeResponse);
      return NextResponse.json(feeResponse);
    }

    case "busy_times": {
      // Heatmap data: hour x day-of-week order counts
      // Exclude platforms without time data (UberEats only has dates)
      const orders = await prisma.platformOrder.findMany({
        where: { ...orderWhere, platform: orderWhere.platform ?? { not: "ubereats" } },
        select: { orderDatetime: true },
      });

      const heatmap: number[][] = Array.from({ length: 7 }, () =>
        Array(24).fill(0)
      );

      for (const o of orders) {
        const p = getEasternParts(new Date(o.orderDatetime));
        if (closedDateSet?.has(p.dateStr)) continue;
        heatmap[p.day][p.hour]++;
      }

      const heatmapResponse = { heatmap };
      setCache(cacheKey, heatmapResponse);
      return NextResponse.json(heatmapResponse);
    }

    case "daily_summary": {
      // Daily revenue + order count + avg order value with per-platform breakdown
      const transactions = await prisma.transaction.findMany({
        where: { ...txWhere, type: "income" },
        select: { date: true, amount: true, sourcePlatform: true },
        orderBy: { date: "asc" },
      });

      const byDate: Record<string, { date: string; revenue: number; count: number; square: number; doordash: number; grubhub: number; ubereats: number }> = {};
      for (const t of transactions) {
        const key = getEasternParts(new Date(t.date)).dateStr;
        if (closedDateSet?.has(key)) continue;
        if (!byDate[key]) {
          byDate[key] = { date: key, revenue: 0, count: 0, square: 0, doordash: 0, grubhub: 0, ubereats: 0 };
        }
        byDate[key].revenue += t.amount;
        byDate[key].count++;
        const plat = t.sourcePlatform as "square" | "doordash" | "grubhub" | "ubereats" | null;
        if (plat && plat in byDate[key]) {
          byDate[key][plat] += t.amount;
        }
      }

      const daily = Object.values(byDate).map((d) => ({
        ...d,
        avgOrderValue: d.count > 0 ? d.revenue / d.count : 0,
      }));

      const dailyResponse = { daily };
      setCache(cacheKey, dailyResponse);
      return NextResponse.json(dailyResponse);
    }

    default:
      return NextResponse.json(
        { error: "Unknown analytics type" },
        { status: 400 }
      );
  }
}
