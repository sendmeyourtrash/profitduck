import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  ensureDefaultAliases,
  applyAliasesToVendors,
  clearAliasCache,
} from "@/lib/services/vendor-aliases";

/**
 * GET /api/vendor-aliases
 * Returns all aliases + unmatched vendor summary + ignored vendors.
 * Seeds defaults on first call if table is empty.
 */
export async function GET() {
  // Seed defaults if table is empty
  const count = await prisma.vendorAlias.count();
  if (count === 0) {
    await ensureDefaultAliases();
  }

  const [aliases, ignoredRecords] = await Promise.all([
    prisma.vendorAlias.findMany({ orderBy: { displayName: "asc" } }),
    prisma.vendorIgnore.findMany({ orderBy: { vendorName: "asc" } }),
  ]);

  // Build ignored names set
  const ignoredNames = new Set(ignoredRecords.map((r) => r.vendorName.toLowerCase()));

  // Count how many vendors are matched vs unmatched
  const matchedCount = await prisma.vendor.count({
    where: { displayName: { not: null } },
  });

  // Get all unmatched vendors (no alias displayName assigned)
  const allUnmatched = await prisma.vendor.findMany({
    where: { displayName: null },
    include: { _count: { select: { expenses: true } } },
    orderBy: { expenses: { _count: "desc" } },
  });

  // Split into truly unmatched vs ignored
  const unmatchedVendors = allUnmatched.filter(
    (v) => !ignoredNames.has(v.name.toLowerCase())
  );
  const ignoredVendors = allUnmatched.filter(
    (v) => ignoredNames.has(v.name.toLowerCase())
  );

  // Single groupBy query for expense totals
  const allUnmatchedIds = allUnmatched.map((v) => v.id);
  const expenseTotals = allUnmatchedIds.length > 0
    ? await prisma.expense.groupBy({
        by: ["vendorId"],
        where: { vendorId: { in: allUnmatchedIds } },
        _sum: { amount: true },
      })
    : [];
  const totalMap = new Map(
    expenseTotals.map((e) => [e.vendorId, e._sum.amount || 0])
  );

  const unmatchedWithTotals = unmatchedVendors.map((v) => ({
    id: v.id,
    name: v.name,
    expenseCount: v._count.expenses,
    totalSpent: totalMap.get(v.id) || 0,
  }));

  const ignoredWithTotals = ignoredVendors.map((v) => ({
    id: v.id,
    name: v.name,
    expenseCount: v._count.expenses,
    totalSpent: totalMap.get(v.id) || 0,
  }));

  return NextResponse.json({
    aliases,
    matchedCount,
    unmatchedCount: unmatchedVendors.length,
    unmatched: unmatchedWithTotals,
    ignoredCount: ignoredVendors.length,
    ignored: ignoredWithTotals,
  });
}

/**
 * POST /api/vendor-aliases
 * Create a new alias, or action: "apply" to apply all aliases to vendors,
 * or action: "seed" to re-seed defaults,
 * or action: "ignore" / "unignore" to manage ignored vendors.
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

  // Handle ignore action
  if (body.action === "ignore") {
    const { vendorName } = body;
    if (!vendorName) {
      return NextResponse.json({ error: "vendorName is required" }, { status: 400 });
    }
    await prisma.vendorIgnore.upsert({
      where: { vendorName },
      create: { vendorName },
      update: {},
    });
    return NextResponse.json({ ignored: true });
  }

  // Handle unignore action
  if (body.action === "unignore") {
    const { vendorName } = body;
    if (!vendorName) {
      return NextResponse.json({ error: "vendorName is required" }, { status: 400 });
    }
    await prisma.vendorIgnore.deleteMany({ where: { vendorName } });
    return NextResponse.json({ unignored: true });
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

  // Also remove from ignored list if it was there
  await prisma.vendorIgnore.deleteMany({
    where: { vendorName: pattern },
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
