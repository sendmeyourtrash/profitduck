import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawStart = searchParams.get("startDate");
  const rawEnd = searchParams.get("endDate");
  const rawDays = searchParams.get("days");

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
    startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
  }

  const dateFilter = { gte: startDate, ...(endDate ? { lte: endDate } : {}) };

  // Expenses by vendor — fetch ALL, merge by displayName, then take top 20.
  // We cannot use `take` here because vendor aliases may merge many vendorIds
  // into a single display name (e.g. 12 rent payments → "Rent (1654 Third Ave)").
  const expensesByVendor = await prisma.expense.groupBy({
    by: ["vendorId"],
    where: { date: dateFilter },
    _sum: { amount: true },
    _count: true,
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

  // Expenses by category — group by expenseCategoryId to use proper category names
  const expensesByCategoryRaw = await prisma.expense.groupBy({
    by: ["expenseCategoryId"],
    where: { date: dateFilter },
    _sum: { amount: true },
    _count: true,
    orderBy: { _sum: { amount: "desc" } },
  });

  // Look up ExpenseCategory names
  const catIds = expensesByCategoryRaw
    .map((e) => e.expenseCategoryId)
    .filter((id): id is string => id !== null);
  const expenseCategories = await prisma.expenseCategory.findMany({
    where: { id: { in: catIds } },
  });
  const catNameMap = new Map(expenseCategories.map((c) => [c.id, c.name]));

  // Expenses by payment method
  const expensesByPaymentMethod = await prisma.expense.groupBy({
    by: ["paymentMethod"],
    where: { date: dateFilter },
    _sum: { amount: true },
    _count: true,
    orderBy: { _sum: { amount: "desc" } },
  });

  // Monthly expense trend (filtered by selected period)
  const monthlyExpenses = await prisma.$queryRawUnsafe<
    { month: string; total: number }[]
  >(
    `SELECT strftime('%Y-%m', date) as month, SUM(amount) as total
     FROM expenses
     WHERE date >= ?${endDate ? " AND date <= ?" : ""}
     GROUP BY strftime('%Y-%m', date)
     ORDER BY month ASC`,
    ...[startDate.toISOString(), ...(endDate ? [endDate.toISOString()] : [])]
  );

  // Fees by platform — aggregate from platform_orders which has detailed fee columns
  // (commission, service, delivery, marketing, customer fees)
  const platformFees = await prisma.platformOrder.groupBy({
    by: ["platform"],
    where: {
      orderDatetime: dateFilter,
    },
    _sum: {
      commissionFee: true,
      serviceFee: true,
      deliveryFee: true,
      marketingFees: true,
      customerFees: true,
    },
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
    expensesByCategory: expensesByCategoryRaw.map((e) => ({
      category: e.expenseCategoryId
        ? catNameMap.get(e.expenseCategoryId) || "Uncategorized"
        : "Uncategorized",
      total: e._sum.amount || 0,
      count: e._count,
    })),
    monthlyExpenses: monthlyExpenses.map((m) => ({
      month: m.month,
      total: Number(m.total),
    })),
    expensesByPaymentMethod: expensesByPaymentMethod.map((e) => ({
      paymentMethod: e.paymentMethod || "Unknown",
      total: e._sum.amount || 0,
      count: e._count,
    })),
    feesByPlatform: platformFees
      .map((f) => ({
        platform: f.platform,
        fees:
          (f._sum.commissionFee || 0) +
          (f._sum.serviceFee || 0) +
          (f._sum.deliveryFee || 0) +
          (f._sum.marketingFees || 0) +
          (f._sum.customerFees || 0),
        breakdown: {
          commission: f._sum.commissionFee || 0,
          service: f._sum.serviceFee || 0,
          delivery: f._sum.deliveryFee || 0,
          marketing: f._sum.marketingFees || 0,
          customer: f._sum.customerFees || 0,
        },
      }))
      .filter((f) => f.fees > 0)
      .sort((a, b) => b.fees - a.fees),
  });
}
