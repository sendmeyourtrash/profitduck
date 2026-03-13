import { PlatformParser, ParseResult, emptyResult } from "./types";
import { safeFloat, parseDate } from "../utils/format";

/**
 * Parser for Chase Bank CSV transaction exports.
 *
 * Typical Chase checking CSV columns:
 * Details, Posting Date, Description, Amount, Type, Balance, Check or Slip #
 *
 * Chase credit card CSV columns:
 * Transaction Date, Post Date, Description, Category, Type, Amount, Memo
 */
export const chaseParser: PlatformParser = {
  source: "chase",

  detect(fileName: string, headers: string[]): number {
    const nameLower = fileName.toLowerCase();
    if (nameLower.includes("chase")) return 0.9;

    const chaseHeaders = [
      "posting date",
      "post date",
      "details",
      "check or slip",
      "balance",
    ];

    const headerLower = headers.map((h) => h.toLowerCase().trim());
    const matches = chaseHeaders.filter((ch) =>
      headerLower.some((h) => h.includes(ch))
    );

    // Chase CSVs almost always have "Posting Date" or "Post Date" and "Details"
    if (matches.length >= 2) return 0.8;
    if (matches.length >= 1 && nameLower.includes("bank")) return 0.6;
    return 0;
  },

  parse(rows: Record<string, string>[]): ParseResult {
    const result = emptyResult();

    // Detect if this is a credit card export (has "Category" column)
    const firstRow = rows[0] ? normalizeKeys(rows[0]) : {};
    const isCreditCard = "category" in firstRow && "memo" in firstRow;
    const isChecking = "details" in firstRow || "balance" in firstRow;

    for (const row of rows) {
      try {
        result.rowsProcessed++;
        const rawData = JSON.stringify(row);
        const norm = normalizeKeys(row);

        const date = parseDate(
          norm["posting date"] || norm["post date"] || norm["transaction date"]
        );
        if (!date) {
          result.errors.push(`Row ${result.rowsProcessed}: Invalid date`);
          continue;
        }

        const description = (norm["description"] || "").trim();
        const amount = safeFloat(norm["amount"]);
        const category = (norm["category"] || "").trim();
        const type = (norm["type"] || "").trim();
        const memo = (norm["memo"] || norm["note"] || "").trim();
        const details = (norm["details"] || "").trim();
        const checkOrSlip = (norm["check or slip #"] || "").trim();

        // Determine account type from context
        const accountType = isCreditCard
          ? "Credit Card"
          : isChecking
            ? "Checking"
            : undefined;

        // Build a richer description including memo and type info
        const fullDescription = [
          description,
          memo ? `(${memo})` : "",
          details && details !== "DEBIT" && details !== "CREDIT"
            ? `[${details}]`
            : "",
        ]
          .filter(Boolean)
          .join(" ");

        result.bankTransactions.push({
          date,
          description: fullDescription || description,
          amount,
          category: category || type || undefined,
          rawData,
          accountType,
          institutionName: "Chase",
        });

        // Also create a transaction record
        const isCredit = amount > 0;
        result.transactions.push({
          date,
          amount: Math.abs(amount),
          type: isCredit ? "income" : "expense",
          sourcePlatform: "chase",
          category: category || type || (isCredit ? "deposit" : "expense"),
          description: fullDescription || description,
          rawSourceId: checkOrSlip || undefined,
          rawData,
        });
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
