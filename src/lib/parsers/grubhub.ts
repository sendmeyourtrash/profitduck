import { PlatformParser, ParseResult, emptyResult } from "./types";
import { safeFloat, parseDateTime } from "../utils/format";

/**
 * Parser for Grubhub merchant CSV exports.
 *
 * Real columns (underscore-separated):
 * order_channel, order_number, order_date, order_time_local,
 * order_day_of_week, order_hour_of_day,
 * transaction_date, transaction_time_local, grubhub_store_id,
 * store_name, transaction_type, fulfillment_type, gh_plus_customer,
 * subtotal, subtotal_sales_tax, tip, merchant_total,
 * commission, delivery_commission, gh_plus_commission, processing_fee,
 * self_delivery_charge, merchant_funded_promotion, merchant_funded_loyalty,
 * merchant_flexible_fee_bag_fee, withheld_tax,
 * merchant_net_total, transaction_note, transaction_id
 */
export const grubhubParser: PlatformParser = {
  source: "grubhub",

  detect(fileName: string, headers: string[]): number {
    const nameLower = fileName.toLowerCase();
    if (nameLower.includes("grubhub")) return 0.9;

    const ghHeaders = [
      "merchant_net_total",
      "grubhub_store_id",
      "gh_plus_customer",
      "delivery_commission",
      "merchant_total",
      "order_channel",
    ];

    const headerLower = headers.map((h) => h.toLowerCase().trim());
    const matches = ghHeaders.filter((gh) =>
      headerLower.some((h) => h === gh)
    );

    if (matches.length >= 3) return 0.9;
    if (matches.length >= 2) return 0.7;
    return 0;
  },

  parse(rows: Record<string, string>[]): ParseResult {
    const result = emptyResult();

    for (const row of rows) {
      try {
        result.rowsProcessed++;
        const rawData = JSON.stringify(row);
        const norm = normalizeKeys(row);

        const dateCol = norm["transaction_date"] || norm["order_date"];
        const timeCol = norm["transaction_time_local"] || norm["order_time_local"];
        const date = dateCol ? parseDateTime(dateCol, timeCol) : null;
        if (!date) {
          result.errors.push(`Row ${result.rowsProcessed}: Invalid date`);
          continue;
        }

        const orderId = norm["transaction_id"] || norm["order_number"] || "";
        const subtotal = safeFloat(norm["subtotal"]);
        const subtotalTax = safeFloat(norm["subtotal_sales_tax"]);
        const tip = safeFloat(norm["tip"]);
        const merchantTotal = safeFloat(norm["merchant_total"]);
        const commission = Math.abs(safeFloat(norm["commission"]));
        const deliveryCommission = Math.abs(
          safeFloat(norm["delivery_commission"])
        );
        const ghPlusCommission = Math.abs(
          safeFloat(norm["gh_plus_commission"])
        );
        const processingFee = Math.abs(safeFloat(norm["processing_fee"]));
        const selfDeliveryCharge = Math.abs(
          safeFloat(norm["self_delivery_charge"])
        );
        const merchantNetTotal = safeFloat(norm["merchant_net_total"]);
        const merchantPromo = Math.abs(
          safeFloat(norm["merchant_funded_promotion"])
        );
        const merchantLoyalty = Math.abs(
          safeFloat(norm["merchant_funded_loyalty"])
        );
        const flexibleFeeBagFee = Math.abs(
          safeFloat(norm["merchant_flexible_fee_bag_fee"])
        );
        const withheldTax = Math.abs(safeFloat(norm["withheld_tax"]));

        // Rich metadata
        const channel = (norm["order_channel"] || "").trim() || undefined;
        const fulfillmentType =
          (norm["fulfillment_type"] || "").trim() || undefined;

        const totalCommission =
          commission + deliveryCommission + ghPlusCommission;
        const totalFees =
          totalCommission +
          processingFee +
          selfDeliveryCharge +
          flexibleFeeBagFee;
        const totalMarketingFees = merchantPromo + merchantLoyalty;

        result.platformOrders.push({
          orderId:
            orderId || `gh-${date.getTime()}-${result.rowsProcessed}`,
          platform: "grubhub",
          orderDatetime: date,
          subtotal,
          tax: subtotalTax,
          deliveryFee: selfDeliveryCharge,
          serviceFee: processingFee + flexibleFeeBagFee,
          commissionFee: totalCommission,
          tip,
          netPayout: merchantNetTotal,
          channel,
          fulfillmentType,
          marketingFees: totalMarketingFees,
          adjustments: withheldTax > 0 ? -withheldTax : 0,
          rawData,
        });

        const grossRevenue =
          merchantTotal || subtotal + subtotalTax + tip;
        if (grossRevenue > 0) {
          result.transactions.push({
            date,
            amount: grossRevenue,
            type: "income",
            sourcePlatform: "grubhub",
            category: "delivery_sales",
            description: `Grubhub order ${(orderId || "").slice(0, 12)}`,
            rawSourceId: orderId,
            rawData,
          });
        }

        if (totalFees > 0) {
          result.transactions.push({
            date,
            amount: totalFees,
            type: "fee",
            sourcePlatform: "grubhub",
            category: "commission",
            description: `Grubhub fees on ${(orderId || "").slice(0, 12)}`,
            rawSourceId: orderId,
            rawData,
          });
        }

        if (totalMarketingFees > 0) {
          result.transactions.push({
            date,
            amount: totalMarketingFees,
            type: "expense",
            sourcePlatform: "grubhub",
            category: "promotion",
            description: `Grubhub merchant promo ${(orderId || "").slice(0, 12)}`,
            rawSourceId: orderId,
            rawData,
          });
        }

        // Track withheld tax separately if present
        if (withheldTax > 0) {
          result.transactions.push({
            date,
            amount: withheldTax,
            type: "expense",
            sourcePlatform: "grubhub",
            category: "tax_withheld",
            description: `Grubhub withheld tax ${(orderId || "").slice(0, 12)}`,
            rawSourceId: orderId,
            rawData,
          });
        }
      } catch (e) {
        result.errors.push(
          `Row ${result.rowsProcessed}: ${e instanceof Error ? e.message : "Unknown error"}`
        );
      }
    }

    return result;
  },
};

function normalizeKeys(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.toLowerCase().trim()] = v;
  }
  return out;
}
