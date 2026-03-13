import { PlatformParser, ParseResult, emptyResult } from "./types";
import { safeFloat, parseDateTime } from "../utils/format";

/**
 * Parser for Uber Eats merchant CSV exports.
 *
 * Real columns:
 * Order ID, Date, Customer, Order status,
 * Sales (excl. tax), Tax, Marketplace fee,
 * Customer refunds, Order charges, Estimated payout
 */
export const ubereatsParser: PlatformParser = {
  source: "ubereats",

  detect(fileName: string, headers: string[]): number {
    const nameLower = fileName.toLowerCase();
    if (nameLower.includes("uber") || nameLower.includes("ubereats"))
      return 0.9;

    const ueHeaders = [
      "marketplace fee",
      "estimated payout",
      "sales (excl. tax)",
      "customer refunds",
      "order charges",
    ];

    const headerLower = headers.map((h) => h.toLowerCase().trim());
    const matches = ueHeaders.filter((uh) =>
      headerLower.some((h) => h.includes(uh))
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

        const date = norm["date"] ? parseDateTime(norm["date"]) : null;
        if (!date) {
          result.errors.push(`Row ${result.rowsProcessed}: Invalid date`);
          continue;
        }

        const orderId = norm["order id"] || "";
        const orderStatus = (norm["order status"] || "").toLowerCase();

        if (orderStatus === "cancelled" || orderStatus === "canceled") {
          continue;
        }

        const salesExclTax = safeFloat(norm["sales (excl. tax)"]);
        const tax = safeFloat(norm["tax"]);
        const marketplaceFee = Math.abs(safeFloat(norm["marketplace fee"]));
        const customerRefunds = Math.abs(
          safeFloat(norm["customer refunds"])
        );
        const orderCharges = Math.abs(safeFloat(norm["order charges"]));
        const estimatedPayout = safeFloat(norm["estimated payout"]);

        result.platformOrders.push({
          orderId:
            orderId || `ue-${date.getTime()}-${result.rowsProcessed}`,
          platform: "ubereats",
          orderDatetime: date,
          subtotal: salesExclTax,
          tax,
          deliveryFee: 0,
          serviceFee: 0,
          commissionFee: marketplaceFee + orderCharges,
          tip: 0,
          netPayout: estimatedPayout,
          refunds: customerRefunds > 0 ? customerRefunds : undefined,
          rawData,
        });

        const grossRevenue = salesExclTax + tax;
        if (grossRevenue > 0) {
          result.transactions.push({
            date,
            amount: grossRevenue,
            type: "income",
            sourcePlatform: "ubereats",
            category: "delivery_sales",
            description: `Uber Eats order ${orderId}`,
            rawSourceId: orderId,
            rawData,
          });
        }

        const totalFees = marketplaceFee + orderCharges;
        if (totalFees > 0) {
          result.transactions.push({
            date,
            amount: totalFees,
            type: "fee",
            sourcePlatform: "ubereats",
            category: "commission",
            description: `Uber Eats fees on ${orderId}`,
            rawSourceId: orderId,
            rawData,
          });
        }

        if (customerRefunds > 0) {
          result.transactions.push({
            date,
            amount: customerRefunds,
            type: "expense",
            sourcePlatform: "ubereats",
            category: "refund",
            description: `Uber Eats refund on ${orderId}`,
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
