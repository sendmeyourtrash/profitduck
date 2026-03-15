import { prisma } from "../../db/prisma";

/**
 * One-time cleanup: backfill platformPayoutId from rawData JSON and
 * remove duplicate payout records.
 */
export async function deduplicatePayouts(): Promise<{
  payoutsBackfilled: number;
  ordersBackfilled: number;
  duplicatesRemoved: number;
}> {
  let payoutsBackfilled = 0;
  let ordersBackfilled = 0;
  let duplicatesRemoved = 0;

  // ── Phase 1: Backfill platformPayoutId on Payouts from rawData ──
  const allPayouts = await prisma.payout.findMany({
    where: { platformPayoutId: null },
    select: { id: true, platform: true, rawData: true },
  });

  for (const payout of allPayouts) {
    if (!payout.rawData) continue;
    try {
      const raw = JSON.parse(payout.rawData);
      const payoutId = raw["Payout ID"] || raw["payout id"];
      if (payoutId) {
        await prisma.payout.update({
          where: { id: payout.id },
          data: { platformPayoutId: String(payoutId) },
        });
        payoutsBackfilled++;
      }
    } catch {
      /* skip unparseable */
    }
  }

  // ── Phase 2: Backfill platformPayoutId on PlatformOrders from rawData ──
  const allOrders = await prisma.platformOrder.findMany({
    where: { platformPayoutId: null, platform: "doordash" },
    select: { id: true, rawData: true },
  });

  for (const order of allOrders) {
    if (!order.rawData) continue;
    try {
      const raw = JSON.parse(order.rawData);
      const payoutId = raw["Payout ID"] || raw["payout id"];
      if (payoutId) {
        await prisma.platformOrder.update({
          where: { id: order.id },
          data: { platformPayoutId: String(payoutId) },
        });
        ordersBackfilled++;
      }
    } catch {
      /* skip */
    }
  }

  // ── Phase 3: Remove duplicate payouts ──
  // Group by platform + platformPayoutId + netAmount where count > 1.
  // We include netAmount because DoorDash can split a single payout ID
  // across channels (Marketplace, Storefront) with different amounts.
  const groups = await prisma.$queryRawUnsafe<
    {
      platform_payout_id: string;
      platform: string;
      net_amount: number;
      cnt: number;
    }[]
  >(
    `SELECT platform_payout_id, platform, net_amount, COUNT(*) as cnt
     FROM payouts
     WHERE platform_payout_id IS NOT NULL
     GROUP BY platform, platform_payout_id, net_amount
     HAVING COUNT(*) > 1`
  );

  for (const group of groups) {
    const dupes = await prisma.payout.findMany({
      where: {
        platform: group.platform,
        platformPayoutId: group.platform_payout_id,
        netAmount: group.net_amount,
      },
      orderBy: { createdAt: "asc" },
    });

    if (dupes.length <= 1) continue;

    // Keep the first (earliest), delete the rest one by one
    const canonicalId = dupes[0].id;

    for (let i = 1; i < dupes.length; i++) {
      const deleteId = dupes[i].id;

      // Clear bankTransactionId to avoid unique constraint issues
      await prisma.payout.update({
        where: { id: deleteId },
        data: { bankTransactionId: null },
      });

      // Move FK references to the canonical record
      await prisma.platformOrder.updateMany({
        where: { linkedPayoutId: deleteId },
        data: { linkedPayoutId: canonicalId },
      });
      await prisma.transaction.updateMany({
        where: { linkedPayoutId: deleteId },
        data: { linkedPayoutId: canonicalId },
      });

      // Delete the duplicate
      await prisma.payout.delete({ where: { id: deleteId } });
      duplicatesRemoved++;
    }
  }

  return { payoutsBackfilled, ordersBackfilled, duplicatesRemoved };
}
