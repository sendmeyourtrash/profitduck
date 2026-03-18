/**
 * Bank Activity API — Data source for the Bank Activity page.
 *
 * Reads from databases/bank.db (Rocket Money + Chase statements).
 *
 * Rocket Money tracks all bank activity:
 *   - Deposits (negative amounts in RM = money coming in)
 *   - Expenses (positive amounts = money going out)
 *   - CC payments, transfers, etc.
 *
 * @see PIPELINE.md for database architecture
 */
import { NextRequest, NextResponse } from "next/server";
import { queryBank, queryBankAccounts, queryBankCategories, queryBankVendors } from "@/lib/db/bank-db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const accounts = searchParams.getAll("accounts");
  const categories = searchParams.getAll("categories");
  const vendors = searchParams.getAll("vendors");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const search = searchParams.get("search");
  const sortBy = searchParams.get("sortBy");
  const sortDir = (searchParams.get("sortDir") || "desc") as "asc" | "desc";
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    const { records, total, summary } = queryBank({
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      accounts: accounts.length > 0 ? accounts : undefined,
      categories: categories.length > 0 ? categories : undefined,
      vendors: vendors.length > 0 ? vendors : undefined,
      search: search || undefined,
      sortBy: sortBy || undefined,
      sortDir,
      limit,
      offset,
    });

    // Transform to match frontend shape (uses vendor aliases for display_name)
    const transactions = records.map((r) => ({
      id: String(r.id),
      date: r.date,
      description: (r as any).display_name || r.custom_name || r.name || r.description,
      rawDescription: r.custom_name || r.name || r.description,
      amount: r.amount,
      category: r.category,
      accountName: r.display_account,
      accountType: r.account_type,
      institutionName: r.institution_name,
      taxDeductible: r.tax_deductible === "TRUE" || r.tax_deductible === "true",
      tags: r.transaction_tags,
      source: r.source,
      note: r.note,
      type: r.amount < 0 ? "deposit" : "expense",
    }));

    const availableAccounts = queryBankAccounts();
    const availableCategories = queryBankCategories();
    const availableVendors = queryBankVendors();

    return NextResponse.json({
      transactions,
      total,
      limit,
      offset,
      summary: {
        deposits: summary.total_deposits,
        depositsCount: summary.deposits_count,
        expenses: summary.total_expenses,
        expensesCount: summary.expenses_count,
        net: summary.net,
      },
      availableAccounts,
      availableCategories,
      availableVendors,
    });
  } catch (error) {
    console.error("Bank activity query error:", error);
    return NextResponse.json(
      { error: "Failed to query bank activity", detail: String(error) },
      { status: 500 },
    );
  }
}
