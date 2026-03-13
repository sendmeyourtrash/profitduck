import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "30");

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Expenses by vendor
  const expensesByVendor = await prisma.expense.groupBy({
    by: ["vendorId"],
    where: { date: { gte: startDate } },
    _sum: { amount: true },
    _count: true,
    orderBy: { _sum: { amount: "desc" } },
    take: 20,
  });

  // Look up vendor names (prefer displayName from alias system)
  const vendorIds = expensesByVendor
    .map((e) => e.vendorId)
    .filter((id): id is string => id !== null);
  const vendors = await prisma.vendor.findMany({
    where: { id: { in: vendorIds } },
  });
  const vendorMap = new Map(
    vendors.map((v) => [v.id, v.displayName || v.name])
  );

  // Expenses by category
  const expensesByCategory = await prisma.expense.groupBy({
    by: ["category"],
    where: { date: { gte: startDate } },
    _sum: { amount: true },
    _count: true,
    orderBy: { _sum: { amount: "desc" } },
  });

  // Monthly expense trend
  const monthlyExpenses = await prisma.$queryRawUnsafe<
    { month: string; total: number }[]
  >(
    `SELECT strftime('%Y-%m', date) as month, SUM(amount) as total
     FROM expenses
     GROUP BY strftime('%Y-%m', date)
     ORDER BY month ASC`
  );

  // Fees by platform
  const feesByPlatform = await prisma.transaction.groupBy({
    by: ["sourcePlatform"],
    where: {
      type: "fee",
      date: { gte: startDate },
    },
    _sum: { amount: true },
  });

  // Merge vendors that share the same displayName
  const mergedVendors = new Map<string, { vendorId: string; vendorName: string; total: number; count: number }>();
  for (const e of expensesByVendor) {
    const name = e.vendorId ? vendorMap.get(e.vendorId) || "Unknown" : "Unknown";
    const existing = mergedVendors.get(name);
    if (existing) {
      existing.total += e._sum.amount || 0;
      existing.count += e._count;
    } else {
      mergedVendors.set(name, {
        vendorId: e.vendorId || "unknown",
        vendorName: name,
        total: e._sum.amount || 0,
        count: e._count,
      });
    }
  }
  const sortedVendors = [...mergedVendors.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);

  return NextResponse.json({
    expensesByVendor: sortedVendors,
    expensesByCategory: expensesByCategory.map((e) => ({
      category: e.category || "Uncategorized",
      total: e._sum.amount || 0,
      count: e._count,
    })),
    monthlyExpenses: monthlyExpenses.map((m) => ({
      month: m.month,
      total: Number(m.total),
    })),
    feesByPlatform: feesByPlatform.map((f) => ({
      platform: f.sourcePlatform,
      fees: f._sum.amount || 0,
    })),
  });
}
