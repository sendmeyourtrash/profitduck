import { PlatformParser, ParseResult, emptyResult } from "./types";
import { safeFloat, parseDate } from "../utils/format";

/**
 * Parser for Rocket Money (formerly Truebill) transaction CSV exports.
 *
 * Real columns:
 * Date, Original Date, Account Type, Account Name, Account Number,
 * Institution Name, Name, Custom Name, Amount, Description,
 * Category, Note, Ignored From, Tax Deductible, Transaction Tags
 *
 * IMPORTANT: Rocket Money is a bank-level aggregator. It captures ALL
 * account activity — personal and business mixed. We must:
 *
 * 1. Create bank transactions for ALL entries (inflows AND outflows)
 *    so we have full cash flow visibility for reconciliation.
 *
 * 2. Identify platform payout deposits (Square, DoorDash, GrubHub,
 *    Uber Eats) and tag them as "payout" type for reconciliation
 *    rather than counting them as revenue.
 *
 * 3. Only create expense records for genuine business outflows
 *    that are NOT platform deposits.
 *
 * 4. Capture ALL Rocket Money fields: account type/name, institution,
 *    categories, tax deductible flags, tags.
 */

/**
 * Categories/names that indicate platform payout deposits into the bank.
 * These are already tracked as revenue via each platform's own parser,
 * so we must NOT count them as expenses.
 */
const PLATFORM_PAYOUT_PATTERNS = [
  "square",
  "doordash",
  "grubhub",
  "uber eats",
  "ubereats",
];

function isPlatformPayout(
  category: string,
  name: string,
  description: string
): string | null {
  const combined = `${category} ${name} ${description}`.toLowerCase();
  for (const pattern of PLATFORM_PAYOUT_PATTERNS) {
    if (combined.includes(pattern)) return pattern;
  }
  return null;
}

/**
 * Categories that are almost certainly NOT operating expenses.
 * Credit card payments are just transfers between accounts (not real expenses).
 * Funding/transfers are internal money movements.
 * Everything else (rent, salary, insurance, taxes, utilities) are real
 * business costs for a restaurant and SHOULD be tracked as expenses.
 */
const TRANSFER_CATEGORIES = new Set([
  "credit card payment",
  "funding",
]);

/**
 * Known expense categories in Rocket Money exports.
 * Rocket Money sometimes stores outflows (debits) as positive amounts.
 * When we see a positive amount with one of these categories, it's still
 * an expense and should be treated as an outflow.
 */
const EXPENSE_CATEGORIES = new Set([
  "ads",
  "auto & transport",
  "bills & utilities",
  "construction",
  "dining & drinks",
  "fees",
  "groceries",
  "home & garden",
  "insurance",
  "permits",
  "rent",
  "salary",
  "security",
  "shopping",
  "software & tech",
  "taxes",
]);

export const rocketmoneyParser: PlatformParser = {
  source: "rocketmoney",

  detect(fileName: string, headers: string[]): number {
    const nameLower = fileName.toLowerCase();
    if (
      nameLower.includes("rocket") ||
      nameLower.includes("truebill") ||
      nameLower.includes("rocketmoney")
    )
      return 0.9;

    const rmHeaders = [
      "original date",
      "account type",
      "account name",
      "institution name",
      "custom name",
      "ignored from",
      "tax deductible",
      "transaction tags",
    ];

    const headerLower = headers.map((h) => h.toLowerCase().trim());
    const matches = rmHeaders.filter((rh) =>
      headerLower.some((h) => h === rh)
    );

    if (matches.length >= 4) return 0.9;
    if (matches.length >= 2) return 0.6;
    return 0;
  },

  parse(rows: Record<string, string>[]): ParseResult {
    const result = emptyResult();

    for (const row of rows) {
      try {
        result.rowsProcessed++;
        const rawData = JSON.stringify(row);
        const norm = normalizeKeys(row);

        const date = parseDate(norm["date"] || norm["original date"]);
        if (!date) {
          result.errors.push(`Row ${result.rowsProcessed}: Invalid date`);
          continue;
        }

        const name = (norm["custom name"] || norm["name"] || "").trim();
        const amount = safeFloat(norm["amount"]);
        const category = (norm["category"] || "").trim();
        const accountType = (norm["account type"] || "").trim() || undefined;
        const accountName = (norm["account name"] || "").trim() || undefined;
        const institutionName =
          (norm["institution name"] || "").trim() || undefined;
        const note = (norm["note"] || "").trim();
        const description = (norm["description"] || "").trim();
        const taxDeductibleRaw = (
          norm["tax deductible"] || ""
        )
          .trim()
          .toLowerCase();
        const taxDeductible =
          taxDeductibleRaw === "true" ||
          taxDeductibleRaw === "yes" ||
          taxDeductibleRaw === "1";
        const tags = (norm["transaction tags"] || "").trim() || undefined;

        // Skip ignored transactions
        const ignoredFrom = (norm["ignored from"] || "").trim();
        if (ignoredFrom) continue;

        // Skip zero-amount transactions
        if (amount === 0) continue;

        const isOutflow = amount < 0;
        const absAmount = Math.abs(amount);
        const vendorName = name || description.slice(0, 50) || "Unknown";
        const paymentMethod = [institutionName, accountName]
          .filter(Boolean)
          .join(" - ");
        const isTransfer = TRANSFER_CATEGORIES.has(category.toLowerCase());

        // --- INFLOWS (positive amounts) ---
        // Rocket Money sometimes stores outflows (debits) as positive amounts.
        // Check if a known expense category indicates this is actually an expense.
        if (!isOutflow) {
          const payoutPlatform = isPlatformPayout(category, name, description);
          const isExpenseCategory = EXPENSE_CATEGORIES.has(category.toLowerCase());

          if (isExpenseCategory && !payoutPlatform && !isTransfer) {
            // Positive amount but expense category — treat as outflow
            result.bankTransactions.push({
              date,
              description: `${category ? category + " - " : ""}${vendorName}`,
              amount: -absAmount, // Negative for outflows
              category: category || undefined,
              rawData,
              accountType,
              accountName,
              institutionName,
              taxDeductible,
              tags,
            });

            result.expenses.push({
              vendorName,
              amount: absAmount,
              date,
              category: category || undefined,
              paymentMethod,
              notes: note || undefined,
              rawData,
            });

            result.transactions.push({
              date,
              amount: absAmount,
              type: "expense",
              sourcePlatform: "rocketmoney",
              category: category || "expense",
              description: vendorName,
              rawData,
            });
          } else {
            result.bankTransactions.push({
              date,
              description: `${category ? category + " - " : ""}${vendorName}`,
              amount: absAmount, // Store as positive for reconciliation matching
              category: payoutPlatform || category || undefined,
              rawData,
              accountType,
              accountName,
              institutionName,
              taxDeductible,
              tags,
            });
          }

          continue;
        }

        // --- NEGATIVE AMOUNTS ---
        // On credit cards: negative = refund/return/credit (money back)
        // On checking: negative is normally a debit, but in practice the
        // negative entries that reach here are also credits (fee reversals,
        // Zelle incoming, verification micro-deposits, insurance refunds).
        // We detect refunds and store them as negative expenses so they
        // naturally offset the original charge in SUMs.

        const isCreditCard =
          accountType?.toLowerCase().includes("credit card") || false;

        // Check if this looks like a refund/credit rather than a real expense
        const lowerName = vendorName.toLowerCase();
        const lowerDesc = description.toLowerCase();
        const isRefundLike =
          isCreditCard || // All credit card negatives are refunds/returns
          lowerName.includes("reversal") ||
          lowerName.includes("refund") ||
          lowerDesc.includes("reversal") ||
          lowerDesc.includes("refund") ||
          lowerName.includes("penny test") ||
          lowerName.includes("acctverify") ||
          lowerName.startsWith("zelle payment from");

        // Check if this is a platform payout deposit (Square, DD, GH, UE)
        const payoutPlatform = isPlatformPayout(category, name, description);
        if (payoutPlatform) {
          // This is money coming IN from a delivery platform or POS.
          // Already tracked as revenue via the platform's own parser.
          // Record as a bank-side transaction for reconciliation purposes.
          result.bankTransactions.push({
            date,
            description: `${category} - ${vendorName}`,
            amount: absAmount, // Store as positive for reconciliation matching
            category: payoutPlatform,
            rawData,
            accountType,
            accountName,
            institutionName,
            taxDeductible,
            tags,
          });
          continue;
        }

        // Create a bank transaction for ALL outflows (for full cash flow picture)
        result.bankTransactions.push({
          date,
          description: `${category ? category + " - " : ""}${vendorName}`,
          amount: isRefundLike ? absAmount : -absAmount,
          category: category || undefined,
          rawData,
          accountType,
          accountName,
          institutionName,
          taxDeductible,
          tags,
        });

        // Determine transaction category
        const txCategory = isTransfer
          ? `transfer:${category.toLowerCase()}`
          : category || "expense";

        // Create expense record for all real expenses (not transfers)
        if (!isTransfer) {
          result.expenses.push({
            vendorName,
            amount: isRefundLike ? -absAmount : absAmount,
            date,
            category: category || undefined,
            paymentMethod,
            notes: note || undefined,
            rawData,
          });
        }

        result.transactions.push({
          date,
          amount: isRefundLike ? -absAmount : absAmount,
          type: "expense",
          sourcePlatform: "rocketmoney",
          category: txCategory,
          description: vendorName,
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
