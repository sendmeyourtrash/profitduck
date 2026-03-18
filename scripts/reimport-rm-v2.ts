/**
 * Reimport Rocket Money data with explicit error handling.
 */
import { prisma } from "../src/lib/db/prisma";
import { rocketmoneyParser } from "../src/lib/parsers/rocketmoney";
import { readFile } from "../src/lib/services/file-reader";

async function main() {
  // 1. Parse the CSV
  const { rows } = readFile(
    "./Data Exports/Rocket Money/Rocket Money 2026-03-13T01_00_34.116Z-transactions.csv"
  );
  const result = rocketmoneyParser.parse(rows);
  console.log(`Parsed: ${result.transactions.length} txns, ${result.bankTransactions.length} bank, ${result.expenses.length} expenses`);

  // 2. Create import record
  const imp = await prisma.import.create({
    data: {
      source: "rocketmoney",
      fileName: "Rocket Money 2026-03-13T01_00_34.116Z-transactions.csv",
      fileHash: "reimport-" + Date.now(),
      rowsProcessed: result.rowsProcessed,
    },
  });
  console.log(`Import ID: ${imp.id}`);

  // 3. Store transactions in batches (no $transaction wrapper to avoid timeout)
  let txCount = 0;
  for (const t of result.transactions) {
    await prisma.transaction.create({
      data: {
        date: t.date,
        amount: t.amount,
        type: t.type,
        sourcePlatform: t.sourcePlatform,
        category: t.category || null,
        description: t.description || null,
        rawData: t.rawData,
        importId: imp.id,
      },
    });
    txCount++;
    if (txCount % 200 === 0) console.log(`  Transactions: ${txCount}/${result.transactions.length}`);
  }
  console.log(`Stored ${txCount} transactions`);

  // 4. Store bank transactions
  let btCount = 0;
  for (const bt of result.bankTransactions) {
    await prisma.bankTransaction.create({
      data: {
        date: bt.date,
        description: bt.description,
        amount: bt.amount,
        category: bt.category || null,
        rawData: bt.rawData,
        accountType: bt.accountType || null,
        accountName: bt.accountName || null,
        institutionName: bt.institutionName || null,
        taxDeductible: bt.taxDeductible || false,
        tags: bt.tags || null,
        importId: imp.id,
      },
    });
    btCount++;
    if (btCount % 200 === 0) console.log(`  Bank txns: ${btCount}/${result.bankTransactions.length}`);
  }
  console.log(`Stored ${btCount} bank transactions`);

  // 5. Store expenses (need vendor resolution)
  let expCount = 0;
  for (const exp of result.expenses) {
    let vendor = await prisma.vendor.findFirst({
      where: { name: exp.vendorName },
    });
    if (!vendor) {
      vendor = await prisma.vendor.create({
        data: { name: exp.vendorName },
      });
    }
    await prisma.expense.create({
      data: {
        vendorId: vendor.id,
        amount: exp.amount,
        date: exp.date,
        category: exp.category || null,
        paymentMethod: exp.paymentMethod || null,
        notes: exp.notes || null,
        rawData: exp.rawData,
        importId: imp.id,
      },
    });
    expCount++;
    if (expCount % 200 === 0) console.log(`  Expenses: ${expCount}/${result.expenses.length}`);
  }
  console.log(`Stored ${expCount} expenses`);

  console.log("\n=== Done ===");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
