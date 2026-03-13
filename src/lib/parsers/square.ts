import { PlatformParser, ParseResult, emptyResult } from "./types";
import { safeFloat, parseDateTime } from "../utils/format";

/**
 * Parser for SquareUp item-level CSV exports.
 *
 * Real columns: Date, Time, Time Zone, Category, Item, Qty, Price Point Name,
 * SKU, Modifiers Applied, Gross Sales, Discounts, Net Sales, Tax,
 * Transaction ID, Payment ID, Device Name, Notes, Details, Event Type,
 * Location, Dining Option, Customer ID, Customer Name, Customer Reference ID,
 * Unit, Count, Itemization Type, Fulfillment Note, Channel, Token,
 * Card Brand, PAN Suffix
 *
 * Square exports are item-level: multiple rows share the same Transaction ID.
 * We aggregate by Transaction ID for order-level records.
 *
 * NOTE: Processing fees are NOT included in Square's item-level CSV export.
 * They appear in Square's separate payment-level or payout reports.
 */
export const squareParser: PlatformParser = {
  source: "square",

  detect(fileName: string, headers: string[]): number {
    const nameLower = fileName.toLowerCase();
    if (nameLower.includes("square")) return 0.9;

    const squareHeaders = [
      "gross sales",
      "net sales",
      "transaction id",
      "payment id",
      "event type",
      "dining option",
      "itemization type",
    ];

    const headerLower = headers.map((h) => h.toLowerCase().trim());
    const matches = squareHeaders.filter((sh) =>
      headerLower.some((h) => h.includes(sh))
    );

    if (matches.length >= 3) return 0.85;
    if (matches.length >= 2) return 0.6;
    return 0;
  },

  parse(rows: Record<string, string>[]): ParseResult {
    const result = emptyResult();

    // Group rows by Transaction ID to aggregate item-level data
    const txMap = new Map<string, Record<string, string>[]>();
    for (const row of rows) {
      result.rowsProcessed++;
      const norm = normalizeKeys(row);
      const txId = norm["transaction id"] || "";
      if (!txId) continue;
      if (!txMap.has(txId)) txMap.set(txId, []);
      txMap.get(txId)!.push(norm);
    }

    for (const [txId, items] of txMap) {
      try {
        const first = items[0];
        const date = parseDateTime(first["date"], first["time"], first["time zone"]);
        if (!date) {
          result.errors.push(`Transaction ${txId}: Invalid date`);
          continue;
        }

        // Determine event type (Payment vs Refund)
        const eventType = (first["event type"] || "").trim().toLowerCase();
        const isRefund = eventType === "refund";

        let grossSales = 0;
        let netSales = 0;
        let tax = 0;
        let discounts = 0;

        // Collect item categories across all line items
        const itemCategories = new Set<string>();

        for (const item of items) {
          grossSales += safeFloat(item["gross sales"]);
          netSales += safeFloat(item["net sales"]);
          tax += safeFloat(item["tax"]);
          discounts += Math.abs(safeFloat(item["discounts"]));

          const cat = (item["category"] || "").trim();
          if (cat) itemCategories.add(cat);
        }

        const totalCollected = netSales + tax;
        const rawData = JSON.stringify(items);

        // Extract rich metadata from first item (shared across line items)
        const diningOption = (first["dining option"] || "").trim() || undefined;
        const cardBrand = (first["card brand"] || "").trim() || undefined;
        const channel = (first["channel"] || "").trim() || undefined;
        // Join all unique item categories (e.g., "Sweet Crêpes, Drinks")
        const itemCategory =
          itemCategories.size > 0
            ? Array.from(itemCategories).join(", ")
            : undefined;

        result.platformOrders.push({
          orderId: txId,
          platform: "square",
          orderDatetime: date,
          subtotal: Math.abs(grossSales),
          tax: Math.abs(tax),
          deliveryFee: 0,
          serviceFee: 0,
          commissionFee: 0, // Not in item-level CSV
          tip: 0,
          netPayout: Math.abs(totalCollected),
          discounts,
          itemCategory,
          diningOption,
          cardBrand,
          channel,
          rawData,
        });

        if (isRefund) {
          // Refund event — record as negative income adjustment
          result.transactions.push({
            date,
            amount: Math.abs(totalCollected),
            type: "expense",
            sourcePlatform: "square",
            category: "refund",
            description: `Square refund ${txId.slice(0, 8)}`,
            rawSourceId: txId,
            rawData,
          });
        } else if (totalCollected > 0) {
          result.transactions.push({
            date,
            amount: totalCollected,
            type: "income",
            sourcePlatform: "square",
            category: "in_store_sales",
            description: `Square sale ${txId.slice(0, 8)}`,
            rawSourceId: txId,
            rawData,
          });
        }

        // Track discounts as a separate fee/expense transaction
        if (discounts > 0 && !isRefund) {
          result.transactions.push({
            date,
            amount: discounts,
            type: "expense",
            sourcePlatform: "square",
            category: "discount",
            description: `Square discount on ${txId.slice(0, 8)}`,
            rawSourceId: txId,
            rawData,
          });
        }
      } catch (e) {
        result.errors.push(
          `Transaction ${txId}: ${e instanceof Error ? e.message : "Unknown error"}`
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
