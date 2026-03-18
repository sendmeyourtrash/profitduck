import { rocketmoneyParser } from "../src/lib/parsers/rocketmoney";
import { readFile } from "../src/lib/services/file-reader";

const { headers, rows } = readFile(
  "./Data Exports/Rocket Money/Rocket Money 2026-03-13T01_00_34.116Z-transactions.csv"
);
console.log("Total rows:", rows.length);
console.log("Headers:", headers.slice(0, 5).join(", "), "...");

const result = rocketmoneyParser.parse(rows);
console.log("\nRows processed:", result.rowsProcessed);
console.log("Transactions:", result.transactions.length);
const byType: Record<string, number> = {};
result.transactions.forEach((t) => {
  byType[t.type] = (byType[t.type] || 0) + 1;
});
console.log("  by type:", JSON.stringify(byType));
console.log("Bank transactions:", result.bankTransactions.length);
console.log("Expenses:", result.expenses.length);
console.log("Errors:", result.errors.length);
