/**
 * Square API sync service — pulls orders from the Square Payments API.
 *
 * Two modes:
 * 1. **Enrich** existing CSV-imported orders with processing fees.
 * 2. **Create** new PlatformOrder records for payments that have no
 *    matching CSV import (e.g. today's sales that haven't been exported yet).
 *
 * This means the dashboard always has up-to-date Square data without
 * requiring a fresh CSV export.
 */

import { prisma } from "../db/prisma";
import {
  fetchAllPayments,
  batchRetrieveOrders,
  SquarePayment,
  SquareOrderData,
} from "./square-api";
import { ProgressCallback } from "./progress";

export interface SyncResult {
  totalPayments: number;
  matched: number;
  enriched: number;
  skipped: number;
  unmatched: number;
  created: number;
  totalFeesAdded: number;
  importId: string;
}

/**
 * Normalise Square card brand names to match CSV format.
 * API returns "VISA", CSV stores "Visa".
 */
const CARD_BRAND_MAP: Record<string, string> = {
  VISA: "Visa",
  MASTERCARD: "MasterCard",
  AMERICAN_EXPRESS: "American Express",
  DISCOVER: "Discover",
  DISCOVER_DINERS: "Discover",
  JCB: "JCB",
  CHINA_UNIONPAY: "UnionPay",
  SQUARE_GIFT_CARD: "Gift Card",
  FELICA: "Felica",
  OTHER_BRAND: "Other",
};

function normalizeCardBrand(payment: SquarePayment): string {
  if (payment.source_type === "CASH") return "";
  const raw = payment.card_details?.card?.card_brand || "";
  return CARD_BRAND_MAP[raw] || raw || "";
}

/**
 * Sync Square data: enrich existing orders + create new ones.
 *
 * Flow:
 * 1. Create Import record for audit trail
 * 2. Fetch all payments from Square API (with date filter)
 * 3. Load existing Square PlatformOrders into lookup maps
 * 4. For matched payments: update commissionFee (idempotent)
 * 5. For unmatched payments: batch-fetch order tax data, create new PlatformOrders
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
    onProgress?.({
      phase: "loading",
      current: 0,
      total: 0,
      message: "Loading existing orders from database...",
    });
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
    const orderByTxId = new Map(orders.map((o) => [o.orderId, o]));
    const orderByPaymentId = new Map<string, (typeof orders)[0]>();

    for (const o of orders) {
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

    console.log(
      `[Square Sync] Lookup maps: ${orderByTxId.size} by txId, ${orderByPaymentId.size} by paymentId`
    );

    // 4. Classify payments: matched vs unmatched
    let matched = 0;
    let enriched = 0;
    let skipped = 0;
    let totalFeesAdded = 0;
    const unmatchedPayments: SquarePayment[] = [];

    for (let i = 0; i < payments.length; i++) {
      const payment = payments[i];
      if (i % 50 === 0) {
        onProgress?.({
          phase: "enriching",
          current: i,
          total: payments.length,
          message: `Processing payments... ${i.toLocaleString()} / ${payments.length.toLocaleString()}`,
        });
      }

      const order =
        orderByPaymentId.get(payment.id) ||
        orderByTxId.get(payment.id) ||
        (payment.order_id ? orderByTxId.get(payment.order_id) : undefined);

      if (!order) {
        unmatchedPayments.push(payment);
        continue;
      }

      matched++;

      // Idempotency: skip if already has a fee
      if (order.commissionFee > 0) {
        skipped++;
        continue;
      }

      const feeCents = calculateProcessingFee(payment);
      if (feeCents === 0) {
        skipped++;
        continue;
      }

      const feeDollars = feeCents / 100;

      await prisma.platformOrder.update({
        where: { id: order.id },
        data: {
          commissionFee: feeDollars,
          netPayout: Math.round((order.netPayout - feeDollars) * 100) / 100,
        },
      });

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

    // 5. Create new orders from unmatched payments
    let created = 0;

    if (unmatchedPayments.length > 0) {
      onProgress?.({
        phase: "creating",
        current: 0,
        total: unmatchedPayments.length,
        message: `Creating ${unmatchedPayments.length} new orders from Square API...`,
      });

      // Batch-fetch order details (tax, line items, fulfillments)
      const orderIdsForDetails = unmatchedPayments
        .map((p) => p.order_id)
        .filter((id): id is string => !!id);
      const orderData =
        orderIdsForDetails.length > 0
          ? await batchRetrieveOrders(orderIdsForDetails)
          : new Map<string, SquareOrderData>();

      for (let i = 0; i < unmatchedPayments.length; i++) {
        const payment = unmatchedPayments[i];
        if (i % 50 === 0) {
          onProgress?.({
            phase: "creating",
            current: i,
            total: unmatchedPayments.length,
            message: `Creating orders... ${i.toLocaleString()} / ${unmatchedPayments.length.toLocaleString()}`,
          });
        }

        // Skip payments with no amount
        const totalCents = payment.total_money?.amount || 0;
        if (totalCents === 0) continue;

        // Amounts from API (all in cents)
        const amountCents = payment.amount_money?.amount || 0; // subtotal + tax (no tip)
        const tipCents = payment.tip_money?.amount || 0;
        const feeCents = calculateProcessingFee(payment);

        // Get order details from Orders API (if available)
        const orderDetail = payment.order_id
          ? orderData.get(payment.order_id)
          : undefined;
        const taxCents = orderDetail?.totalTaxCents || 0;

        // Compute dollars
        const subtotalDollars = (amountCents - taxCents) / 100;
        const taxDollars = taxCents / 100;
        const tipDollars = tipCents / 100;
        const feeDollars = feeCents / 100;
        const netPayoutDollars =
          Math.round((totalCents - feeCents) * 1) / 100;

        // Use payment.id as orderId (unique per payment)
        const orderId = payment.id;
        const cardBrand = normalizeCardBrand(payment);
        const diningOption = orderDetail?.diningOption || null;

        const orderDate = new Date(payment.created_at);

        // Build rawData in CSV-compatible format so items show in transactions
        let rawDataJson: string;
        if (orderDetail?.lineItems && orderDetail.lineItems.length > 0) {
          // Store items in same format as CSV imports for compatibility
          const itemRows = orderDetail.lineItems.map((li) => {
            const qty = parseFloat(li.quantity) || 0;
            const netSalesCents = (li.total_money?.amount || 0) - (li.total_tax_money?.amount || 0);
            return {
              item: li.name,
              category: li.variation_name || "Uncategorized",
              qty: String(qty),
              "net sales": `$${(netSalesCents / 100).toFixed(2)}`,
              "dining option": diningOption || "",
              "card brand": cardBrand,
              source: "square-api",
            };
          });
          rawDataJson = JSON.stringify(itemRows);
        } else {
          rawDataJson = JSON.stringify({
            source: "square-api",
            payment_id: payment.id,
            order_id: payment.order_id || null,
            source_type: payment.source_type || null,
            card_brand: payment.card_details?.card?.card_brand || null,
            last_4: payment.card_details?.card?.last_4 || null,
          });
        }

        // Check for duplicate (idempotency)
        const exists = await prisma.platformOrder.findUnique({
          where: {
            orderId_platform: { orderId, platform: "square" },
          },
          select: { id: true, rawData: true, diningOption: true },
        });

        if (exists) {
          // If existing order lacks item data, enrich it now
          const needsEnrichment = !exists.diningOption ||
            (exists.rawData && !exists.rawData.startsWith("["));
          if (needsEnrichment && orderDetail?.lineItems && orderDetail.lineItems.length > 0) {
            await prisma.platformOrder.update({
              where: { id: exists.id },
              data: {
                diningOption,
                rawData: rawDataJson,
              },
            });
            // Also update the matching transaction's rawData
            await prisma.transaction.updateMany({
              where: { rawSourceId: orderId, sourcePlatform: "square" },
              data: { rawData: rawDataJson },
            });
            enriched++;
          } else {
            skipped++;
          }
          continue;
        }

        await prisma.platformOrder.create({
          data: {
            orderId,
            platform: "square",
            orderDatetime: orderDate,
            subtotal: subtotalDollars,
            tax: taxDollars,
            tip: tipDollars,
            commissionFee: feeDollars,
            netPayout: netPayoutDollars,
            cardBrand,
            diningOption,
            channel: "INCREPEABLE", // default location
            importId: importRecord.id,
            rawData: rawDataJson,
          },
        });

        // Also create matching income transaction (so dashboard revenue picks it up)
        const totalCollected = amountCents / 100; // subtotal + tax (matches CSV parser)
        if (totalCollected > 0) {
          await prisma.transaction.create({
            data: {
              date: orderDate,
              amount: totalCollected,
              type: "income",
              sourcePlatform: "square",
              category: "in_store_sales",
              description: `Square sale ${orderId.slice(0, 8)}`,
              rawSourceId: orderId,
              rawData: rawDataJson,
              importId: importRecord.id,
            },
          });
        }

        created++;
        totalFeesAdded += feeDollars;
      }
    }

    // 6. Update Import record
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
      unmatched: unmatchedPayments.length,
      created,
      totalFeesAdded: Math.round(totalFeesAdded * 100) / 100,
      importId: importRecord.id,
    };

    console.log("[Square Sync] Complete:", result);
    return result;
  } catch (error) {
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
