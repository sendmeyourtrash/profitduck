import { prisma } from "../db/prisma";
import { readFile } from "./file-reader";
import { getParser, detectParser, SourcePlatform, ParseResult } from "../parsers";
import {
  computeFileHash,
  checkDuplicateFile,
  checkOverlappingImports,
  isTransactionDuplicate,
  isBankTransactionDuplicate,
  isExpenseDuplicate,
  isPayoutDuplicate,
  findMatchingBankTransaction,
  computeDateRange,
} from "./dedup";
import { ProgressCallback } from "./progress";
import { resolveVendorName } from "./vendor-aliases";

export interface IngestOptions {
  /** Skip file-level duplicate check */
  skipFileDedup?: boolean;
  /** Skip row-level duplicate check */
  skipRowDedup?: boolean;
  /** Progress callback for real-time updates */
  onProgress?: ProgressCallback;
}

/**
 * Process an uploaded file: detect source, parse, and store normalized data.
 * Now with SHA256 dedup and row-level dedup support.
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
          transactions: 0,
          platformOrders: 0,
          bankTransactions: 0,
          expenses: 0,
          payouts: 0,
          errors: [],
          rowsSkipped: 0,
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
  const { headers, rows } = readFile(filePath);

  if (rows.length === 0) {
    throw new Error("File is empty or contains no data rows.");
  }

  // 4. Detect or select parser
  let parser;
  if (sourcePlatform) {
    parser = getParser(sourcePlatform);
    if (!parser) {
      throw new Error(`Unknown platform: ${sourcePlatform}`);
    }
  } else {
    const detected = detectParser(fileName, headers);
    if (!detected) {
      throw new Error(
        "Could not auto-detect the source platform. Please specify it manually."
      );
    }
    parser = detected.parser;
  }

  // 5. Parse the data
  options.onProgress?.({ phase: "parsing", current: 0, total: rows.length, message: `Parsing ${rows.length.toLocaleString()} rows...` });
  const result = parser.parse(rows);

  // 6. Compute date range from all parsed records
  const allDates: Date[] = [
    ...result.transactions.map((t) => t.date),
    ...result.platformOrders.map((o) => o.orderDatetime),
    ...result.bankTransactions.map((bt) => bt.date),
    ...result.expenses.map((e) => e.date),
    ...result.payouts.map((p) => p.payoutDate),
  ];
  const dateRange = computeDateRange(allDates);

  // 7. Check for overlapping time ranges
  let overlappingImports: { id: string; fileName: string; importedAt: Date }[] = [];
  if (dateRange) {
    overlappingImports = await checkOverlappingImports(
      parser.source,
      dateRange.start,
      dateRange.end
    );
  }

  // 8. Create Import record
  const importRecord = await prisma.import.create({
    data: {
      source: parser.source,
      fileName,
      status: "processing",
      fileHash,
      dateRangeStart: dateRange?.start,
      dateRangeEnd: dateRange?.end,
    },
  });

  try {
    // 9. Store parsed data with row-level dedup
    const rowsSkipped = await storeResults(
      importRecord.id,
      result,
      !options.skipRowDedup,
      options.onProgress
    );

    // 10. Update Import with results
    const updated = await prisma.import.update({
      where: { id: importRecord.id },
      data: {
        status: "completed",
        rowsProcessed: result.rowsProcessed,
        rowsFailed: result.errors.length,
        rowsSkipped,
        errorMessage:
          result.errors.length > 0
            ? result.errors.slice(0, 10).join("; ")
            : null,
      },
    });

    return {
      import: updated,
      summary: {
        source: parser.source,
        rowsProcessed: result.rowsProcessed,
        transactions: result.transactions.length,
        platformOrders: result.platformOrders.length,
        bankTransactions: result.bankTransactions.length,
        expenses: result.expenses.length,
        payouts: result.payouts.length,
        errors: result.errors,
        rowsSkipped,
      },
      duplicate: null,
      overlappingImports:
        overlappingImports.length > 0 ? overlappingImports : null,
    };
  } catch (error) {
    await prisma.import.update({
      where: { id: importRecord.id },
      data: {
        status: "failed",
        errorMessage:
          error instanceof Error ? error.message : "Unknown error",
      },
    });
    throw error;
  }
}

/**
 * Store all parsed results into the database with optional row-level dedup.
 * Returns the number of rows skipped due to dedup.
 */
async function storeResults(
  importId: string,
  result: ParseResult,
  enableRowDedup: boolean,
  onProgress?: ProgressCallback
): Promise<number> {
  let rowsSkipped = 0;
  const totalRecords =
    result.transactions.length +
    result.platformOrders.length +
    result.bankTransactions.length +
    result.expenses.length +
    result.payouts.length;
  let stored = 0;

  await prisma.$transaction(async (tx) => {
    // Store transactions with dedup
    for (const t of result.transactions) {
      if (enableRowDedup) {
        const isDup = await isTransactionDuplicate(
          {
            rawSourceId: t.rawSourceId,
            sourcePlatform: t.sourcePlatform,
            date: t.date,
            amount: t.amount,
            description: t.description,
          },
          tx
        );
        if (isDup) {
          rowsSkipped++;
          stored++;
          if (stored % 50 === 0) onProgress?.({ phase: "storing", current: stored, total: totalRecords, message: `Storing records... ${stored.toLocaleString()} / ${totalRecords.toLocaleString()}` });
          continue;
        }
      }
      await tx.transaction.create({
        data: {
          date: t.date,
          amount: t.amount,
          type: t.type,
          sourcePlatform: t.sourcePlatform,
          category: t.category || null,
          description: t.description || null,
          rawSourceId: t.rawSourceId || null,
          rawData: t.rawData,
          importId,
        },
      });
      stored++;
      if (stored % 50 === 0) onProgress?.({ phase: "storing", current: stored, total: totalRecords, message: `Storing records... ${stored.toLocaleString()} / ${totalRecords.toLocaleString()}` });
    }

    // Store platform orders (already has unique constraint dedup)
    for (const order of result.platformOrders) {
      const existing = await tx.platformOrder.findUnique({
        where: {
          orderId_platform: {
            orderId: order.orderId,
            platform: order.platform,
          },
        },
      });
      if (existing) {
        rowsSkipped++;
        stored++;
        if (stored % 50 === 0) onProgress?.({ phase: "storing", current: stored, total: totalRecords, message: `Storing records... ${stored.toLocaleString()} / ${totalRecords.toLocaleString()}` });
        continue;
      }
      await tx.platformOrder.create({
        data: {
          orderId: order.orderId,
          platform: order.platform,
          orderDatetime: order.orderDatetime,
          subtotal: order.subtotal,
          tax: order.tax,
          deliveryFee: order.deliveryFee,
          serviceFee: order.serviceFee,
          commissionFee: order.commissionFee,
          tip: order.tip,
          netPayout: order.netPayout,
          discounts: order.discounts ?? 0,
          itemCategory: order.itemCategory || null,
          diningOption: order.diningOption || null,
          channel: order.channel || null,
          cardBrand: order.cardBrand || null,
          fulfillmentType: order.fulfillmentType || null,
          customerFees: order.customerFees ?? 0,
          marketingFees: order.marketingFees ?? 0,
          refunds: order.refunds ?? 0,
          adjustments: order.adjustments ?? 0,
          platformPayoutId: order.platformPayoutId || null,
          rawData: order.rawData,
          importId,
        },
      });
      stored++;
      if (stored % 50 === 0) onProgress?.({ phase: "storing", current: stored, total: totalRecords, message: `Storing records... ${stored.toLocaleString()} / ${totalRecords.toLocaleString()}` });
    }

    // Store bank transactions with dedup (cross-source aware)
    for (const bt of result.bankTransactions) {
      if (enableRowDedup) {
        const isDup = await isBankTransactionDuplicate(
          { date: bt.date, amount: bt.amount, description: bt.description, accountName: bt.accountName },
          tx
        );
        if (isDup) {
          rowsSkipped++;
          stored++;
          if (stored % 50 === 0) onProgress?.({ phase: "storing", current: stored, total: totalRecords, message: `Storing records... ${stored.toLocaleString()} / ${totalRecords.toLocaleString()}` });
          continue;
        }
      }
      await tx.bankTransaction.create({
        data: {
          date: bt.date,
          description: bt.description,
          amount: bt.amount,
          category: bt.category || null,
          accountType: bt.accountType || null,
          accountName: bt.accountName || null,
          institutionName: bt.institutionName || null,
          taxDeductible: bt.taxDeductible ?? false,
          tags: bt.tags || null,
          rawData: bt.rawData,
          importId,
        },
      });
      stored++;
      if (stored % 50 === 0) onProgress?.({ phase: "storing", current: stored, total: totalRecords, message: `Storing records... ${stored.toLocaleString()} / ${totalRecords.toLocaleString()}` });
    }

    // Store expenses with dedup and auto-create vendors
    for (const exp of result.expenses) {
      if (enableRowDedup) {
        const isDup = await isExpenseDuplicate(
          { date: exp.date, amount: exp.amount, vendorName: exp.vendorName },
          tx
        );
        if (isDup) {
          rowsSkipped++;
          stored++;
          if (stored % 50 === 0) onProgress?.({ phase: "storing", current: stored, total: totalRecords, message: `Storing records... ${stored.toLocaleString()} / ${totalRecords.toLocaleString()}` });
          continue;
        }
      }

      let vendor = await tx.vendor.findUnique({
        where: { name: exp.vendorName },
      });
      if (!vendor) {
        const displayName = await resolveVendorName(exp.vendorName);
        vendor = await tx.vendor.create({
          data: {
            name: exp.vendorName,
            displayName,
            category: exp.category || null,
          },
        });
      }

      // Try to match category string to an ExpenseCategory
      let expenseCategoryId: string | null = null;
      if (exp.category) {
        const matchedRule = await tx.categorizationRule.findFirst({
          where: {
            type: "category_match",
            pattern: exp.category,
          },
        });
        if (matchedRule) {
          expenseCategoryId = matchedRule.categoryId;
        }
      }

      // Try to find a matching bank transaction to link
      const matchedBankTxId = await findMatchingBankTransaction(
        { date: exp.date, amount: exp.amount, importId },
        tx
      );

      await tx.expense.create({
        data: {
          vendorId: vendor.id,
          amount: exp.amount,
          date: exp.date,
          category: exp.category || null,
          paymentMethod: exp.paymentMethod || null,
          notes: exp.notes || null,
          rawData: exp.rawData,
          importId,
          expenseCategoryId,
          linkedBankTransactionId: matchedBankTxId,
        },
      });
      stored++;
      if (stored % 50 === 0) onProgress?.({ phase: "storing", current: stored, total: totalRecords, message: `Storing records... ${stored.toLocaleString()} / ${totalRecords.toLocaleString()}` });
    }

    // Store payouts with dedup
    for (const p of result.payouts) {
      if (enableRowDedup) {
        const isDup = await isPayoutDuplicate(
          {
            platformPayoutId: p.platformPayoutId,
            platform: p.platform,
            payoutDate: p.payoutDate,
            netAmount: p.netAmount,
          },
          tx
        );
        if (isDup) {
          rowsSkipped++;
          stored++;
          if (stored % 50 === 0) onProgress?.({ phase: "storing", current: stored, total: totalRecords, message: `Storing records... ${stored.toLocaleString()} / ${totalRecords.toLocaleString()}` });
          continue;
        }
      }
      await tx.payout.create({
        data: {
          platform: p.platform,
          payoutDate: p.payoutDate,
          grossAmount: p.grossAmount,
          fees: p.fees,
          netAmount: p.netAmount,
          platformPayoutId: p.platformPayoutId || null,
          rawData: p.rawData,
          importId,
        },
      });
      stored++;
      if (stored % 50 === 0) onProgress?.({ phase: "storing", current: stored, total: totalRecords, message: `Storing records... ${stored.toLocaleString()} / ${totalRecords.toLocaleString()}` });
    }
  });

  return rowsSkipped;
}
