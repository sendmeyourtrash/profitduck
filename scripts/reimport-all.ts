/**
 * Script to wipe all imported data and re-import everything
 * with the enriched parsers that capture all available fields.
 *
 * Run with: npx tsx scripts/reimport-all.ts
 */
import { prisma } from "../src/lib/db/prisma";
import { ingestFile } from "../src/lib/services/ingestion";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "Data Exports");

// Files to import in order
const IMPORT_FILES: { file: string; source?: string; subdir?: string }[] = [
  // Square
  { file: "SquareUp items-2023-08-01-2026-03-13.csv", source: "square" },
  // Grubhub (3 files covering different date ranges)
  { file: "Aug_23_-_July_24.csv", source: "grubhub" },
  { file: "Aug_24_-_July_25.csv", source: "grubhub" },
  { file: "Aug_25_-_Mar_12_26.csv", source: "grubhub" },
  // DoorDash
  {
    file: "FINANCIAL_SIMPLIFIED_TRANSACTIONS_2025-12-12_2026-03-11_HQVnr_2026-03-13T01-08-35Z.csv",
    source: "doordash",
    subdir:
      "DoorDash financial_2025-12-12_2026-03-11_HQVnr_2026-03-13T01-08-35Z",
  },
  {
    file: "FINANCIAL_PAYOUT_SUMMARY_2025-12-12_2026-03-11_HQVnr_2026-03-13T01-08-35Z.csv",
    source: "doordash",
    subdir:
      "DoorDash financial_2025-12-12_2026-03-11_HQVnr_2026-03-13T01-08-35Z",
  },
  // UberEats
  { file: "Uber Eats.csv", source: "ubereats" },
  // Rocket Money
  {
    file: "Rocket Money 2026-03-13T01_00_34.116Z-transactions.csv",
    source: "rocketmoney",
  },
];

async function main() {
  console.log("=== Full Data Re-Import with Enriched Parsers ===\n");

  // 1. Wipe all existing data (in dependency order)
  console.log("Clearing all existing data...");

  const auditDel = await prisma.auditLog.deleteMany();
  console.log(`  Audit logs: ${auditDel.count} deleted`);

  const alertDel = await prisma.reconciliationAlert.deleteMany();
  console.log(`  Reconciliation alerts: ${alertDel.count} deleted`);

  const txDel = await prisma.transaction.deleteMany();
  console.log(`  Transactions: ${txDel.count} deleted`);

  const orderDel = await prisma.platformOrder.deleteMany();
  console.log(`  Platform orders: ${orderDel.count} deleted`);

  const expDel = await prisma.expense.deleteMany();
  console.log(`  Expenses: ${expDel.count} deleted`);

  const payDel = await prisma.payout.deleteMany();
  console.log(`  Payouts: ${payDel.count} deleted`);

  const btDel = await prisma.bankTransaction.deleteMany();
  console.log(`  Bank transactions: ${btDel.count} deleted`);

  const vendorDel = await prisma.vendor.deleteMany();
  console.log(`  Vendors: ${vendorDel.count} deleted`);

  const catRuleDel = await prisma.categorizationRule.deleteMany();
  console.log(`  Categorization rules: ${catRuleDel.count} deleted`);

  const catDel = await prisma.expenseCategory.deleteMany();
  console.log(`  Expense categories: ${catDel.count} deleted`);

  const importDel = await prisma.import.deleteMany();
  console.log(`  Import records: ${importDel.count} deleted`);

  console.log("\n  All data cleared.\n");

  // 2. Import each file
  const results: {
    file: string;
    source: string;
    transactions: number;
    platformOrders: number;
    bankTransactions: number;
    expenses: number;
    payouts: number;
    errors: number;
    skipped: number;
  }[] = [];

  for (const entry of IMPORT_FILES) {
    const filePath = entry.subdir
      ? path.join(DATA_DIR, entry.subdir, entry.file)
      : path.join(DATA_DIR, entry.file);

    if (!fs.existsSync(filePath)) {
      console.log(`⚠ SKIP: ${entry.file} — file not found at ${filePath}`);
      continue;
    }

    console.log(`Importing: ${entry.file} (${entry.source || "auto-detect"})...`);

    try {
      const result = await ingestFile(
        filePath,
        entry.file,
        entry.source as any,
        { skipFileDedup: false, skipRowDedup: false }
      );

      if (result.duplicate?.isDuplicate) {
        console.log(`  → Duplicate of existing import, skipped.`);
        results.push({
          file: entry.file,
          source: entry.source || "auto",
          transactions: 0,
          platformOrders: 0,
          bankTransactions: 0,
          expenses: 0,
          payouts: 0,
          errors: 0,
          skipped: 0,
        });
        continue;
      }

      const s = result.summary;
      console.log(
        `  → ${s.rowsProcessed} rows | ` +
          `${s.transactions} txns, ${s.platformOrders} orders, ` +
          `${s.bankTransactions} bank txns, ${s.expenses} expenses, ` +
          `${s.payouts} payouts | ` +
          `${s.errors.length} errors, ${s.rowsSkipped} skipped`
      );

      if (s.errors.length > 0) {
        console.log(`  Errors (first 5):`);
        s.errors.slice(0, 5).forEach((e) => console.log(`    - ${e}`));
      }

      results.push({
        file: entry.file,
        source: entry.source || "auto",
        transactions: s.transactions,
        platformOrders: s.platformOrders,
        bankTransactions: s.bankTransactions,
        expenses: s.expenses,
        payouts: s.payouts,
        errors: s.errors.length,
        skipped: s.rowsSkipped,
      });
    } catch (error) {
      console.log(
        `  ✗ ERROR: ${error instanceof Error ? error.message : "Unknown"}`
      );
      results.push({
        file: entry.file,
        source: entry.source || "auto",
        transactions: 0,
        platformOrders: 0,
        bankTransactions: 0,
        expenses: 0,
        payouts: 0,
        errors: 1,
        skipped: 0,
      });
    }
  }

  // 3. Summary
  console.log("\n=== Import Summary ===\n");

  const totals = results.reduce(
    (acc, r) => ({
      transactions: acc.transactions + r.transactions,
      platformOrders: acc.platformOrders + r.platformOrders,
      bankTransactions: acc.bankTransactions + r.bankTransactions,
      expenses: acc.expenses + r.expenses,
      payouts: acc.payouts + r.payouts,
      errors: acc.errors + r.errors,
      skipped: acc.skipped + r.skipped,
    }),
    {
      transactions: 0,
      platformOrders: 0,
      bankTransactions: 0,
      expenses: 0,
      payouts: 0,
      errors: 0,
      skipped: 0,
    }
  );

  console.log(`Total transactions: ${totals.transactions}`);
  console.log(`Total platform orders: ${totals.platformOrders}`);
  console.log(`Total bank transactions: ${totals.bankTransactions}`);
  console.log(`Total expenses: ${totals.expenses}`);
  console.log(`Total payouts: ${totals.payouts}`);
  console.log(`Total errors: ${totals.errors}`);
  console.log(`Total skipped (dedup): ${totals.skipped}`);

  // 4. Verification queries
  console.log("\n=== Verification ===\n");

  const totalRevenue = await prisma.transaction.aggregate({
    where: { type: "income" },
    _sum: { amount: true },
  });
  console.log(
    `Total revenue (all platforms): $${(totalRevenue._sum.amount || 0).toFixed(2)}`
  );

  const revenueByPlatform = await prisma.transaction.groupBy({
    by: ["sourcePlatform"],
    where: { type: "income" },
    _sum: { amount: true },
    _count: true,
  });
  console.log("Revenue by platform:");
  for (const p of revenueByPlatform) {
    console.log(
      `  ${p.sourcePlatform}: $${(p._sum.amount || 0).toFixed(2)} (${p._count} txns)`
    );
  }

  const totalFees = await prisma.transaction.aggregate({
    where: { type: "fee" },
    _sum: { amount: true },
  });
  console.log(
    `\nTotal fees: $${(totalFees._sum.amount || 0).toFixed(2)}`
  );

  const totalExpenses = await prisma.transaction.aggregate({
    where: {
      type: "expense",
      NOT: { category: { startsWith: "personal:" } },
    },
    _sum: { amount: true },
  });
  console.log(
    `Total business expenses: $${(totalExpenses._sum.amount || 0).toFixed(2)}`
  );

  const personalExpenses = await prisma.transaction.aggregate({
    where: { type: "expense", category: { startsWith: "personal:" } },
    _sum: { amount: true },
  });
  console.log(
    `Total personal expenses: $${(personalExpenses._sum.amount || 0).toFixed(2)}`
  );

  // Check new fields are populated
  console.log("\n=== New Fields Verification ===\n");

  const ordersWithCategory = await prisma.platformOrder.count({
    where: { itemCategory: { not: null } },
  });
  console.log(`Platform orders with itemCategory: ${ordersWithCategory}`);

  const ordersWithDiningOption = await prisma.platformOrder.count({
    where: { diningOption: { not: null } },
  });
  console.log(
    `Platform orders with diningOption: ${ordersWithDiningOption}`
  );

  const ordersWithCardBrand = await prisma.platformOrder.count({
    where: { cardBrand: { not: null } },
  });
  console.log(`Platform orders with cardBrand: ${ordersWithCardBrand}`);

  const ordersWithChannel = await prisma.platformOrder.count({
    where: { channel: { not: null } },
  });
  console.log(`Platform orders with channel: ${ordersWithChannel}`);

  const ordersWithDiscounts = await prisma.platformOrder.count({
    where: { discounts: { gt: 0 } },
  });
  console.log(`Platform orders with discounts > 0: ${ordersWithDiscounts}`);

  const btWithAccountType = await prisma.bankTransaction.count({
    where: { accountType: { not: null } },
  });
  console.log(`Bank transactions with accountType: ${btWithAccountType}`);

  const btWithInstitution = await prisma.bankTransaction.count({
    where: { institutionName: { not: null } },
  });
  console.log(
    `Bank transactions with institutionName: ${btWithInstitution}`
  );

  const btWithTags = await prisma.bankTransaction.count({
    where: { tags: { not: null } },
  });
  console.log(`Bank transactions with tags: ${btWithTags}`);

  const btTaxDeductible = await prisma.bankTransaction.count({
    where: { taxDeductible: true },
  });
  console.log(`Bank transactions marked tax deductible: ${btTaxDeductible}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
