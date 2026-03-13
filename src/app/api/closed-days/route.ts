import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

/**
 * Get the date string (YYYY-MM-DD) in NYC Eastern time.
 */
function getEasternDateStr(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * GET /api/closed-days
 * Returns all confirmed closed days.
 * With ?detect=true, also auto-detects zero-income dates.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const detect = searchParams.get("detect") === "true";

  const closedDays = await prisma.closedDay.findMany({
    orderBy: { date: "desc" },
  });

  if (!detect) {
    return NextResponse.json({ closedDays });
  }

  // Auto-detect: find dates with zero income across all sources
  // 1. Get the date range from all income transactions
  const dateRange = await prisma.transaction.aggregate({
    where: { type: "income" },
    _min: { date: true },
    _max: { date: true },
  });

  if (!dateRange._min.date || !dateRange._max.date) {
    return NextResponse.json({ closedDays, detected: [] });
  }

  // 2. Get all dates that have income
  const incomeTransactions = await prisma.transaction.findMany({
    where: { type: "income" },
    select: { date: true },
  });

  const activeDates = new Set<string>();
  for (const t of incomeTransactions) {
    activeDates.add(getEasternDateStr(new Date(t.date)));
  }

  // 3. Get already-saved closed day dates
  const savedDates = new Set(
    closedDays.map((cd) => getEasternDateStr(new Date(cd.date)))
  );

  // 4. Walk every calendar date in the range, find missing ones
  const detected: { date: string; dayOfWeek: string }[] = [];
  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  const cursor = new Date(dateRange._min.date);
  const end = new Date(dateRange._max.date);
  // Align to Eastern date boundaries
  const startStr = getEasternDateStr(cursor);
  const endStr = getEasternDateStr(end);

  // Walk day by day using string dates to avoid timezone issues
  let current = startStr;
  while (current <= endStr) {
    if (!activeDates.has(current) && !savedDates.has(current)) {
      const d = new Date(current + "T12:00:00-05:00"); // noon Eastern to avoid date shift
      detected.push({
        date: current,
        dayOfWeek: dayNames[d.getDay()],
      });
    }
    // Advance one day
    const next = new Date(current + "T12:00:00-05:00");
    next.setDate(next.getDate() + 1);
    current = getEasternDateStr(next);
  }

  return NextResponse.json({ closedDays, detected });
}

/**
 * POST /api/closed-days
 * Add a closed day. Body: { date: "YYYY-MM-DD", reason?: string }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { date, reason } = body;

  if (!date) {
    return NextResponse.json({ error: "date is required" }, { status: 400 });
  }

  // Store as noon Eastern to avoid date boundary issues
  const dateObj = new Date(date + "T12:00:00-05:00");

  const closedDay = await prisma.closedDay.upsert({
    where: { date: dateObj },
    update: { reason: reason || null, autoDetected: false },
    create: {
      date: dateObj,
      reason: reason || null,
      autoDetected: body.autoDetected ?? false,
    },
  });

  return NextResponse.json({ closedDay });
}

/**
 * DELETE /api/closed-days
 * Remove a closed day. Body: { date: "YYYY-MM-DD" }
 */
export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const { date } = body;

  if (!date) {
    return NextResponse.json({ error: "date is required" }, { status: 400 });
  }

  const dateObj = new Date(date + "T12:00:00-05:00");

  try {
    await prisma.closedDay.delete({ where: { date: dateObj } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Closed day not found" },
      { status: 404 }
    );
  }
}
