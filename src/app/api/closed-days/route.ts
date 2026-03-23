import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import { getClosedDays, addClosedDay, removeClosedDay } from "@/lib/db/config-db";

const DB_DIR = path.join(process.cwd(), "databases");

/**
 * GET /api/closed-days
 * Returns all confirmed closed days.
 * With ?detect=true, also auto-detects zero-income dates.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const detect = searchParams.get("detect") === "true";

  const closedDays = getClosedDays();

  if (!detect) {
    return NextResponse.json({ closedDays });
  }

  // Auto-detect: find dates with zero sales from sales.db
  const salesDb = new Database(path.join(DB_DIR, "sales.db"), { readonly: true });
  try {
    const dateRange = salesDb.prepare(
      `SELECT MIN(date) as min_date, MAX(date) as max_date FROM orders WHERE order_status = 'completed'`
    ).get() as { min_date: string | null; max_date: string | null };

    if (!dateRange.min_date || !dateRange.max_date) {
      return NextResponse.json({ closedDays, detected: [] });
    }

    // Get all dates that have sales
    const activeDateRows = salesDb.prepare(
      `SELECT DISTINCT date FROM orders WHERE order_status = 'completed'`
    ).all() as { date: string }[];

    const activeDates = new Set(activeDateRows.map((r) => r.date));
    const savedDates = new Set(closedDays.map((cd) => cd.date));

    // Walk every calendar date in the range
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const detected: { date: string; dayOfWeek: string }[] = [];

    let current = dateRange.min_date;
    while (current <= dateRange.max_date) {
      if (!activeDates.has(current) && !savedDates.has(current)) {
        const d = new Date(current + "T12:00:00");
        detected.push({
          date: current,
          dayOfWeek: dayNames[d.getDay()],
        });
      }
      // Advance one day
      const next = new Date(current + "T12:00:00");
      next.setDate(next.getDate() + 1);
      current = next.toISOString().slice(0, 10);
    }

    return NextResponse.json({ closedDays, detected });
  } finally {
    salesDb.close();
  }
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

  addClosedDay(date, reason || undefined, body.autoDetected ?? false);

  return NextResponse.json({ closedDay: { date, reason: reason || null } });
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

  removeClosedDay(date);
  return NextResponse.json({ success: true });
}
