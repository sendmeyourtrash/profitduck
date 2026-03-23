import { createHash } from "crypto";
import { readFileSync } from "fs";
import { getImportByHash, getImports } from "../db/config-db";

/**
 * Compute SHA256 hash of a file's contents.
 */
export function computeFileHash(filePath: string): string {
  const data = readFileSync(filePath);
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Check if an exact duplicate file has already been imported.
 * Returns the matching import if found.
 */
export async function checkDuplicateFile(fileHash: string) {
  const existing = getImportByHash(fileHash);
  if (existing) {
    return {
      id: String(existing.id),
      source: existing.source || "",
      fileName: existing.filename,
      importedAt: existing.created_at ? new Date(existing.created_at) : new Date(),
    };
  }
  return null;
}

/**
 * Check for overlapping time ranges with existing imports from the same source.
 */
export async function checkOverlappingImports(
  source: string,
  dateRangeStart: Date,
  dateRangeEnd: Date
) {
  const allImports = getImports(source, 1000, 0);
  const startStr = dateRangeStart.toISOString().slice(0, 10);
  const endStr = dateRangeEnd.toISOString().slice(0, 10);

  return allImports
    .filter((imp) => {
      if (!imp.date_range_start || !imp.date_range_end) return false;
      return imp.date_range_start <= endStr && imp.date_range_end >= startStr;
    })
    .map((imp) => ({
      id: String(imp.id),
      fileName: imp.filename,
      importedAt: imp.created_at ? new Date(imp.created_at) : new Date(),
    }));
}

/**
 * Compute the date range covered by a set of parsed records.
 */
export function computeDateRange(
  dates: Date[]
): { start: Date; end: Date } | null {
  if (dates.length === 0) return null;

  let min = dates[0];
  let max = dates[0];

  for (const d of dates) {
    if (d < min) min = d;
    if (d > max) max = d;
  }

  return { start: min, end: max };
}
