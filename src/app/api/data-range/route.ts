import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

/**
 * Returns the min/max date range across all data, plus available
 * platforms, categories, and vendors for filter dropdowns.
 */
export async function GET() {
  const [
    txDateRange,
    orderDateRange,
    platforms,
    categories,
    vendors,
  ] = await Promise.all([
    prisma.transaction.aggregate({
      _min: { date: true },
      _max: { date: true },
    }),
    prisma.platformOrder.aggregate({
      _min: { orderDatetime: true },
      _max: { orderDatetime: true },
    }),
    prisma.transaction.findMany({
      select: { sourcePlatform: true },
      distinct: ["sourcePlatform"],
    }),
    prisma.transaction.findMany({
      where: { category: { not: null } },
      select: { category: true },
      distinct: ["category"],
    }),
    prisma.vendor.findMany({
      select: { id: true, name: true, category: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const minDate =
    txDateRange._min.date && orderDateRange._min.orderDatetime
      ? new Date(
          Math.min(
            txDateRange._min.date.getTime(),
            orderDateRange._min.orderDatetime.getTime()
          )
        )
      : txDateRange._min.date || orderDateRange._min.orderDatetime;

  const maxDate =
    txDateRange._max.date && orderDateRange._max.orderDatetime
      ? new Date(
          Math.max(
            txDateRange._max.date.getTime(),
            orderDateRange._max.orderDatetime.getTime()
          )
        )
      : txDateRange._max.date || orderDateRange._max.orderDatetime;

  return NextResponse.json({
    dateRange: {
      min: minDate?.toISOString() || null,
      max: maxDate?.toISOString() || null,
    },
    platforms: platforms.map((p) => p.sourcePlatform),
    categories: categories.map((c) => c.category).filter(Boolean),
    vendors,
  });
}
