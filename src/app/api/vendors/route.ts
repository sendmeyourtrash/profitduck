import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "100");

  const vendors = await prisma.vendor.findMany({
    include: {
      _count: { select: { expenses: true } },
      expenses: {
        select: { amount: true },
      },
    },
    orderBy: { name: "asc" },
    take: limit,
  });

  return NextResponse.json({
    vendors: vendors.map((v) => ({
      id: v.id,
      name: v.name,
      category: v.category,
      expenseCount: v._count.expenses,
      totalSpent: v.expenses.reduce((sum, e) => sum + e.amount, 0),
    })),
  });
}
