import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveItemNames } from "@/lib/services/menu-item-aliases";
import { resolveCategoryNames } from "@/lib/services/menu-category-aliases";

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
    if (startDate) where.date.gte = new Date(startDate + "T00:00:00.000Z");
    if (endDate) {
      // End date is inclusive — set to end of day (UTC)
      where.date.lte = new Date(endDate + "T23:59:59.999Z");
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

  // Enrich platform transactions with order details (payment method, dining option, items)
  const platformTxs = transactions.filter(
    (t) => t.rawSourceId && ["square", "doordash", "ubereats", "grubhub"].includes(t.sourcePlatform)
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orderDetailsMap = new Map<string, any>();

  if (platformTxs.length > 0) {
    // Build OR conditions for each (orderId, platform) pair
    const orConditions = platformTxs.map((t) => ({
      orderId: t.rawSourceId!,
      platform: t.sourcePlatform,
    }));

    const platformOrders = await prisma.platformOrder.findMany({
      where: { OR: orConditions },
      select: {
        orderId: true,
        platform: true,
        cardBrand: true,
        diningOption: true,
        channel: true,
        fulfillmentType: true,
        subtotal: true,
        tax: true,
        tip: true,
        commissionFee: true,
        serviceFee: true,
        deliveryFee: true,
        netPayout: true,
        rawData: true,
      },
    });

    // Collect all raw item and category names across all Square orders for batch alias resolution
    const allRawItemNames = new Set<string>();
    const allRawCategoryNames = new Set<string>();
    const parsedItemsByKey = new Map<string, { name: string; category: string; qty: number; price: number }[]>();

    for (const po of platformOrders) {
      const key = `${po.orderId}|${po.platform}`;

      let items: { name: string; category: string; qty: number; price: number }[] | null = null;
      if (po.platform === "square" && po.rawData) {
        try {
          const parsed = JSON.parse(po.rawData) as Record<string, string>[];
          items = parsed
            .filter((row) => (row["item"] || "").trim() && parseFloat(row["qty"] || "0") > 0)
            .map((row) => {
              const name = (row["item"] || "").trim();
              const category = (row["category"] || "").trim();
              allRawItemNames.add(name);
              if (category) allRawCategoryNames.add(category);
              return {
                name,
                category,
                qty: parseFloat(row["qty"] || "0"),
                price: parseFloat((row["net sales"] || "0").replace(/[$,]/g, "")) || 0,
              };
            });
          parsedItemsByKey.set(key, items);
        } catch {
          // skip
        }
      }

      orderDetailsMap.set(key, {
        cardBrand: po.cardBrand || null,
        diningOption: po.diningOption || null,
        channel: po.channel || null,
        fulfillmentType: po.fulfillmentType || null,
        subtotal: po.subtotal,
        tax: po.tax,
        tip: po.tip,
        fees: po.commissionFee + po.serviceFee + po.deliveryFee,
        netPayout: po.netPayout,
        items: null, // populated below after alias resolution
      });
    }

    // Resolve item and category aliases in one batch
    const itemAliasMap = allRawItemNames.size > 0
      ? await resolveItemNames([...allRawItemNames])
      : new Map<string, string>();
    const categoryAliasMap = allRawCategoryNames.size > 0
      ? await resolveCategoryNames([...allRawCategoryNames])
      : new Map<string, string>();

    // Apply resolved names to items
    for (const [key, items] of parsedItemsByKey) {
      const detail = orderDetailsMap.get(key);
      if (detail) {
        detail.items = items.map((item) => ({
          ...item,
          name: itemAliasMap.get(item.name) || item.name,
          category: categoryAliasMap.get(item.category) || item.category,
        }));
      }
    }
  }

  // Merge order details into transactions
  const enriched = transactions.map((t) => {
    const key = `${t.rawSourceId}|${t.sourcePlatform}`;
    const orderDetail = orderDetailsMap.get(key) || null;
    return { ...t, orderDetail };
  });

  return NextResponse.json({ transactions: enriched, total, limit, offset });
}
