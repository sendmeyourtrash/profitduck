/**
 * Seed script: Import all data files from the Data Exports folder.
 *
 * Usage: npx tsx scripts/seed.ts
 */
import { resolve, basename } from "path";
import { readdirSync, statSync } from "fs";

const DATA_DIR = resolve(__dirname, "../Data Exports");

// Dynamically import the ingestion service (ESM)
async function main() {
  // We need to set up Prisma adapter before importing
  const { ingestFile } = await import("../src/lib/services/ingestion");

  const files = collectFiles(DATA_DIR);
  console.log(`Found ${files.length} files to import:\n`);

  for (const filePath of files) {
    const fileName = basename(filePath);
    console.log(`Importing: ${fileName}`);

    try {
      const result = await ingestFile(filePath, fileName);
      console.log(
        `  -> ${result.summary.source}: ${result.summary.rowsProcessed} rows, ` +
          `${result.summary.transactions} transactions, ` +
          `${result.summary.platformOrders} orders, ` +
          `${result.summary.expenses} expenses` +
          (result.summary.errors.length > 0
            ? ` (${result.summary.errors.length} errors)`
            : "")
      );
    } catch (error) {
      console.error(
        `  -> ERROR: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  console.log("\nDone!");
}

function collectFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const fullPath = resolve(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else {
      const ext = entry.split(".").pop()?.toLowerCase();
      if (ext && ["csv", "tsv", "xlsx", "xls"].includes(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

main().catch(console.error);
