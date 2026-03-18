/**
 * Expenses Dashboard API — Source of truth: Rocket Money transactions table.
 *
 * Uses the `transactions` table filtered to RM expenses (not the legacy `expenses` table)
 * so that dedup, reconciliation, and category data are consistent across the app.
 *
 * Excludes:
 *   - Internal transfers (category LIKE 'transfer:%')
 *   - Negative amounts (CC payment outflows — these cancel with income records)
 *   - Chase records (100% duplicates of RM)
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

const PRIMARY_SOURCE = "rocketmoney";

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
    // "All" — find the earliest expense
    const earliest = await prisma.transaction.findFirst({
      where: {
        type: "expense",
        sourcePlatform: PRIMARY_SOURCE,
        duplicateOfId: null,
        amount: { gt: 0 },
      },
      orderBy: { date: "asc" },
      select: { date: true },
    });
    startDate = earliest
      ? earliest.date
      : new Date(new Date().setDate(new Date().getDate() - 365));
  }

  const dateGte = startDate.toISOString();
  const dateLte = endDate ? endDate.toISOString() : undefined;
  const dateClause = dateLte
    ? `AND date >= '${dateGte}' AND date <= '${dateLte}'`
    : `AND date >= '${dateGte}'`;

  // ── Expenses by category (from RM transactions) ──────────────────────
  const expensesByCategory = await prisma.$queryRawUnsafe<
    { category: string; total: number; cnt: number }[]
  >(`
    SELECT
      COALESCE(category, '(uncategorized)') as category,
      ROUND(SUM(amount), 2) as total,
      COUNT(*) as cnt
    FROM transactions
    WHERE source_platform = '${PRIMARY_SOURCE}'
      AND type = 'expense'
      AND duplicate_of_id IS NULL
      AND amount > 0
      AND (category IS NULL OR category NOT LIKE 'transfer:%')
      ${dateClause}
    GROUP BY category
    ORDER BY total DESC
  `);

  // ── Expenses by vendor (description-based grouping) ──────────────────
  const expensesByVendor = await prisma.$queryRawUnsafe<
    { vendor: string; total: number; cnt: number }[]
  >(`
    SELECT
      CASE
        WHEN description LIKE 'Rent%' OR description LIKE '%1654 Third%' THEN 'Rent (1654 Third Ave)'
        WHEN description LIKE 'Groceries - Costco%' THEN 'Costco'
        WHEN description LIKE 'Groceries - JETRO%' THEN 'Jetro Cash & Carry'
        WHEN description LIKE 'Groceries - Restaurant Depot%' OR description LIKE 'Groceries - RESTAURANT DEPOT%' THEN 'Restaurant Depot'
        WHEN description LIKE 'Insurance%' THEN 'Insurance'
        WHEN description LIKE 'Payroll%' OR description LIKE '%Gusto%' THEN 'Payroll (Gusto)'
        WHEN description LIKE 'Taxes%' THEN 'Taxes'
        WHEN description LIKE 'Bills%' THEN 'Bills & Utilities'
        WHEN description LIKE 'Shopping - Amazon%' THEN 'Amazon'
        WHEN description LIKE 'Permits%' THEN 'Permits & Licenses'
        WHEN description LIKE 'Marketing%' OR description LIKE 'Ads%' THEN 'Marketing & Advertising'
        WHEN description LIKE 'Construction%' OR description LIKE 'Maintenance%' THEN 'Construction & Maintenance'
        ELSE substr(description, 1, 40)
      END as vendor,
      ROUND(SUM(amount), 2) as total,
      COUNT(*) as cnt
    FROM transactions
    WHERE source_platform = '${PRIMARY_SOURCE}'
      AND type = 'expense'
      AND duplicate_of_id IS NULL
      AND amount > 0
      AND (category IS NULL OR category NOT LIKE 'transfer:%')
      ${dateClause}
    GROUP BY vendor
    ORDER BY total DESC
    LIMIT 20
  `);

  // ── Daily expense trend ──────────────────────────────────────────────
  const dailyExpenses = await prisma.$queryRawUnsafe<
    { date: string; total: number }[]
  >(`
    SELECT strftime('%Y-%m-%d', date) as date, ROUND(SUM(amount), 2) as total
    FROM transactions
    WHERE source_platform = '${PRIMARY_SOURCE}'
      AND type = 'expense'
      AND duplicate_of_id IS NULL
      AND amount > 0
      AND (category IS NULL OR category NOT LIKE 'transfer:%')
      ${dateClause}
    GROUP BY strftime('%Y-%m-%d', date)
    ORDER BY date ASC
  `);

  // ── Expenses by payment method (from legacy expenses table — still useful) ──
  const dateFilter = { gte: startDate, ...(endDate ? { lte: endDate } : {}) };
  const expensesByPaymentMethod = await prisma.expense.groupBy({
    by: ["paymentMethod"],
    where: { date: dateFilter },
    _sum: { amount: true },
    _count: true,
    orderBy: { _sum: { amount: "desc" } },
  });

  // ── Fees by platform (from platform_orders — granular breakdown) ─────
  const platformFees = await prisma.platformOrder.groupBy({
    by: ["platform"],
    where: { orderDatetime: dateFilter },
    _sum: {
      commissionFee: true,
      serviceFee: true,
      deliveryFee: true,
      marketingFees: true,
      customerFees: true,
    },
  });

  // ── Internal transfers summary ───────────────────────────────────────
  const transferExpenses = await prisma.$queryRawUnsafe<
    { category: string; total: number; cnt: number }[]
  >(`
    SELECT category, ROUND(SUM(ABS(amount)), 2) as total, COUNT(*) as cnt
    FROM transactions
    WHERE source_platform = '${PRIMARY_SOURCE}'
      AND type = 'expense'
      AND duplicate_of_id IS NULL
      AND category LIKE 'transfer:%'
      ${dateClause}
    GROUP BY category
    ORDER BY total DESC
  `);

  return NextResponse.json({
    expensesByVendor: expensesByVendor.map((e) => ({
      vendorId: e.vendor,
      vendorName: e.vendor,
      total: Number(e.total),
      count: Number(e.cnt),
    })),
    expensesByCategory: expensesByCategory.map((e) => ({
      category: e.category,
      total: Number(e.total),
      count: Number(e.cnt),
    })),
    dailyExpenses: dailyExpenses.map((d) => ({
      date: d.date,
      total: Number(d.total),
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
    transfers: transferExpenses.map((t) => ({
      category: t.category,
      total: Number(t.total),
      count: Number(t.cnt),
    })),
  });
}
