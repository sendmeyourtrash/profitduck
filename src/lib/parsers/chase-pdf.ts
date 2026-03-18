import { ParseResult, emptyResult } from "./types";

/**
 * Parser for Chase Bank PDF statement exports.
 *
 * Uses pdf.js-extract for layout-aware parsing with x,y coordinates.
 * Chase PDFs contain hidden section markers (start/end) that
 * unambiguously identify deposits vs withdrawals vs fees sections.
 *
 * Supports:
 * 1. Business Checking — uses section markers for deposits/withdrawals/fees
 * 2. Credit Card (Ink) — uses "ACCOUNT ACTIVITY" section with signed amounts
 */

// Types for pdf.js-extract data
export interface PdfPage {
  pageInfo: { num: number; width: number; height: number };
  content: PdfItem[];
}
export interface PdfItem {
  x: number;
  y: number;
  str: string;
  width: number;
  height: number;
}
export interface PdfData {
  pages: PdfPage[];
}

/** Detect whether extracted PDF text is a Chase statement */
export function detectChasePdf(text: string): number {
  const lower = text.toLowerCase();
  if (
    lower.includes("jpmorgan chase bank") ||
    lower.includes("chase business complete checking") ||
    lower.includes("chase ultimate rewards")
  ) {
    return 0.95;
  }
  if (
    lower.includes("chase") &&
    (lower.includes("deposits and additions") ||
      lower.includes("account activity") ||
      lower.includes("electronic withdrawals"))
  ) {
    return 0.8;
  }
  return 0;
}

/**
 * Parse Chase PDF using layout-aware extraction.
 * For checking statements, uses pdf.js-extract data with section markers.
 * For credit cards, falls back to text-based parsing (already reliable).
 */
export function parseChasePdfText(
  text: string,
  _fileName: string,
  pdfData?: PdfData
): ParseResult {
  const isChecking =
    text.includes("CHECKING SUMMARY") ||
    text.includes("DEPOSITS AND ADDITIONS");
  const isCreditCard =
    text.includes("ACCOUNT ACTIVITY") &&
    (text.includes("ACCOUNT SUMMARY") || text.includes("Purchases"));

  const year = extractStatementYear(text);

  if (isChecking && pdfData) {
    return parseCheckingWithLayout(pdfData, year, text);
  } else if (isChecking) {
    // Fallback if no pdfData provided (shouldn't happen in practice)
    return parseCheckingFromText(text, year);
  } else if (isCreditCard) {
    return parseCreditCardStatement(text, year);
  }
  return emptyResult();
}

// ─── Year Extraction ─────────────────────────────────────────────────

function extractStatementYear(text: string): number {
  const m = text.match(
    /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(\d{4})\s*through/i
  );
  if (m) return parseInt(m[1]);

  const sd = text.match(/Statement Date:\s*(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (sd) {
    const y = parseInt(sd[3]);
    return y < 100 ? 2000 + y : y;
  }

  const oc = text.match(
    /Opening\/Closing Date\s*(\d{2})\/(\d{2})\/(\d{2,4})\s*-\s*(\d{2})\/(\d{2})\/(\d{2,4})/
  );
  if (oc) {
    const y = parseInt(oc[6]);
    return y < 100 ? 2000 + y : y;
  }

  return new Date().getFullYear();
}

// ─── Checking Statement (Layout-Aware) ──────────────────────────────

/**
 * Parse checking statement using pdf.js-extract data.
 *
 * Strategy: Use section start/end markers to know exactly which
 * elements belong to deposits, withdrawals, and fees sections.
 * Then reconstruct text lines by y-coordinate within each section
 * and parse dates + amounts from the layout positions.
 */
function parseCheckingWithLayout(
  pdfData: PdfData,
  year: number,
  fullText: string
): ParseResult {
  const result = emptyResult();
  const accountName = fullText.includes("Business Complete Checking")
    ? "BUS COMPLETE CHK"
    : "Chase Checking";

  // Collect all text elements by section
  type SectionType = "deposits" | "withdrawals" | "fees";

  interface SectionItem extends PdfItem {
    pageNum: number;
    section: SectionType;
  }

  const sectionItems: SectionItem[] = [];

  for (const page of pdfData.pages) {
    const pageNum = page.pageInfo.num;

    // Find section boundaries on this page using start/end markers
    const sectionBounds: { type: SectionType; startY: number; endY: number }[] = [];

    let depStart = -1, depEnd = -1;
    let ewStart = -1, ewEnd = -1;
    let feeStart = -1, feeEnd = -1;

    for (const item of page.content) {
      const s = item.str;
      const sl = s.toLowerCase().replace(/\s+/g, "");
      if (sl.includes("*start*") && sl.includes("deposit")) depStart = item.y;
      if (sl.includes("*end*") && sl.includes("deposit")) depEnd = item.y;
      if (sl.includes("*start*") && sl.includes("electronic") && sl.includes("withdraw")) ewStart = item.y;
      if (sl.includes("*end*") && sl.includes("electronic") && sl.includes("withdraw")) ewEnd = item.y;
      if (sl.includes("*start*") && sl.includes("fee")) feeStart = item.y;
      if (sl.includes("*end*") && sl.includes("fee")) feeEnd = item.y;
    }

    if (depStart >= 0 && depEnd >= 0) {
      sectionBounds.push({ type: "deposits", startY: depStart, endY: depEnd });
    }
    if (ewStart >= 0 && ewEnd >= 0) {
      sectionBounds.push({ type: "withdrawals", startY: ewStart, endY: ewEnd });
    }
    if (feeStart >= 0 && feeEnd >= 0) {
      sectionBounds.push({ type: "fees", startY: feeStart, endY: feeEnd });
    }

    // Assign each text element to its section
    for (const item of page.content) {
      if (!item.str.trim()) continue;
      if (item.str.includes("*start*") || item.str.includes("*end*")) continue;

      for (const bound of sectionBounds) {
        if (item.y >= bound.startY && item.y <= bound.endY) {
          sectionItems.push({
            ...item,
            pageNum,
            section: bound.type,
          });
          break;
        }
      }
    }
  }

  // Reconstruct lines by y-coordinate within each section
  // Group elements into lines (same y within tolerance)
  interface TextLine {
    y: number;
    pageNum: number;
    section: SectionType;
    items: SectionItem[];
  }

  const lines: TextLine[] = [];
  for (const item of sectionItems) {
    const existing = lines.find(
      (l) =>
        l.pageNum === item.pageNum &&
        l.section === item.section &&
        Math.abs(l.y - item.y) < 3
    );
    if (existing) {
      existing.items.push(item);
    } else {
      lines.push({
        y: item.y,
        pageNum: item.pageNum,
        section: item.section,
        items: [item],
      });
    }
  }

  // Sort lines by page then y
  lines.sort((a, b) => a.pageNum - b.pageNum || a.y - b.y);

  // Parse transactions from lines
  // Each transaction has:
  // - A date line (starts with MM/DD) at the left (x < 50)
  // - An amount on the same or nearby line at the right (x > 450)
  // - Description text between date and amount (may span multiple lines)

  interface TxBlock {
    dateStr: string;
    section: SectionType;
    descParts: string[];
    amount: number;
  }

  const txBlocks: TxBlock[] = [];
  let currentDate: string | null = null;
  let currentSection: SectionType = "deposits";
  let currentDesc: string[] = [];
  let currentAmount: number | null = null;

  function flushTx() {
    if (currentDate && currentAmount !== null) {
      txBlocks.push({
        dateStr: currentDate,
        section: currentSection,
        descParts: [...currentDesc],
        amount: currentAmount,
      });
    }
    currentDate = null;
    currentDesc = [];
    currentAmount = null;
  }

  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);

    // Skip header/total lines
    const fullText = line.items.map((i) => i.str).join("");
    const upper = fullText.toUpperCase();
    if (
      upper.includes("DATE") && upper.includes("DESCRIPTION") ||
      upper.includes("AMOUNT") && upper.length < 20 ||
      upper.startsWith("DEPOSITS") ||
      upper.startsWith("ELECTRONIC WITHDRAWALS") ||
      upper.startsWith("TOTAL ") ||
      upper.includes("(CONTINUED)")
    ) {
      continue;
    }

    // Find date (leftmost element starting with MM/DD, x < 50)
    const dateItem = line.items.find(
      (i) => i.x < 50 && /^\d{2}\/\d{2}/.test(i.str)
    );

    // Find amount (rightmost element, x > 450, looks like a number)
    const amountItem = [...line.items]
      .reverse()
      .find((i) => i.x > 450 && /^\$?-?[\d,]+\.\d{2}$/.test(i.str.trim()));

    if (dateItem) {
      // New transaction starts
      flushTx();
      currentDate = dateItem.str.substring(0, 5);
      currentSection = line.section;

      // Collect description from middle elements
      currentDesc = [];
      for (const item of line.items) {
        if (item === dateItem || item === amountItem) continue;
        if (item.str.trim()) currentDesc.push(item.str.trim());
      }

      // Date item might have description glued to it
      const dateRest = dateItem.str.substring(5).trim();
      if (dateRest) currentDesc.unshift(dateRest);

      if (amountItem) {
        currentAmount = parseFloat(
          amountItem.str.replace(/[$,]/g, "")
        );
      }
    } else if (amountItem && currentDate && currentAmount === null) {
      // Amount on a separate line following the date
      currentAmount = parseFloat(amountItem.str.replace(/[$,]/g, ""));
      // Also grab any description text on this line
      for (const item of line.items) {
        if (item === amountItem) continue;
        if (item.str.trim()) currentDesc.push(item.str.trim());
      }
    } else if (currentDate) {
      // Continuation line (more description text)
      for (const item of line.items) {
        if (item.str.trim()) currentDesc.push(item.str.trim());
      }
    }
  }
  flushTx();

  // Convert blocks to results
  for (const block of txBlocks) {
    const [month, day] = block.dateStr.split("/").map(Number);
    const date = new Date(year, month - 1, day);
    const rawDesc = block.descParts.join(" ");
    const desc = cleanCheckingDescription(rawDesc);
    const isWithdrawal = block.section === "withdrawals" || block.section === "fees";
    const signedAmount = isWithdrawal ? -block.amount : block.amount;

    result.rowsProcessed++;
    result.bankTransactions.push({
      date,
      description: desc,
      amount: signedAmount,
      rawData: JSON.stringify({
        date: block.dateStr,
        description: rawDesc,
        amount: signedAmount,
        section: block.section,
      }),
      accountType: "Checking",
      accountName,
      institutionName: "Chase",
    });
    result.transactions.push({
      date,
      amount: block.amount,
      type: isWithdrawal ? "expense" : "income",
      sourcePlatform: "chase",
      category: isWithdrawal ? "expense" : "deposit",
      description: desc,
      rawData: JSON.stringify({
        date: block.dateStr,
        description: rawDesc,
        amount: signedAmount,
        section: block.section,
      }),
    });
  }

  return result;
}

// ─── Checking Statement (Text Fallback) ─────────────────────────────

function parseCheckingFromText(text: string, year: number): ParseResult {
  // Simple text fallback — less accurate but works without pdf.js-extract data
  const result = emptyResult();
  const lines = text.split("\n");
  const accountName = text.includes("Business Complete Checking")
    ? "BUS COMPLETE CHK"
    : "Chase Checking";

  let currentSection: "deposits" | "withdrawals" | "fees" | "none" = "none";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.includes("DEPOSITS AND ADDITIONS")) { currentSection = "deposits"; continue; }
    if (trimmed.includes("ELECTRONIC WITHDRAWALS")) { currentSection = "withdrawals"; continue; }
    if (trimmed === "FEES") { currentSection = "fees"; continue; }
    if (trimmed.includes("DAILY ENDING BALANCE")) { currentSection = "none"; continue; }
    if (currentSection === "none") continue;

    const dateMatch = trimmed.match(/^(\d{2}\/\d{2})/);
    if (!dateMatch) continue;

    const amountMatch = trimmed.match(/\$?([\d,]+\.\d{2})\s*$/);
    if (!amountMatch) continue;

    const dateStr = dateMatch[1];
    const amount = parseFloat(amountMatch[1].replace(/,/g, ""));
    const [month, day] = dateStr.split("/").map(Number);
    const date = new Date(year, month - 1, day);
    const isWithdrawal = currentSection === "withdrawals" || currentSection === "fees";

    const desc = trimmed.substring(5).replace(/\$?[\d,]+\.\d{2}\s*$/, "").trim();
    const signedAmount = isWithdrawal ? -amount : amount;

    result.rowsProcessed++;
    result.bankTransactions.push({
      date,
      description: desc || "Transaction",
      amount: signedAmount,
      rawData: JSON.stringify({ date: dateStr, description: desc, amount: signedAmount }),
      accountType: "Checking",
      accountName,
      institutionName: "Chase",
    });
    result.transactions.push({
      date,
      amount,
      type: isWithdrawal ? "expense" : "income",
      sourcePlatform: "chase",
      category: isWithdrawal ? "expense" : "deposit",
      description: desc || "Transaction",
      rawData: JSON.stringify({ date: dateStr, description: desc, amount: signedAmount }),
    });
  }

  return result;
}

function cleanCheckingDescription(raw: string): string {
  // Extract the company name from ACH entries
  const origMatch = raw.match(/Orig\s*CO\s*Name:\s*(.+?)(?:\s{2,}|Orig\s*ID)/i);
  if (origMatch) return origMatch[1].trim();

  // Also try without colon (pdf.js-extract may concatenate differently)
  const origMatch2 = raw.match(/OrigCOName:(.+?)(?:OrigID|$)/i);
  if (origMatch2) return origMatch2[1].trim();

  const zelleMatch = raw.match(/Zelle\s*Payment\s*To\s+(.+)/i);
  if (zelleMatch)
    return `Zelle - ${zelleMatch[1].replace(/\s*\d{8,}.*$/, "").trim()}`;

  // Payment to Chase Card
  const cardMatch = raw.match(/Payment\s*To\s*Chase\s*Card\s*Ending\s*(?:IN\s*)?(\d{4})/i);
  if (cardMatch) return `Payment To Chase Card ${cardMatch[1]}`;

  // Monthly Service Fee
  if (raw.toLowerCase().includes("monthly service fee")) return "Monthly Service Fee";

  return raw.substring(0, 80).trim();
}

// ─── Credit Card Statement ──────────────────────────────────────────

function parseCreditCardStatement(text: string, year: number): ParseResult {
  const result = emptyResult();

  const openCloseMatch = text.match(
    /Opening\/Closing Date\s*(\d{2})\/(\d{2})\/(\d{2,4})\s*-\s*(\d{2})\/(\d{2})\/(\d{2,4})/
  );
  let openMonth = 0,
    openYear = year,
    closeYear = year;
  if (openCloseMatch) {
    openMonth = parseInt(openCloseMatch[1]);
    openYear = parseInt(openCloseMatch[3]);
    if (openYear < 100) openYear += 2000;
    closeYear = parseInt(openCloseMatch[6]);
    if (closeYear < 100) closeYear += 2000;
  }

  const lines = text.split("\n");
  let inActivity = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.includes("Merchant") && trimmed.includes("Amount")) {
      inActivity = true;
      continue;
    }

    if (
      inActivity &&
      (trimmed.includes("Total fees charged") ||
        trimmed.includes("Totals Year-to-Date") ||
        trimmed.startsWith("INTEREST CHARGES"))
    ) {
      break;
    }

    if (!inActivity) continue;

    if (
      !trimmed ||
      trimmed.startsWith("Date of") ||
      trimmed.startsWith("Transaction") ||
      trimmed.includes("TRANSACTIONS THIS CYCLE") ||
      trimmed.includes("INCLUDING PAYMENTS") ||
      /^[A-Z][A-Z ]+$/.test(trimmed)
    ) {
      continue;
    }

    // Credit card line: "MM/DD     DESCRIPTION_TEXT123.45"
    const txMatch = trimmed.match(
      /^(\d{2}\/\d{2})\s{2,}(.+?)(-?\d[\d,]*\.\d{2})$/
    );
    if (!txMatch) {
      const txMatch2 = trimmed.match(
        /^(\d{2}\/\d{2})\s{2,}(.+?)(-?\.\d{2})$/
      );
      if (!txMatch2) continue;
      processccLine(txMatch2, openMonth, openYear, closeYear, year, openCloseMatch, result);
      continue;
    }

    processccLine(txMatch, openMonth, openYear, closeYear, year, openCloseMatch, result);
  }

  return result;
}

function processccLine(
  txMatch: RegExpMatchArray,
  openMonth: number,
  openYear: number,
  closeYear: number,
  year: number,
  openCloseMatch: RegExpMatchArray | null,
  result: ParseResult
): void {
  const dateStr = txMatch[1];
  const description = txMatch[2].trim();
  const amount = parseFloat(txMatch[3].replace(/,/g, ""));

  const [txMonth, txDay] = dateStr.split("/").map(Number);
  let txYear: number;
  if (openCloseMatch && openYear < closeYear) {
    txYear = txMonth >= openMonth ? openYear : closeYear;
  } else {
    txYear = year;
  }

  const date = new Date(txYear, txMonth - 1, txDay);
  result.rowsProcessed++;

  // Credit card: positive = purchase (expense), negative = payment/credit
  result.bankTransactions.push({
    date,
    description,
    amount: -amount,
    rawData: JSON.stringify({ date: dateStr, description, amount }),
    accountType: "Credit Card",
    accountName: "Chase Ink",
    institutionName: "Chase",
  });

  result.transactions.push({
    date,
    amount: Math.abs(amount),
    type: amount > 0 ? "expense" : "income",
    sourcePlatform: "chase",
    category: amount > 0 ? "expense" : "payment",
    description,
    rawData: JSON.stringify({ date: dateStr, description, amount }),
  });
}
