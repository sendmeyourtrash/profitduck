import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ category: string }> }
) {
  const { category } = await params;
  const decodedCategory = decodeURIComponent(category);
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
    const earliest = await prisma.expense.findFirst({
      orderBy: { date: "asc" },
      select: { date: true },
    });
    startDate = earliest ? earliest.date : new Date(new Date().setDate(new Date().getDate() - 365));
  }

  const dateFilter = { gte: startDate, ...(endDate ? { lte: endDate } : {}) };

  // Try to find an ExpenseCategory by name first (used when navigating from Categories page).
  // Fall back to the raw `category` text field (used from Expenses bar chart).
  const expenseCategory = await prisma.expenseCategory.findFirst({
    where: { name: decodedCategory },
  });

  // Build the where clause — match by FK if we found a category, otherwise by raw text
  const where = expenseCategory
    ? { expenseCategoryId: expenseCategory.id, date: dateFilter }
    : { category: decodedCategory, date: dateFilter };

  // For the raw SQL monthly trend, pick the right column/value
  const sqlWhereClause = expenseCategory
    ? `expense_category_id = ?`
    : `category = ?`;
  const sqlParamValue = expenseCategory
    ? expenseCategory.id
    : decodedCategory;

  // Run queries in parallel
  const [expenses, count, aggregation, monthlyTrend, vendorBreakdown] =
    await Promise.all([
      // Paginated expense items
      prisma.expense.findMany({
        where,
        include: { vendor: true },
        orderBy: { date: "desc" },
        skip: page * limit,
        take: limit,
      }),

      // Total count for pagination
      prisma.expense.count({ where }),

      // Aggregation: total + average
      prisma.expense.aggregate({
        where,
        _sum: { amount: true },
        _avg: { amount: true },
      }),

      // Monthly trend
      prisma.$queryRawUnsafe<{ month: string; total: number }[]>(
        `SELECT strftime('%Y-%m', date) as month, SUM(amount) as total
         FROM expenses
         WHERE ${sqlWhereClause} AND date >= ?${endDate ? " AND date <= ?" : ""}
         GROUP BY strftime('%Y-%m', date)
         ORDER BY month ASC`,
        ...[sqlParamValue, startDate.toISOString(), ...(endDate ? [endDate.toISOString()] : [])]
      ),

      // Vendor breakdown within this category
      prisma.expense.groupBy({
        by: ["vendorId"],
        where,
        _sum: { amount: true },
        _count: true,
        orderBy: { _sum: { amount: "desc" } },
        take: 10,
      }),
    ]);

  // Look up vendor names for the breakdown
  const vendorIds = vendorBreakdown
    .map((v) => v.vendorId)
    .filter((id): id is string => id !== null);
  const vendors = await prisma.vendor.findMany({
    where: { id: { in: vendorIds } },
  });
  const vendorMap = new Map(
    vendors.map((v) => [v.id, v.displayName || v.name])
  );

  return NextResponse.json({
    category: decodedCategory,
    total: aggregation._sum.amount || 0,
    count,
    average: aggregation._avg.amount || 0,
    totalPages: Math.ceil(count / limit),
    monthlyTrend: monthlyTrend.map((m) => ({
      month: m.month,
      total: Number(m.total),
    })),
    vendorBreakdown: vendorBreakdown.map((v) => ({
      vendorName: v.vendorId
        ? vendorMap.get(v.vendorId) || "Unknown"
        : "Unknown",
      total: v._sum.amount || 0,
      count: v._count,
    })),
    expenses: expenses.map((e) => ({
      id: e.id,
      date: e.date,
      amount: e.amount,
      vendorName: e.vendor?.displayName || e.vendor?.name || "Unknown",
      notes: e.notes,
      paymentMethod: e.paymentMethod,
    })),
  });
}
