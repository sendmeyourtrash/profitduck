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
import { queryBank, queryBankAccounts, queryBankCategories, queryBankVendors, resolveVendorCategory, updateTransactionCustomName, bulkUpdateTransactionCustomName, getAllCategoryIgnores } from "@/lib/db/bank-db";

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

    // Get ignored category names
    const ignoredCats = getAllCategoryIgnores();
    const ignoredCatNames = new Set(ignoredCats.map((ic) => ic.category_name.toLowerCase()));

    // Transform to match frontend shape (uses vendor aliases for display_name)
    // Tag each transaction as ignored if its resolved category is in the ignored list
    const transactions = records.map((r) => {
      const displayName = (r as any).display_name || r.custom_name || r.name || r.description;
      const resolvedCategory = resolveVendorCategory(displayName);
      const ignored = resolvedCategory ? ignoredCatNames.has(resolvedCategory.toLowerCase()) : false;

      return {
        id: String(r.id),
        date: r.date,
        description: displayName,
        rawDescription: r.description || r.name || "",
        originalName: r.name || r.description,
        customName: r.custom_name || null,
        amount: r.amount,
        category: resolvedCategory || r.category,
        accountName: r.display_account,
        accountType: r.account_type,
        institutionName: r.institution_name,
        taxDeductible: r.tax_deductible === "TRUE" || r.tax_deductible === "true",
        tags: r.transaction_tags,
        source: r.source,
        note: r.note,
        type: r.amount < 0 ? "deposit" : "expense",
        ignored,
      };
    });

    // Compute summary excluding ignored transactions across ALL matching records
    // We fetch all matching records (no pagination) to compute accurate totals
    const allForSummary = queryBank({
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      accounts: accounts.length > 0 ? accounts : undefined,
      categories: categories.length > 0 ? categories : undefined,
      vendors: vendors.length > 0 ? vendors : undefined,
      search: search || undefined,
      limit: 999999,
      offset: 0,
    });

    let activeDeposits = 0;
    let activeDepositsCount = 0;
    let activeExpenses = 0;
    let activeExpensesCount = 0;

    for (const r of allForSummary.records) {
      const displayName = (r as any).display_name || r.custom_name || r.name || r.description;
      const resolvedCategory = resolveVendorCategory(displayName);
      const isIgnored = resolvedCategory ? ignoredCatNames.has(resolvedCategory.toLowerCase()) : false;
      if (isIgnored) continue;
      if (r.amount < 0) {
        activeDeposits += Math.abs(r.amount);
        activeDepositsCount++;
      } else if (r.amount > 0) {
        activeExpenses += r.amount;
        activeExpensesCount++;
      }
    }

    const availableAccounts = queryBankAccounts();
    const availableCategories = queryBankCategories();
    const availableVendors = queryBankVendors();

    return NextResponse.json({
      transactions,
      total,
      limit,
      offset,
      summary: {
        deposits: Math.round(activeDeposits * 100) / 100,
        depositsCount: activeDepositsCount,
        expenses: Math.round(activeExpenses * 100) / 100,
        expensesCount: activeExpensesCount,
        net: Math.round((activeExpenses - activeDeposits) * 100) / 100,
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

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ids, customName } = body;

    if (typeof customName !== "string" || !customName.trim()) {
      return NextResponse.json({ error: "customName is required" }, { status: 400 });
    }

    if (ids && Array.isArray(ids) && ids.length > 0) {
      bulkUpdateTransactionCustomName(ids.map(Number), customName.trim());
      return NextResponse.json({ updated: ids.length });
    }

    if (id) {
      updateTransactionCustomName(Number(id), customName.trim());
      return NextResponse.json({ updated: 1 });
    }

    return NextResponse.json({ error: "id or ids required" }, { status: 400 });
  } catch (error) {
    console.error("Bank activity rename error:", error);
    return NextResponse.json(
      { error: "Failed to rename transaction", detail: String(error) },
      { status: 500 },
    );
  }
}
