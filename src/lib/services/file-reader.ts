import * as fs from "fs";
import * as XLSX from "xlsx";

/**
 * Read a CSV or XLSX file and return rows as an array of key-value objects.
 * Handles both .csv and .xlsx/.xls files.
 */
export function readFile(filePath: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const ext = filePath.toLowerCase().split(".").pop() || "";

  if (ext === "csv" || ext === "tsv") {
    return readCSV(filePath, ext === "tsv" ? "\t" : ",");
  } else if (ext === "xlsx" || ext === "xls") {
    return readXLSX(filePath);
  } else {
    throw new Error(`Unsupported file type: .${ext}. Supported: csv, tsv, xlsx, xls`);
  }
}

function readCSV(
  filePath: string,
  delimiter: string
): { headers: string[]; rows: Record<string, string>[] } {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim());

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  // Parse header line
  const headers = parseCSVLine(lines[0], delimiter);

  // Parse data lines
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i], delimiter);
    if (values.every((v) => !v.trim())) continue; // Skip blank rows

    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || "";
    }
    rows.push(row);
  }

  return { headers, rows };
}

function readXLSX(filePath: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Convert to array of arrays
  const aoa: string[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });

  if (aoa.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = aoa[0].map((h) => String(h).trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < aoa.length; i++) {
    const values = aoa[i];
    if (!values || values.every((v) => !String(v).trim())) continue;

    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = String(values[j] ?? "");
    }
    rows.push(row);
  }

  return { headers, rows };
}

/**
 * Parse a single CSV line, handling quoted fields.
 */
function parseCSVLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // Skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
  }

  result.push(current.trim());
  return result;
}
