/**
 * CSV Upload Orchestrator
 * =======================
 *
 * Handles file uploads from the Settings page. Routes files through
 * the 2-step pipeline:
 *
 *   Step 1: CSV → Vendor DB (raw + cleanup)
 *   Step 2: Vendor DB → Unified DB (normalize)
 *
 * Also records import history in categories.db for tracking.
 *
 * @see pipeline-step1-ingest.ts — Step 1 implementation
 * @see pipeline-step2-unify.ts — Step 2 implementation
 * @see PIPELINE.md — Full documentation
 */

import { createImport, getCategoriesDb } from "../db/config-db";
import { readFile, readPdfFile } from "./file-reader";
import { getParser, detectParser, SourcePlatform, ParseResult, detectChasePdf, parseChasePdfText } from "../parsers";
import { computeFileHash, checkDuplicateFile, checkOverlappingImports, computeDateRange } from "./dedup";
import { ProgressCallback } from "./progress";
import { step1Ingest, IngestResult } from "./pipeline-step1-ingest";
import { step2Unify, UnifyResult } from "./pipeline-step2-unify";
import { step3ApplyAliases } from "./pipeline-step3-aliases";

export interface IngestOptions {
  /** Skip file-level duplicate check */
  skipFileDedup?: boolean;
  /** Skip row-level duplicate check */
  skipRowDedup?: boolean;
  /** Progress callback for real-time updates */
  onProgress?: ProgressCallback;
}

/**
 * Process an uploaded file through the 2-step pipeline.
 *
 * 1. Read and parse the file
 * 2. Step 1: Write raw data to vendor DB (with cleanup/dedup)
 * 3. Step 2: Read from vendor DB, write normalized data to unified DB
 * 4. Record import in categories.db for tracking
 */
export async function ingestFile(
  filePath: string,
  fileName: string,
  sourcePlatform?: SourcePlatform,
  options: IngestOptions = {}
) {
  // 1. Compute file hash for duplicate detection
  const fileHash = computeFileHash(filePath);

  // 2. Check for exact file duplicates
  if (!options.skipFileDedup) {
    const duplicateImport = await checkDuplicateFile(fileHash);
    if (duplicateImport) {
      return {
        import: null,
        summary: {
          source: duplicateImport.source,
          rowsProcessed: 0,
          step1: { platform: duplicateImport.source, inserted: 0, skipped: 0, cleaned: 0, errors: [] },
          step2: { platform: duplicateImport.source, inserted: 0, skipped: 0, errors: [] },
          errors: [],
        },
        duplicate: {
          isDuplicate: true,
          existingImportId: duplicateImport.id,
          existingFileName: duplicateImport.fileName,
          importedAt: duplicateImport.importedAt,
        },
      };
    }
  }

  // 3. Read the file
  options.onProgress?.({ phase: "reading", current: 0, total: 0, message: "Reading file..." });

  const ext = fileName.toLowerCase().split(".").pop() || "";
  let rawRows: Record<string, string>[] = [];
  let parserSource: SourcePlatform;
  let parsedResult: ParseResult | null = null;

  if (ext === "pdf") {
    // PDF flow: Chase statements — use existing parser, handled separately
    const { text, pdfData } = await readPdfFile(filePath);

    const confidence = detectChasePdf(text);
    if (confidence < 0.5) {
      throw new Error("Could not detect this PDF as a Chase statement. Only Chase bank and credit card PDF statements are currently supported.");
    }

    options.onProgress?.({ phase: "parsing", current: 0, total: 1, message: "Parsing PDF statement..." });
    parsedResult = parseChasePdfText(text, fileName, pdfData);
    parserSource = "chase";

    if (parsedResult.bankTransactions.length === 0 && parsedResult.transactions.length === 0) {
      throw new Error("No transactions found in this PDF. Make sure it's a Chase bank or credit card statement.");
    }
  } else {
    // CSV/XLSX flow: read rows, detect platform
    const { headers, rows } = readFile(filePath);

    if (rows.length === 0) {
      throw new Error("File is empty or contains no data rows.");
    }

    // Detect or use specified platform
    if (sourcePlatform) {
      const parser = getParser(sourcePlatform);
      if (!parser) throw new Error(`Unknown platform: ${sourcePlatform}`);
      parserSource = parser.source;
    } else {
      const detected = detectParser(fileName, headers);
      if (!detected) {
        throw new Error("Could not auto-detect the source platform. Please specify it manually.");
      }
      parserSource = detected.parser.source;
    }

    rawRows = rows;
    options.onProgress?.({ phase: "parsing", current: 0, total: rows.length, message: `Detected ${parserSource}: ${rows.length.toLocaleString()} rows` });
  }

  // 4. Compute date range for import tracking
  let dateRange: { start: Date; end: Date } | null = null;
  if (parsedResult) {
    const allDates: Date[] = [
      ...parsedResult.transactions.map((t) => t.date),
      ...parsedResult.bankTransactions.map((bt) => bt.date),
    ];
    dateRange = computeDateRange(allDates);
  }

  // 5. Check for overlapping imports
  let overlappingImports: { id: string; fileName: string; importedAt: Date }[] = [];
  if (dateRange) {
    overlappingImports = await checkOverlappingImports(parserSource, dateRange.start, dateRange.end);
  }

  // 6. Create import record in config-db (for tracking)
  const importId = createImport(
    fileName,
    parserSource,
    0,
    fileHash,
    dateRange?.start.toISOString().slice(0, 10),
    dateRange?.end.toISOString().slice(0, 10)
  );

  try {
    let step1Result: IngestResult = { platform: parserSource, inserted: 0, skipped: 0, cleaned: 0, errors: [] };
    let step2Result: UnifyResult = { platform: parserSource, inserted: 0, skipped: 0, errors: [] };

    if (parsedResult && parserSource === "chase") {
      // Chase PDFs don't go through the standard pipeline yet
      // TODO: Create chase.db vendor DB and pipeline
      options.onProgress?.({ phase: "storing", current: 0, total: 0, message: "Storing Chase data..." });
      // For now, write directly to bank.db chase_statements
      const Database = (await import("better-sqlite3")).default;
      const path = await import("path");
      const bankDb = new Database(path.join(process.cwd(), "databases", "bank.db"));
      bankDb.exec(`CREATE TABLE IF NOT EXISTS chase_statements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT, description TEXT, amount REAL,
        account_type TEXT, account_name TEXT, source TEXT DEFAULT 'chase'
      )`);
      const insert = bankDb.prepare("INSERT INTO chase_statements (date, description, amount, account_type, account_name) VALUES (?,?,?,?,?)");
      const insertAll = bankDb.transaction(() => {
        for (const bt of parsedResult!.bankTransactions) {
          const existing = bankDb.prepare("SELECT 1 FROM chase_statements WHERE date = ? AND amount = ? AND description = ?")
            .get(bt.date.toISOString().slice(0, 10), bt.amount, bt.description);
          if (existing) { step1Result.skipped++; continue; }
          insert.run(bt.date.toISOString().slice(0, 10), bt.description, bt.amount, bt.accountType, bt.accountName);
          step1Result.inserted++;
        }
      });
      insertAll();
      bankDb.close();
    } else if (rawRows.length > 0) {
      // ============================================================
      // STEP 1: CSV rows → Vendor DB (raw + cleanup)
      // ============================================================
      options.onProgress?.({ phase: "storing", current: 0, total: rawRows.length, message: `Step 1: Writing to ${parserSource} vendor DB...` });
      step1Result = step1Ingest(parserSource, rawRows);
      console.log(`[Ingest] Step 1 (${parserSource}): inserted=${step1Result.inserted}, skipped=${step1Result.skipped}, cleaned=${step1Result.cleaned}`);

      // ============================================================
      // STEP 2: Vendor DB → Unified DB (normalize)
      // ============================================================
      options.onProgress?.({ phase: "syncing", current: 0, total: 0, message: `Step 2: Normalizing to unified DB...` });
      step2Result = step2Unify(parserSource);
      console.log(`[Ingest] Step 2 (${parserSource}): inserted=${step2Result.inserted}, skipped=${step2Result.skipped}`);

      // ============================================================
      // STEP 3: Apply aliases (categories.db → sales.db order_items)
      // ============================================================
      options.onProgress?.({ phase: "syncing", current: 0, total: 0, message: `Step 3: Applying aliases...` });
      const aliasResult = step3ApplyAliases();
      console.log(`[Ingest] Step 3: items=${aliasResult.itemAliasesApplied}, categories=${aliasResult.categoryAliasesApplied}`);
    }

    // 7. Update import record
    const totalProcessed = step1Result.inserted + step1Result.skipped;
    getCategoriesDb().prepare(
      "UPDATE imports SET status = 'completed', records_count = ? WHERE id = ?"
    ).run(totalProcessed, importId);

    return {
      import: { id: importId, fileName, source: parserSource, status: "completed", rowsProcessed: totalProcessed },
      summary: {
        source: parserSource,
        rowsProcessed: totalProcessed,
        step1: step1Result,
        step2: step2Result,
        errors: [...step1Result.errors, ...step2Result.errors],
      },
      duplicate: null,
      overlappingImports: overlappingImports.length > 0 ? overlappingImports : null,
    };
  } catch (error) {
    getCategoriesDb().prepare(
      "UPDATE imports SET status = 'failed' WHERE id = ?"
    ).run(importId);
    throw error;
  }
}
