import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";

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
  if (hour === 24) hour = 0;
  return { hour, minute, day, dateStr: `${year}-${month}-${dayOfMonth}` };
}

/* ── Simple in-memory response cache ── */
const responseCache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 30_000;

function getCached(key: string): unknown | null {
  const entry = responseCache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}

function setCache(key: string, data: unknown) {
  responseCache.set(key, { data, ts: Date.now() });
  if (responseCache.size > 50) {
    const now = Date.now();
    for (const [k, v] of responseCache) {
      if (now - v.ts > CACHE_TTL) responseCache.delete(k);
    }
  }
}

function getSalesDb() {
  return new Database(path.join(process.cwd(), "databases", "sales.db"), { readonly: true });
}

/**
 * GET /api/analytics
 * Reads from sales.db orders table.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "daily_summary";
  const platform = searchParams.get("platform");
  const platforms = searchParams.get("platforms");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const dowFilter = searchParams.get("dow");
  const granularity = parseInt(searchParams.get("granularity") || "60", 10);

  const cacheKey = `${type}|${platform}|${platforms}|${startDate}|${endDate}|${dowFilter}|${granularity}`;
  const cached = getCached(cacheKey);
  if (cached) return NextResponse.json(cached);

  const db = getSalesDb();

  try {
    // Build WHERE clause for sales.db orders
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    const platList = platforms ? platforms.split(",").filter(Boolean) : platform ? [platform] : [];
    if (platList.length === 1) {
      conditions.push("platform = ?");
      params.push(platList[0]);
    } else if (platList.length > 1) {
      conditions.push(`platform IN (${platList.map(() => "?").join(",")})`);
      params.push(...platList);
    }

    if (startDate) {
      conditions.push("date >= ?");
      params.push(startDate);
    }
    if (endDate) {
      conditions.push("date <= ?");
      params.push(endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    switch (type) {
      case "revenue_by_hour": {
        // Get orders with time data (exclude ubereats which has no time)
        const timeConditions = [...conditions];
        if (platList.length === 0) {
          timeConditions.push("platform != 'ubereats'");
        }
        const timeWhere = timeConditions.length > 0 ? `WHERE ${timeConditions.join(" AND ")}` : "";

        const orders = db.prepare(`
          SELECT date, time, platform, gross_sales FROM orders ${timeWhere}
        `).all(...params) as { date: string; time: string; platform: string; gross_sales: number }[];

        const slotsPerHour = 60 / granularity;
        const totalSlots = 24 * slotsPerHour;

        const hourly = Array.from({ length: totalSlots }, (_, i) => {
          const hour = Math.floor(i / slotsPerHour);
          const minuteOffset = (i % slotsPerHour) * granularity;
          const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
          const suffix = hour < 12 ? "am" : "pm";
          const label = granularity === 60 ? `${h12}${suffix}` : `${h12}:${String(minuteOffset).padStart(2, "0")}${suffix}`;
          return { slot: i, hour, minute: minuteOffset, label, orderCount: 0, revenue: 0, avgOrderValue: 0, square: 0, doordash: 0, grubhub: 0, ubereats: 0 };
        });

        const dowNum = dowFilter !== null ? parseInt(dowFilter, 10) : null;
        const uniqueDays = new Set<string>();

        for (const o of orders) {
          if (!o.time) continue;
          // Parse time from "HH:MM:SS" format
          const timeParts = o.time.split(":");
          const hour = parseInt(timeParts[0], 10);
          const minute = parseInt(timeParts[1] || "0", 10);

          // Get day of week from date
          const dateObj = new Date(o.date + "T12:00:00Z");
          const dayOfWeek = dateObj.getUTCDay();

          if (dowNum !== null && dayOfWeek !== dowNum) continue;
          uniqueDays.add(o.date);

          const slotIndex = hour * slotsPerHour + Math.floor(minute / granularity);
          if (slotIndex >= 0 && slotIndex < totalSlots) {
            const slot = hourly[slotIndex];
            slot.orderCount++;
            slot.revenue += o.gross_sales;
            const plat = o.platform as "square" | "doordash" | "grubhub" | "ubereats";
            if (plat in slot) (slot as Record<string, number>)[plat] += o.gross_sales;
          }
        }

        for (const h of hourly) {
          h.avgOrderValue = h.orderCount > 0 ? h.revenue / h.orderCount : 0;
        }

        const result = { hourly, granularity, daysInSample: uniqueDays.size || 1 };
        setCache(cacheKey, result);
        return NextResponse.json(result);
      }

      case "revenue_by_dow": {
        const orders = db.prepare(`
          SELECT date, platform, gross_sales, net_sales FROM orders ${whereClause}
        `).all(...params) as { date: string; platform: string; gross_sales: number; net_sales: number }[];

        const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const dowData = days.map((name, i) => ({
          dow: i, name, shortName: name.slice(0, 3),
          orderCount: 0, revenue: 0, avgRevenue: 0,
          uniqueDays: new Set<string>(),
          square: 0, doordash: 0, grubhub: 0, ubereats: 0,
        }));

        for (const o of orders) {
          const dateObj = new Date(o.date + "T12:00:00Z");
          const dayOfWeek = dateObj.getUTCDay();
          const entry = dowData[dayOfWeek];
          entry.orderCount++;
          entry.revenue += o.gross_sales;
          entry.uniqueDays.add(o.date);
          const plat = o.platform as "square" | "doordash" | "grubhub" | "ubereats";
          if (plat in entry) (entry as Record<string, number>)[plat] += o.gross_sales;
        }

        const dowResult = dowData.map((d) => ({
          dow: d.dow, name: d.name, shortName: d.shortName,
          orderCount: d.orderCount, revenue: d.revenue,
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
        const orders = db.prepare(`
          SELECT platform, gross_sales, tax, tip, fees_total, marketing_total,
                 commission_fee, processing_fee, delivery_fee, marketing_fee, net_sales
          FROM orders ${whereClause}
        `).all(...params) as {
          platform: string; gross_sales: number; tax: number; tip: number;
          fees_total: number; marketing_total: number;
          commission_fee: number; processing_fee: number; delivery_fee: number; marketing_fee: number;
          net_sales: number;
        }[];

        const byPlatform: Record<string, {
          platform: string; orderCount: number; totalRevenue: number;
          totalDeliveryFee: number; totalServiceFee: number; totalCommissionFee: number;
          totalProcessingFee: number; totalMarketingFee: number;
          totalTips: number; totalNetPayout: number; totalFees: number; feeRate: number;
        }> = {};

        for (const o of orders) {
          if (!byPlatform[o.platform]) {
            byPlatform[o.platform] = {
              platform: o.platform, orderCount: 0, totalRevenue: 0,
              totalDeliveryFee: 0, totalServiceFee: 0, totalCommissionFee: 0,
              totalProcessingFee: 0, totalMarketingFee: 0,
              totalTips: 0, totalNetPayout: 0, totalFees: 0, feeRate: 0,
            };
          }
          const p = byPlatform[o.platform];
          p.orderCount++;
          p.totalRevenue += o.gross_sales;
          p.totalDeliveryFee += o.delivery_fee || 0;
          p.totalCommissionFee += o.commission_fee || 0;
          p.totalProcessingFee += o.processing_fee || 0;
          p.totalMarketingFee += o.marketing_fee || 0;
          p.totalTips += o.tip || 0;
          p.totalNetPayout += o.net_sales;
          p.totalFees += o.fees_total || 0;
        }

        for (const p of Object.values(byPlatform)) {
          p.feeRate = p.totalRevenue > 0 ? (Math.abs(p.totalFees) / p.totalRevenue) * 100 : 0;
        }

        const feeResponse = { feeAnalysis: Object.values(byPlatform) };
        setCache(cacheKey, feeResponse);
        return NextResponse.json(feeResponse);
      }

      case "busy_times": {
        const timeConditions = [...conditions];
        if (platList.length === 0) {
          timeConditions.push("platform != 'ubereats'");
        }
        const timeWhere = timeConditions.length > 0 ? `WHERE ${timeConditions.join(" AND ")}` : "";

        const orders = db.prepare(`
          SELECT date, time FROM orders ${timeWhere}
        `).all(...params) as { date: string; time: string }[];

        const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));

        for (const o of orders) {
          if (!o.time) continue;
          const hour = parseInt(o.time.split(":")[0], 10);
          const dateObj = new Date(o.date + "T12:00:00Z");
          const dayOfWeek = dateObj.getUTCDay();
          heatmap[dayOfWeek][hour]++;
        }

        const heatmapResponse = { heatmap };
        setCache(cacheKey, heatmapResponse);
        return NextResponse.json(heatmapResponse);
      }

      case "daily_summary": {
        const orders = db.prepare(`
          SELECT date, platform, gross_sales FROM orders ${whereClause}
        `).all(...params) as { date: string; platform: string; gross_sales: number }[];

        const byDate: Record<string, { date: string; revenue: number; count: number; square: number; doordash: number; grubhub: number; ubereats: number }> = {};

        for (const o of orders) {
          const key = o.date;
          if (!byDate[key]) {
            byDate[key] = { date: key, revenue: 0, count: 0, square: 0, doordash: 0, grubhub: 0, ubereats: 0 };
          }
          byDate[key].revenue += o.gross_sales;
          byDate[key].count++;
          const plat = o.platform as "square" | "doordash" | "grubhub" | "ubereats";
          if (plat in byDate[key]) (byDate[key] as Record<string, number>)[plat] += o.gross_sales;
        }

        const daily = Object.values(byDate)
          .map((d) => ({ ...d, avgOrderValue: d.count > 0 ? d.revenue / d.count : 0 }))
          .sort((a, b) => a.date.localeCompare(b.date));

        const dailyResponse = { daily };
        setCache(cacheKey, dailyResponse);
        return NextResponse.json(dailyResponse);
      }

      default:
        return NextResponse.json({ error: "Unknown analytics type" }, { status: 400 });
    }
  } finally {
    db.close();
  }
}
