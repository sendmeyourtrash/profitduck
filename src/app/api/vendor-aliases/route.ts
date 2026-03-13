import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  ensureDefaultAliases,
  applyAliasesToVendors,
  clearAliasCache,
} from "@/lib/services/vendor-aliases";

/**
 * GET /api/vendor-aliases
 * Returns all aliases + unmatched vendor summary.
 * Seeds defaults on first call if table is empty.
 */
export async function GET() {
  // Seed defaults if table is empty
  const count = await prisma.vendorAlias.count();
  if (count === 0) {
    await ensureDefaultAliases();
  }

  const aliases = await prisma.vendorAlias.findMany({
    orderBy: { displayName: "asc" },
  });

  // Count how many vendors are matched vs unmatched
  const matchedCount = await prisma.vendor.count({
    where: { displayName: { not: null } },
  });
  const unmatchedCount = await prisma.vendor.count({
    where: { displayName: null },
  });

  // Get unmatched vendors with their expense totals (top 50)
  const unmatched = await prisma.vendor.findMany({
    where: { displayName: null },
    include: { _count: { select: { expenses: true } } },
    orderBy: { expenses: { _count: "desc" } },
    take: 50,
  });

  // Single groupBy query instead of N+1 individual aggregates
  const unmatchedIds = unmatched.map((v) => v.id);
  const expenseTotals = unmatchedIds.length > 0
    ? await prisma.expense.groupBy({
        by: ["vendorId"],
        where: { vendorId: { in: unmatchedIds } },
        _sum: { amount: true },
      })
    : [];
  const totalMap = new Map(
    expenseTotals.map((e) => [e.vendorId, e._sum.amount || 0])
  );

  const unmatchedWithTotals = unmatched.map((v) => ({
    id: v.id,
    name: v.name,
    expenseCount: v._count.expenses,
    totalSpent: totalMap.get(v.id) || 0,
  }));

  return NextResponse.json({
    aliases,
    matchedCount,
    unmatchedCount,
    unmatched: unmatchedWithTotals,
  });
}

/**
 * POST /api/vendor-aliases
 * Create a new alias, or action: "apply" to apply all aliases to vendors,
 * or action: "seed" to re-seed defaults.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.action === "apply") {
    const result = await applyAliasesToVendors();
    return NextResponse.json(result);
  }

  if (body.action === "seed") {
    const inserted = await ensureDefaultAliases();
    // Auto-apply after seeding
    const result = await applyAliasesToVendors();
    return NextResponse.json({ seeded: inserted, ...result });
  }

  // Create new alias
  const { pattern, matchType, displayName } = body;
  if (!pattern || !matchType || !displayName) {
    return NextResponse.json(
      { error: "pattern, matchType, and displayName are required" },
      { status: 400 }
    );
  }

  const alias = await prisma.vendorAlias.create({
    data: { pattern, matchType, displayName, autoCreated: false },
  });

  clearAliasCache();

  // Auto-apply the new alias to existing vendors
  await applyAliasesToVendors();

  return NextResponse.json({ alias });
}

/**
 * PATCH /api/vendor-aliases
 * Update an existing alias's pattern, matchType, or displayName.
 */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, pattern, matchType, displayName } = body;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const data: Record<string, string> = {};
  if (pattern !== undefined) data.pattern = pattern;
  if (matchType !== undefined) data.matchType = matchType;
  if (displayName !== undefined) data.displayName = displayName;

  const alias = await prisma.vendorAlias.update({ where: { id }, data });
  clearAliasCache();

  // Re-apply all aliases so vendor displayNames reflect the change
  await applyAliasesToVendors();

  return NextResponse.json({ alias });
}

/**
 * DELETE /api/vendor-aliases?id=<id>
 * Delete an alias and clear display names that used it.
 */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await prisma.vendorAlias.delete({ where: { id } });
  clearAliasCache();

  // Re-apply remaining aliases (will clear orphaned displayNames)
  const result = await applyAliasesToVendors();

  return NextResponse.json({ deleted: true, ...result });
}
