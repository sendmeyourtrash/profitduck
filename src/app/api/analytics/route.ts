import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

/**
 * Get the hour (0-23) in NYC Eastern time for a Date object.
 * Uses Intl to handle DST automatically.
 */
function getEasternHour(d: Date): number {
  return parseInt(
    d.toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }),
    10
  );
}

/**
 * Get the minute (0-59) in NYC Eastern time for a Date object.
 */
function getEasternMinute(d: Date): number {
  return parseInt(
    d.toLocaleString("en-US", {
      timeZone: "America/New_York",
      minute: "numeric",
    }),
    10
  );
}

/**
 * Get the day of week (0=Sunday..6=Saturday) in NYC Eastern time.
 */
function getEasternDay(d: Date): number {
  const dayStr = d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  });
  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return dayMap[dayStr] ?? d.getDay();
}

/**
 * Get the date string (YYYY-MM-DD) in NYC Eastern time.
 */
function getEasternDateStr(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
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

      for (const o of orders) {
        const d = new Date(o.orderDatetime);
        if (closedDateSet?.has(getEasternDateStr(d))) continue;
        if (dowNum !== null && getEasternDay(d) !== dowNum) continue;
        const hour = getEasternHour(d);
        const minute = getEasternMinute(d);
        const slotIndex = hour * slotsPerHour + Math.floor(minute / granularity);
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

      return NextResponse.json({ hourly, granularity });
    }

    case "revenue_by_dow": {
      // Revenue by day of week (0=Sunday, 6=Saturday)
      const orders = await prisma.platformOrder.findMany({
        where: orderWhere,
        select: { orderDatetime: true, subtotal: true, netPayout: true },
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
      }));

      for (const o of orders) {
        const d = new Date(o.orderDatetime);
        const dateStr = getEasternDateStr(d);
        if (closedDateSet?.has(dateStr)) continue;
        const dow = getEasternDay(d);
        dowData[dow].orderCount++;
        dowData[dow].revenue += o.subtotal;
        dowData[dow].uniqueDays.add(dateStr);
      }

      const result = dowData.map((d) => ({
        dow: d.dow,
        name: d.name,
        shortName: d.shortName,
        orderCount: d.orderCount,
        revenue: d.revenue,
        avgRevenue: d.uniqueDays.size > 0 ? d.revenue / d.uniqueDays.size : 0,
        avgOrders: d.uniqueDays.size > 0 ? d.orderCount / d.uniqueDays.size : 0,
        daysInSample: d.uniqueDays.size,
      }));

      return NextResponse.json({ byDayOfWeek: result });
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

      return NextResponse.json({
        feeAnalysis: Object.values(byPlatform),
      });
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
        const d = new Date(o.orderDatetime);
        if (closedDateSet?.has(getEasternDateStr(d))) continue;
        heatmap[getEasternDay(d)][getEasternHour(d)]++;
      }

      return NextResponse.json({ heatmap });
    }

    case "daily_summary": {
      // Daily revenue + order count + avg order value
      const transactions = await prisma.transaction.findMany({
        where: { ...txWhere, type: "income" },
        select: { date: true, amount: true },
        orderBy: { date: "asc" },
      });

      const byDate: Record<string, { date: string; revenue: number; count: number; closed?: boolean }> = {};
      for (const t of transactions) {
        const key = getEasternDateStr(new Date(t.date));
        if (closedDateSet?.has(key)) continue;
        if (!byDate[key]) {
          byDate[key] = { date: key, revenue: 0, count: 0 };
        }
        byDate[key].revenue += t.amount;
        byDate[key].count++;
      }

      const daily = Object.values(byDate).map((d) => ({
        ...d,
        avgOrderValue: d.count > 0 ? d.revenue / d.count : 0,
      }));

      return NextResponse.json({ daily });
    }

    default:
      return NextResponse.json(
        { error: "Unknown analytics type" },
        { status: 400 }
      );
  }
}
