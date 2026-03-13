/**
 * Script to clear old Rocket Money data and re-import with the fixed parser.
 * Run with: npx tsx scripts/reimport-rocketmoney.ts
 */
import { prisma } from "../src/lib/db/prisma";
import { ingestFile } from "../src/lib/services/ingestion";
import path from "path";

async function main() {
  console.log("=== Rocket Money Re-Import ===\n");

  // 1. Find existing Rocket Money imports
  const rmImports = await prisma.import.findMany({
    where: { source: "rocketmoney" },
  });

  if (rmImports.length > 0) {
    console.log(`Found ${rmImports.length} existing Rocket Money import(s). Clearing...`);

    for (const imp of rmImports) {
      const importId = imp.id;

      // Delete related records
      const txDel = await prisma.transaction.deleteMany({ where: { importId } });
      const expDel = await prisma.expense.deleteMany({ where: { importId } });
      const btDel = await prisma.bankTransaction.deleteMany({ where: { importId } });
      const payDel = await prisma.payout.deleteMany({ where: { importId } });

      console.log(`  Import ${importId}: deleted ${txDel.count} transactions, ${expDel.count} expenses, ${btDel.count} bank txns, ${payDel.count} payouts`);

      // Delete the import record itself
      await prisma.import.delete({ where: { id: importId } });
    }

    // Clean up orphaned vendors (vendors with no expenses)
    const orphanedVendors = await prisma.vendor.findMany({
      where: {
        expenses: { none: {} },
      },
    });
    if (orphanedVendors.length > 0) {
      await prisma.vendor.deleteMany({
        where: { id: { in: orphanedVendors.map((v) => v.id) } },
      });
      console.log(`  Cleaned up ${orphanedVendors.length} orphaned vendors`);
    }

    console.log("  Old data cleared.\n");
  } else {
    console.log("No existing Rocket Money imports found.\n");
  }

  // 2. Re-import the Rocket Money CSV
  const csvPath = path.join(
    process.cwd(),
    "Data Exports",
    "Rocket Money 2026-03-13T01_00_34.116Z-transactions.csv"
  );
  const csvFileName = "Rocket Money 2026-03-13T01_00_34.116Z-transactions.csv";

  console.log(`Re-importing: ${csvFileName}`);
  const result = await ingestFile(csvPath, csvFileName, "rocketmoney");

  console.log("\n=== Import Results ===");
  console.log(`  Rows processed: ${result.summary.rowsProcessed}`);
  console.log(`  Transactions: ${result.summary.transactions}`);
  console.log(`  Platform orders: ${result.summary.platformOrders}`);
  console.log(`  Bank transactions: ${result.summary.bankTransactions}`);
  console.log(`  Expenses: ${result.summary.expenses}`);
  console.log(`  Payouts: ${result.summary.payouts}`);
  console.log(`  Errors: ${result.summary.errors.length}`);
  if (result.summary.errors.length > 0) {
    console.log("  Error details:");
    result.summary.errors.slice(0, 10).forEach((e) => console.log(`    - ${e}`));
  }

  // 3. Quick verification — show totals
  console.log("\n=== Verification ===");

  const totalRevenue = await prisma.transaction.aggregate({
    where: { type: "income" },
    _sum: { amount: true },
  });
  console.log(`  Total revenue (all platforms): $${(totalRevenue._sum.amount || 0).toFixed(2)}`);

  const revenueByPlatform = await prisma.transaction.groupBy({
    by: ["sourcePlatform"],
    where: { type: "income" },
    _sum: { amount: true },
    _count: true,
  });
  console.log("  Revenue by platform:");
  for (const p of revenueByPlatform) {
    console.log(`    ${p.sourcePlatform}: $${(p._sum.amount || 0).toFixed(2)} (${p._count} txns)`);
  }

  const totalExpenses = await prisma.transaction.aggregate({
    where: { type: "expense", NOT: { category: { startsWith: "personal:" } } },
    _sum: { amount: true },
  });
  console.log(`  Total business expenses: $${(totalExpenses._sum.amount || 0).toFixed(2)}`);

  const personalExpenses = await prisma.transaction.aggregate({
    where: { type: "expense", category: { startsWith: "personal:" } },
    _sum: { amount: true },
  });
  console.log(`  Total personal expenses: $${(personalExpenses._sum.amount || 0).toFixed(2)}`);

  const rmBankTxns = await prisma.bankTransaction.aggregate({
    where: { importId: result.import!.id },
    _sum: { amount: true },
    _count: true,
  });
  console.log(`  Rocket Money bank transactions (payouts): ${rmBankTxns._count} totaling $${(rmBankTxns._sum.amount || 0).toFixed(2)}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
