import { PlatformParser, ParseResult, emptyResult } from "./types";
import { safeFloat, parseDate, parseDateTime } from "../utils/format";

/**
 * Parser for DoorDash merchant CSV exports.
 *
 * Supports two report types:
 *
 * 1. FINANCIAL_SIMPLIFIED_TRANSACTIONS:
 *    Columns: Business ID, Business name, Store ID, Store name,
 *    Timestamp local time, DoorDash transaction ID, DoorDash order ID,
 *    Transaction type, Channel, Description, Subtotal, Tax (subtotal),
 *    Commission, Merchant fees, Customer fees, Tax (customer fees),
 *    Marketing fees, Customer discounts, DoorDash marketing credit,
 *    Third-party contribution, Error charges, Adjustments, Net total,
 *    Payout date, Payout ID
 *
 * 2. FINANCIAL_PAYOUT_SUMMARY:
 *    Columns: Payout date, Channel, Subtotal,
 *    Subtotal tax passed to merchant, Commission,
 *    Payment processing fee, Tablet fee, Net total,
 *    Payout ID, Payout status
 */
export const doordashParser: PlatformParser = {
  source: "doordash",

  detect(fileName: string, headers: string[]): number {
    const nameLower = fileName.toLowerCase();
    if (nameLower.includes("doordash")) return 0.9;

    const ddHeaders = [
      "doordash transaction id",
      "doordash order id",
      "net total",
      "customer discounts",
      "doordash marketing credit",
      "payout id",
    ];

    const headerLower = headers.map((h) => h.toLowerCase().trim());
    const matches = ddHeaders.filter((dh) =>
      headerLower.some((h) => h.includes(dh))
    );

    if (matches.length >= 3) return 0.85;
    if (matches.length >= 2) return 0.6;
    return 0;
  },

  parse(rows: Record<string, string>[]): ParseResult {
    const result = emptyResult();

    const firstRow = rows[0] ? normalizeKeys(rows[0]) : {};
    const isSimplifiedTx = "doordash order id" in firstRow;
    const isPayoutSummary = "payout status" in firstRow;

    for (const row of rows) {
      try {
        result.rowsProcessed++;
        const rawData = JSON.stringify(row);
        const norm = normalizeKeys(row);

        if (isPayoutSummary && !isSimplifiedTx) {
          parsePayoutSummaryRow(norm, rawData, result);
        } else {
          parseSimplifiedTxRow(norm, rawData, result);
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

function parseSimplifiedTxRow(
  norm: Record<string, string>,
  rawData: string,
  result: ParseResult
) {
  const dateStr = norm["timestamp local time"] || norm["payout date"];
  const date = dateStr ? parseDateTime(dateStr) : null;
  if (!date) {
    result.errors.push(`Row ${result.rowsProcessed}: Invalid date`);
    return;
  }

  const orderId = norm["doordash order id"] || "";
  const txType = (norm["transaction type"] || "").toLowerCase();
  const channel = (norm["channel"] || "").trim() || undefined;
  const ddDescription = (norm["description"] || "").trim();

  if (txType && txType !== "order") {
    // Non-order transaction types: adjustments, error charges, etc.
    const errorCharges = safeFloat(norm["error charges"]);
    const adjustments = safeFloat(norm["adjustments"]);
    const netTotal = safeFloat(norm["net total"]);
    const amount = netTotal !== 0 ? Math.abs(netTotal) : Math.abs(errorCharges + adjustments);

    if (amount !== 0) {
      result.transactions.push({
        date,
        amount,
        type: "expense",
        sourcePlatform: "doordash",
        category: "adjustment",
        description: ddDescription || `DoorDash ${txType} ${orderId}`,
        rawSourceId: norm["doordash transaction id"] || "",
        rawData,
      });
    }
    return;
  }

  const subtotal = safeFloat(norm["subtotal"]);
  const taxSubtotal = safeFloat(norm["tax (subtotal)"]);
  const commission = Math.abs(safeFloat(norm["commission"]));
  const merchantFees = Math.abs(safeFloat(norm["merchant fees"]));
  const customerFees = safeFloat(norm["customer fees"]);
  const taxCustomerFees = safeFloat(norm["tax (customer fees)"]);
  const marketingFees = Math.abs(safeFloat(norm["marketing fees"]));
  const customerDiscounts = Math.abs(safeFloat(norm["customer discounts"]));
  const ddMarketingCredit = safeFloat(norm["doordash marketing credit"]);
  const thirdPartyContribution = safeFloat(
    norm["third-party contribution"] || norm["third party contribution"]
  );
  const errorCharges = safeFloat(norm["error charges"]);
  const adjustments = safeFloat(norm["adjustments"]);
  const netTotal = safeFloat(norm["net total"]);

  result.platformOrders.push({
    orderId: orderId || `dd-${date.getTime()}-${result.rowsProcessed}`,
    platform: "doordash",
    orderDatetime: date,
    subtotal,
    tax: taxSubtotal,
    deliveryFee: 0,
    serviceFee: merchantFees,
    commissionFee: commission,
    tip: 0,
    netPayout: netTotal,
    discounts: customerDiscounts,
    channel,
    customerFees: customerFees + taxCustomerFees,
    marketingFees: marketingFees - ddMarketingCredit, // Net marketing cost
    adjustments: errorCharges + adjustments + thirdPartyContribution,
    platformPayoutId: norm["payout id"] || undefined,
    rawData,
  });

  const grossRevenue = subtotal + taxSubtotal;
  if (grossRevenue > 0) {
    result.transactions.push({
      date,
      amount: grossRevenue,
      type: "income",
      sourcePlatform: "doordash",
      category: "delivery_sales",
      description: `DoorDash order ${orderId}`,
      rawSourceId: orderId,
      rawData,
    });
  }

  const totalFees = commission + merchantFees + marketingFees;
  if (totalFees > 0) {
    result.transactions.push({
      date,
      amount: totalFees,
      type: "fee",
      sourcePlatform: "doordash",
      category: "commission",
      description: `DoorDash fees on ${orderId}`,
      rawSourceId: orderId,
      rawData,
    });
  }

  if (customerDiscounts > 0) {
    result.transactions.push({
      date,
      amount: customerDiscounts,
      type: "expense",
      sourcePlatform: "doordash",
      category: "promotion",
      description: `DoorDash merchant discount ${orderId}`,
      rawSourceId: orderId,
      rawData,
    });
  }

  // Track DoorDash marketing credits as a separate transaction if present
  if (ddMarketingCredit > 0) {
    result.transactions.push({
      date,
      amount: ddMarketingCredit,
      type: "income",
      sourcePlatform: "doordash",
      category: "marketing_credit",
      description: `DoorDash marketing credit on ${orderId}`,
      rawSourceId: orderId,
      rawData,
    });
  }

  // Track error charges/adjustments if non-zero
  if (errorCharges !== 0) {
    result.transactions.push({
      date,
      amount: Math.abs(errorCharges),
      type: errorCharges < 0 ? "expense" : "income",
      sourcePlatform: "doordash",
      category: "adjustment",
      description: `DoorDash error charge on ${orderId}`,
      rawSourceId: orderId,
      rawData,
    });
  }

  if (adjustments !== 0) {
    result.transactions.push({
      date,
      amount: Math.abs(adjustments),
      type: adjustments < 0 ? "expense" : "income",
      sourcePlatform: "doordash",
      category: "adjustment",
      description: `DoorDash adjustment on ${orderId}`,
      rawSourceId: orderId,
      rawData,
    });
  }
}

function parsePayoutSummaryRow(
  norm: Record<string, string>,
  rawData: string,
  result: ParseResult
) {
  const date = parseDate(norm["payout date"]);
  if (!date) {
    result.errors.push(`Row ${result.rowsProcessed}: Invalid payout date`);
    return;
  }

  const subtotal = safeFloat(norm["subtotal"]);
  const taxPassed = safeFloat(norm["subtotal tax passed to merchant"]);
  const commission = Math.abs(safeFloat(norm["commission"]));
  const processingFee = Math.abs(safeFloat(norm["payment processing fee"]));
  const tabletFee = Math.abs(safeFloat(norm["tablet fee"]));
  const netTotal = safeFloat(norm["net total"]);
  const payoutId = norm["payout id"] || "";
  const channel = norm["channel"] || "";

  const totalFees = commission + processingFee + tabletFee;

  result.payouts.push({
    platform: "doordash",
    payoutDate: date,
    grossAmount: subtotal + taxPassed,
    fees: totalFees,
    netAmount: netTotal,
    platformPayoutId: payoutId || undefined,
    rawData,
  });

  result.transactions.push({
    date,
    amount: netTotal,
    type: "payout",
    sourcePlatform: "doordash",
    category: "payout",
    description: `DoorDash payout ${channel} (${payoutId})`,
    rawSourceId: payoutId,
    rawData,
  });
}

function normalizeKeys(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.toLowerCase().trim()] = v;
  }
  return out;
}
