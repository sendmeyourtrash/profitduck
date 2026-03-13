import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  startOfDay,
  startOfWeek,
  startOfMonth,
  endOfDay,
} from "date-fns";

export async function GET() {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const monthStart = startOfMonth(now);

  // Revenue aggregations
  const [todayRevenue, weekRevenue, monthRevenue, totalRevenue] =
    await Promise.all([
      sumTransactions("income", todayStart, todayEnd),
      sumTransactions("income", weekStart, todayEnd),
      sumTransactions("income", monthStart, todayEnd),
      sumTransactions("income"),
    ]);

  // Fees
  const [todayFees, weekFees, monthFees, totalFees] = await Promise.all([
    sumTransactions("fee", todayStart, todayEnd),
    sumTransactions("fee", weekStart, todayEnd),
    sumTransactions("fee", monthStart, todayEnd),
    sumTransactions("fee"),
  ]);

  // Expenses
  const [todayExpenses, weekExpenses, monthExpenses, totalExpenses] =
    await Promise.all([
      sumExpenses(todayStart, todayEnd),
      sumExpenses(weekStart, todayEnd),
      sumExpenses(monthStart, todayEnd),
      sumExpenses(),
    ]);

  // Platform breakdown
  const platformBreakdown = await prisma.transaction.groupBy({
    by: ["sourcePlatform"],
    where: { type: "income" },
    _sum: { amount: true },
    _count: true,
  });

  // Recent transactions
  const recentTransactions = await prisma.transaction.findMany({
    orderBy: { date: "desc" },
    take: 10,
  });

  return NextResponse.json({
    today: {
      revenue: todayRevenue,
      fees: todayFees,
      expenses: todayExpenses,
      netProfit: todayRevenue - todayFees - todayExpenses,
    },
    week: {
      revenue: weekRevenue,
      fees: weekFees,
      expenses: weekExpenses,
      netProfit: weekRevenue - weekFees - weekExpenses,
    },
    month: {
      revenue: monthRevenue,
      fees: monthFees,
      expenses: monthExpenses,
      netProfit: monthRevenue - monthFees - monthExpenses,
    },
    total: {
      revenue: totalRevenue,
      fees: totalFees,
      expenses: totalExpenses,
      netProfit: totalRevenue - totalFees - totalExpenses,
    },
    platformBreakdown: platformBreakdown.map((p) => ({
      platform: p.sourcePlatform,
      revenue: p._sum.amount || 0,
      orders: p._count,
    })),
    recentTransactions,
  });
}

async function sumTransactions(
  type: string,
  start?: Date,
  end?: Date
): Promise<number> {
  const where: Record<string, unknown> = { type };
  if (start || end) {
    where.date = {};
    if (start) (where.date as Record<string, Date>).gte = start;
    if (end) (where.date as Record<string, Date>).lte = end;
  }

  const result = await prisma.transaction.aggregate({
    where,
    _sum: { amount: true },
  });

  return result._sum.amount || 0;
}

async function sumExpenses(start?: Date, end?: Date): Promise<number> {
  const where: Record<string, unknown> = {};
  if (start || end) {
    where.date = {};
    if (start) (where.date as Record<string, Date>).gte = start;
    if (end) (where.date as Record<string, Date>).lte = end;
  }

  const result = await prisma.expense.aggregate({
    where,
    _sum: { amount: true },
  });

  return result._sum.amount || 0;
}
