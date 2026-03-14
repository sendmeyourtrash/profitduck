import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ vendorName: string }> }
) {
  const { vendorName } = await params;
  const decodedName = decodeURIComponent(vendorName);
  const { searchParams } = new URL(request.url);
  const rawStart = searchParams.get("startDate");
  const rawEnd = searchParams.get("endDate");
  const rawDays = searchParams.get("days");
  const page = parseInt(searchParams.get("page") || "0");
  const limit = parseInt(searchParams.get("limit") || "50");

  let startDate: Date;
  let endDate: Date | undefined;

  if (rawStart) {
    startDate = new Date(rawStart);
    if (rawEnd) {
      endDate = new Date(rawEnd);
      endDate.setHours(23, 59, 59, 999);
    }
  } else if (rawDays) {
    const days = parseInt(rawDays);
    startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
  } else {
    startDate = new Date(0);
  }

  const dateFilter = { gte: startDate, ...(endDate ? { lte: endDate } : {}) };

  // Find all vendors matching by displayName or name (aliases may merge many vendorIds)
  const matchingVendors = await prisma.vendor.findMany({
    where: {
      OR: [{ displayName: decodedName }, { name: decodedName }],
    },
  });

  const vendorIds = matchingVendors.map((v) => v.id);

  if (vendorIds.length === 0) {
    return NextResponse.json({
      vendorName: decodedName,
      total: 0,
      count: 0,
      average: 0,
      totalPages: 0,
      monthlyTrend: [],
      categoryBreakdown: [],
      expenses: [],
    });
  }

  const where = { vendorId: { in: vendorIds }, date: dateFilter };

  // Build SQL fragments for monthly trend
  const vendorPlaceholders = vendorIds.map(() => "?").join(",");
  const sqlVendorClause = `vendor_id IN (${vendorPlaceholders})`;

  // Run queries in parallel
  const [expenses, count, aggregation, monthlyTrend, categoryBreakdown] =
    await Promise.all([
      // Paginated expense items
      prisma.expense.findMany({
        where,
        include: { vendor: true, expenseCategory: true },
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
         WHERE ${sqlVendorClause} AND date >= ?${endDate ? " AND date <= ?" : ""}
         GROUP BY strftime('%Y-%m', date)
         ORDER BY month ASC`,
        ...vendorIds,
        startDate.toISOString(),
        ...(endDate ? [endDate.toISOString()] : [])
      ),

      // Category breakdown for this vendor
      prisma.expense.groupBy({
        by: ["expenseCategoryId"],
        where,
        _sum: { amount: true },
        _count: true,
        orderBy: { _sum: { amount: "desc" } },
        take: 10,
      }),
    ]);

  // Look up category names for the breakdown
  const catIds = categoryBreakdown
    .map((c) => c.expenseCategoryId)
    .filter((id): id is string => id !== null);
  const expenseCategories = await prisma.expenseCategory.findMany({
    where: { id: { in: catIds } },
  });
  const catNameMap = new Map(expenseCategories.map((c) => [c.id, c.name]));

  return NextResponse.json({
    vendorName: decodedName,
    total: aggregation._sum.amount || 0,
    count,
    average: aggregation._avg.amount || 0,
    totalPages: Math.ceil(count / limit),
    monthlyTrend: monthlyTrend.map((m) => ({
      month: m.month,
      total: Number(m.total),
    })),
    categoryBreakdown: categoryBreakdown.map((c) => ({
      category: c.expenseCategoryId
        ? catNameMap.get(c.expenseCategoryId) || "Uncategorized"
        : "Uncategorized",
      total: c._sum.amount || 0,
      count: c._count,
    })),
    expenses: expenses.map((e) => ({
      id: e.id,
      date: e.date,
      amount: e.amount,
      category:
        e.expenseCategory?.name || e.category || "Uncategorized",
      notes: e.notes,
      paymentMethod: e.paymentMethod,
    })),
  });
}
