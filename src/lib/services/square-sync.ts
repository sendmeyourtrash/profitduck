/**
 * Square API sync service — enriches existing PlatformOrders
 * with processing fees from the Square Payments API.
 */

import { prisma } from "../db/prisma";
import { fetchAllPayments, SquarePayment } from "./square-api";
import { ProgressCallback } from "./progress";

export interface SyncResult {
  totalPayments: number;
  matched: number;
  enriched: number;
  skipped: number;
  unmatched: number;
  totalFeesAdded: number;
  importId: string;
}

/**
 * Sync Square processing fees into existing PlatformOrders.
 *
 * Flow:
 * 1. Create Import record for audit trail
 * 2. Fetch all payments from Square API
 * 3. Load all Square PlatformOrders into a Map keyed by orderId
 * 4. For each API payment, find matching PlatformOrder and update commissionFee
 * 5. Create AuditLog entries for each enrichment
 *
 * Idempotent: orders with commissionFee > 0 are skipped.
 */
export async function syncSquareFees(
  startDate?: string,
  endDate?: string,
  onProgress?: ProgressCallback
): Promise<SyncResult> {
  // 1. Create Import record
  const label = startDate
    ? `Square API Sync (since ${new Date(startDate).toLocaleDateString()})`
    : "Square API Sync (full)";
  console.log(`[Square Sync] ${label}`);

  const importRecord = await prisma.import.create({
    data: {
      source: "square-api",
      fileName: label,
      status: "processing",
      rowsProcessed: 0,
      dateRangeStart: startDate ? new Date(startDate) : undefined,
      dateRangeEnd: endDate ? new Date(endDate) : undefined,
    },
  });

  try {
    // 2. Fetch payments from Square API
    const payments = await fetchAllPayments(startDate, endDate, onProgress);

    // 3. Load all Square PlatformOrders and build lookup maps
    onProgress?.({ phase: "loading", current: 0, total: 0, message: "Loading existing orders from database..." });
    const orders = await prisma.platformOrder.findMany({
      where: { platform: "square" },
      select: {
        id: true,
        orderId: true,
        commissionFee: true,
        netPayout: true,
        rawData: true,
      },
    });

    // CSV "Transaction ID" → stored as orderId
    // CSV "Payment ID" → stored in rawData JSON
    // API payment.id = CSV "Payment ID"
    // API payment.order_id = Square's internal order ID (different from both)
    const orderByTxId = new Map(
      orders.map((o) => [o.orderId, o])
    );
    const orderByPaymentId = new Map<
      string,
      (typeof orders)[0]
    >();

    for (const o of orders) {
      // Extract Payment ID from rawData (array of CSV row objects)
      if (o.rawData) {
        try {
          const rows = JSON.parse(o.rawData);
          const firstRow = Array.isArray(rows) ? rows[0] : rows;
          const paymentId =
            firstRow?.["payment id"] || firstRow?.["Payment ID"];
          if (paymentId) {
            orderByPaymentId.set(paymentId, o);
          }
        } catch {
          // ignore parse errors
        }
      }
    }

    // Debug logging
    if (payments.length > 0) {
      const s = payments[0];
      console.log("[Square Sync] Sample API payment:", {
        id: s.id,
        order_id: s.order_id,
      });
    }
    console.log(
      `[Square Sync] Lookup maps: ${orderByTxId.size} by txId, ${orderByPaymentId.size} by paymentId`
    );

    // 4. Match and enrich
    let matched = 0;
    let enriched = 0;
    let skipped = 0;
    let unmatched = 0;
    let totalFeesAdded = 0;

    for (let i = 0; i < payments.length; i++) {
      const payment = payments[i];
      if (i % 50 === 0) {
        onProgress?.({ phase: "enriching", current: i, total: payments.length, message: `Enriching orders... ${i.toLocaleString()} / ${payments.length.toLocaleString()}` });
      }
      // Try matching: API payment.id → CSV Payment ID, or API order_id → CSV Transaction ID
      const order =
        orderByPaymentId.get(payment.id) ||
        orderByTxId.get(payment.id) ||
        (payment.order_id ? orderByTxId.get(payment.order_id) : undefined);

      if (!order) {
        unmatched++;
        continue;
      }

      matched++;

      // Idempotency: skip if already has a fee
      if (order.commissionFee > 0) {
        skipped++;
        continue;
      }

      // Calculate total processing fee (cents → dollars)
      const feeCents = calculateProcessingFee(payment);
      if (feeCents === 0) {
        skipped++;
        continue;
      }

      const feeDollars = feeCents / 100;

      // Update the PlatformOrder
      await prisma.platformOrder.update({
        where: { id: order.id },
        data: {
          commissionFee: feeDollars,
          // Recalculate netPayout: subtract fee from current net
          netPayout: Math.round((order.netPayout - feeDollars) * 100) / 100,
        },
      });

      // Create AuditLog entry
      await prisma.auditLog.create({
        data: {
          entityType: "platformOrder",
          entityId: order.id,
          field: "commissionFee",
          oldValue: "0",
          newValue: feeDollars.toFixed(2),
          reason: "Square API sync — processing fee enrichment",
          actor: "system",
        },
      });

      enriched++;
      totalFeesAdded += feeDollars;
    }

    // 5. Update Import record
    await prisma.import.update({
      where: { id: importRecord.id },
      data: {
        status: "completed",
        rowsProcessed: payments.length,
        rowsSkipped: skipped,
      },
    });

    const result: SyncResult = {
      totalPayments: payments.length,
      matched,
      enriched,
      skipped,
      unmatched,
      totalFeesAdded: Math.round(totalFeesAdded * 100) / 100,
      importId: importRecord.id,
    };

    console.log("[Square Sync] Complete:", result);
    return result;
  } catch (error) {
    // Mark import as failed
    await prisma.import.update({
      where: { id: importRecord.id },
      data: {
        status: "failed",
        errorMessage:
          error instanceof Error ? error.message : "Unknown error",
      },
    });
    throw error;
  }
}

/**
 * Calculate total processing fee from a Square payment (in cents).
 */
function calculateProcessingFee(payment: SquarePayment): number {
  if (!payment.processing_fee || payment.processing_fee.length === 0) {
    return 0;
  }
  return payment.processing_fee.reduce(
    (sum, fee) => sum + (fee.amount_money?.amount || 0),
    0
  );
}

/**
 * Get the last Square API sync import record.
 */
export async function getLastSyncStatus() {
  const lastSync = await prisma.import.findFirst({
    where: { source: "square-api" },
    orderBy: { importedAt: "desc" },
  });
  return lastSync;
}
