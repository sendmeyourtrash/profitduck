import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Single value filters (backward compat)
  const type = searchParams.get("type");
  const platform = searchParams.get("platform");
  const category = searchParams.get("category");

  // Multi-value filters
  const types = searchParams.getAll("types");
  const platforms = searchParams.getAll("platforms");
  const categories = searchParams.getAll("categories");

  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const search = searchParams.get("search");
  const limit = parseInt(searchParams.get("limit") || "100");
  const offset = parseInt(searchParams.get("offset") || "0");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  // Type filter (single or multi)
  if (types.length > 0) {
    where.type = { in: types };
  } else if (type) {
    where.type = type;
  }

  // Platform filter (single or multi)
  if (platforms.length > 0) {
    where.sourcePlatform = { in: platforms };
  } else if (platform) {
    where.sourcePlatform = platform;
  }

  // Category filter (single or multi)
  if (categories.length > 0) {
    where.category = { in: categories };
  } else if (category) {
    where.category = category;
  }

  // Date range
  if (startDate || endDate) {
    where.date = {};
    if (startDate) where.date.gte = new Date(startDate);
    if (endDate) {
      // End date is inclusive — set to end of day
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      where.date.lte = end;
    }
  }

  // Description search
  if (search) {
    where.description = { contains: search };
  }

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: {
        import: {
          select: { source: true, fileName: true, importedAt: true },
        },
        linkedPayout: {
          select: {
            id: true,
            platform: true,
            payoutDate: true,
            grossAmount: true,
            fees: true,
            netAmount: true,
            reconciliationStatus: true,
          },
        },
        linkedBankTransaction: {
          select: {
            id: true,
            date: true,
            description: true,
            amount: true,
            category: true,
            accountName: true,
            institutionName: true,
            reconciliationStatus: true,
          },
        },
        auditLogs: {
          select: {
            id: true,
            field: true,
            oldValue: true,
            newValue: true,
            reason: true,
            actor: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
      orderBy: { date: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.transaction.count({ where }),
  ]);

  return NextResponse.json({ transactions, total, limit, offset });
}
