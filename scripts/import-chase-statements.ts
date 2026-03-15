#!/usr/bin/env npx tsx
/**
 * Import Chase bank and credit card PDF statements into the database.
 *
 * Usage:
 *   npx tsx scripts/import-chase-statements.ts
 *
 * Parses all PDFs under "Data Exports/Chase Statements/{year}/Bank|Credit/"
 * and creates BankTransaction + Expense records.
 */

import { execSync } from "child_process";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { randomUUID } from "crypto";
import * as path from "path";
import * as fs from "fs";

const adapter = new PrismaLibSql({
  url: `file:${process.cwd()}/dev.db`,
});
const prisma = new PrismaClient({ adapter });

// ── Types ──────────────────────────────────────────────────────

interface ParsedTransaction {
  date: Date;
  description: string;
  amount: number; // positive = deposit/purchase, negative = payment/credit
  type: "deposit" | "withdrawal" | "credit_purchase" | "credit_payment" | "credit_refund";
  source: string; // e.g. "Square Inc", "Grubhub Inc", "Zelle", etc.
  accountType: "bank" | "credit";
  cardHolder?: string;
}

// ── PDF text extraction ────────────────────────────────────────

function extractPdfText(filePath: string): string {
  try {
    return execSync(`pdftotext -layout "${filePath}" -`, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch {
    console.error(`  ✗ Failed to extract text from: ${filePath}`);
    return "";
  }
}

// ── Bank statement parser ──────────────────────────────────────

function parseBankStatement(text: string, filePath: string): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];

  // Extract statement date range for year context
  const dateRangeMatch = text.match(
    /(\w+ \d{1,2}, \d{4}) through (\w+ \d{1,2}, \d{4})/
  );
  if (!dateRangeMatch) {
    console.error(`  ✗ Could not find date range in: ${filePath}`);
    return [];
  }
  const statementYear = new Date(dateRangeMatch[2]).getFullYear();

  // Parse deposits
  const depositSections = text.match(
    /\*start\*deposits and additions[\s\S]*?\*end\*deposits and additions/g
  );
  if (depositSections) {
    for (const section of depositSections) {
      parseDepositSection(section, statementYear, transactions);
    }
  }

  // Parse electronic withdrawals
  const withdrawalSections = text.match(
    /\*start\*electronic withdrawal[\s\S]*?\*end\*electronic withdrawal/g
  );
  if (withdrawalSections) {
    for (const section of withdrawalSections) {
      parseWithdrawalSection(section, statementYear, transactions);
    }
  }

  return transactions;
}

function parseDepositSection(
  section: string,
  year: number,
  out: ParsedTransaction[]
) {
  // Split into individual entries by DATE pattern at start of line
  // Dates appear as MM/DD at start of line, followed by description block, then amount
  const lines = section.split("\n");
  let currentDate: string | null = null;
  let currentLines: string[] = [];
  let currentAmount: number | null = null;

  const flushEntry = () => {
    if (currentDate && currentLines.length > 0 && currentAmount !== null) {
      const fullDesc = currentLines.join(" ").trim();
      const source = extractDepositSource(fullDesc);
      const month = parseInt(currentDate.split("/")[0], 10);
      const day = parseInt(currentDate.split("/")[1], 10);
      const txDate = new Date(year, month - 1, day, 12, 0, 0);

      out.push({
        date: txDate,
        description: cleanDescription(fullDesc),
        amount: currentAmount,
        type: "deposit",
        source,
        accountType: "bank",
      });
    }
    currentLines = [];
    currentAmount = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (
      trimmed.startsWith("DEPOSITS AND ADDITIONS") ||
      trimmed.startsWith("DATE") ||
      trimmed.startsWith("DESCRIPTION") ||
      trimmed.startsWith("(continued)") ||
      trimmed.startsWith("AMOUNT") ||
      trimmed.startsWith("Total Deposits") ||
      trimmed.startsWith("*start*") ||
      trimmed.startsWith("*end*") ||
      trimmed.startsWith("Page ")
    )
      continue;

    // Check if this line starts with a date (MM/DD)
    const dateMatch = trimmed.match(/^(\d{2}\/\d{2})\s/);
    if (dateMatch) {
      flushEntry();
      currentDate = dateMatch[1];
      // Rest of line after date
      const rest = trimmed.slice(dateMatch[0].length).trim();

      // Check if it contains an amount at the end (with or without $)
      const amtMatch = rest.match(/\$?([\d,]+\.\d{2})$/);
      if (amtMatch) {
        currentAmount = parseFloat(amtMatch[1].replace(/,/g, ""));
        const descPart = rest.slice(0, rest.length - amtMatch[0].length).trim();
        if (descPart) currentLines.push(descPart);
      } else {
        if (rest) currentLines.push(rest);
      }
    } else {
      // Continuation line — check for amount
      const amtMatch = trimmed.match(/^\$?([\d,]+\.\d{2})$/);
      if (amtMatch && currentAmount === null) {
        currentAmount = parseFloat(amtMatch[1].replace(/,/g, ""));
      } else {
        currentLines.push(trimmed);
      }
    }
  }
  flushEntry();
}

function parseWithdrawalSection(
  section: string,
  year: number,
  out: ParsedTransaction[]
) {
  const lines = section.split("\n");
  let currentDate: string | null = null;
  let currentLines: string[] = [];
  let currentAmount: number | null = null;

  const flushEntry = () => {
    if (currentDate && currentLines.length > 0 && currentAmount !== null) {
      const fullDesc = currentLines.join(" ").trim();
      const source = extractWithdrawalSource(fullDesc);
      const month = parseInt(currentDate.split("/")[0], 10);
      const day = parseInt(currentDate.split("/")[1], 10);
      const txDate = new Date(year, month - 1, day, 12, 0, 0);

      out.push({
        date: txDate,
        description: cleanDescription(fullDesc),
        amount: currentAmount,
        type: "withdrawal",
        source,
        accountType: "bank",
      });
    }
    currentLines = [];
    currentAmount = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (
      trimmed.startsWith("ELECTRONIC WITHDRAWALS") ||
      trimmed.startsWith("DATE") ||
      trimmed.startsWith("DESCRIPTION") ||
      trimmed.startsWith("(continued)") ||
      trimmed.startsWith("AMOUNT") ||
      trimmed.startsWith("Total Electronic") ||
      trimmed.startsWith("*start*") ||
      trimmed.startsWith("*end*") ||
      trimmed.startsWith("Page ")
    )
      continue;

    const dateMatch = trimmed.match(/^(\d{2}\/\d{2})\s/);
    if (dateMatch) {
      flushEntry();
      currentDate = dateMatch[1];
      const rest = trimmed.slice(dateMatch[0].length).trim();

      const amtMatch = rest.match(/\$?([\d,]+\.\d{2})$/);
      if (amtMatch) {
        currentAmount = parseFloat(amtMatch[1].replace(/,/g, ""));
        const descPart = rest.slice(0, rest.length - amtMatch[0].length).trim();
        if (descPart) currentLines.push(descPart);
      } else {
        if (rest) currentLines.push(rest);
      }
    } else {
      const amtMatch = trimmed.match(/^\$?([\d,]+\.\d{2})$/);
      if (amtMatch && currentAmount === null) {
        currentAmount = parseFloat(amtMatch[1].replace(/,/g, ""));
      } else {
        currentLines.push(trimmed);
      }
    }
  }
  flushEntry();
}

// ── Credit card statement parser ───────────────────────────────

function parseCreditCardStatement(
  text: string,
  filePath: string
): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];

  // Extract statement period
  const periodMatch = text.match(
    /Opening\/Closing Date\s+(\d{2}\/\d{2}\/\d{2})\s*-\s*(\d{2}\/\d{2}\/\d{2})/
  );
  if (!periodMatch) {
    console.error(`  ✗ Could not find statement period in: ${filePath}`);
    return [];
  }

  const closingDate = parseShortDate(periodMatch[2]);
  const closingYear = closingDate.getFullYear();
  const closingMonth = closingDate.getMonth();

  // Find ACCOUNT ACTIVITY section
  const activityMatch = text.match(
    /ACCOUNT ACTIVITY[\s\S]*?(?:2\d{3} Totals Year-to-Date|INTEREST CHARGES|Page \d+ of \d+)/
  );
  if (!activityMatch) {
    console.error(`  ✗ Could not find ACCOUNT ACTIVITY in: ${filePath}`);
    return [];
  }

  const activityText = activityMatch[0];
  const lines = activityText.split("\n");

  let currentCardHolder = "Primary";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect cardholder name sections
    if (trimmed.match(/^[A-Z]+ [A-Z]+$/) && !trimmed.match(/ACCOUNT|ACTIVITY|TRANSACTION/)) {
      currentCardHolder = trimmed;
      continue;
    }

    // Skip headers and summary lines
    if (
      trimmed.startsWith("ACCOUNT ACTIVITY") ||
      trimmed.startsWith("Date of") ||
      trimmed.startsWith("Merchant Name") ||
      trimmed.startsWith("Transaction") ||
      trimmed.startsWith("$ Amount") ||
      trimmed.startsWith("TRANSACTIONS THIS") ||
      trimmed.match(/^\d{4} Totals/) ||
      trimmed.startsWith("Total fees") ||
      trimmed.startsWith("Total interest") ||
      trimmed.startsWith("Year-to-date") ||
      trimmed.startsWith("INTEREST CHARGES") ||
      trimmed.startsWith("Page ")
    )
      continue;

    // Match transaction lines: MM/DD  description  [-]amount
    const txMatch = trimmed.match(
      /^(\d{2}\/\d{2})\s+(.+?)\s+([-]?[\d,]+\.\d{2})$/
    );
    if (txMatch) {
      const [, dateStr, desc, amtStr] = txMatch;
      const amount = parseFloat(amtStr.replace(/,/g, ""));
      const month = parseInt(dateStr.split("/")[0], 10);
      const day = parseInt(dateStr.split("/")[1], 10);

      // Determine year: if month > closing month, it's the prior year
      let txYear = closingYear;
      if (month > closingMonth + 1) {
        txYear = closingYear - 1;
      }
      // Edge case: closing is in January (month=0), tx in December
      if (closingMonth === 0 && month === 12) {
        txYear = closingYear - 1;
      }

      const txDate = new Date(txYear, month - 1, day, 12, 0, 0);

      let type: ParsedTransaction["type"];
      if (desc.includes("AUTOMATIC PAYMENT") || desc.includes("PAYMENT -")) {
        type = "credit_payment";
      } else if (amount < 0) {
        type = "credit_refund";
      } else {
        type = "credit_purchase";
      }

      transactions.push({
        date: txDate,
        description: desc.trim(),
        amount: Math.abs(amount),
        type,
        source: extractCreditSource(desc),
        accountType: "credit",
        cardHolder: currentCardHolder,
      });
    }
  }

  return transactions;
}

function parseShortDate(s: string): Date {
  // MM/DD/YY
  const [m, d, y] = s.split("/").map(Number);
  return new Date(2000 + y, m - 1, d);
}

// ── Source extraction helpers ──────────────────────────────────

function extractDepositSource(desc: string): string {
  if (/Square Inc/i.test(desc)) return "Square";
  if (/Grubhub/i.test(desc)) return "Grubhub";
  if (/DoorDash/i.test(desc)) return "DoorDash";
  if (/Uber/i.test(desc)) return "UberEats";
  if (/Stripe/i.test(desc)) return "Stripe";
  return "Other";
}

function extractWithdrawalSource(desc: string): string {
  if (/Zelle/i.test(desc)) return "Zelle";
  if (/Con Ed/i.test(desc)) return "Con Edison";
  if (/Hartford/i.test(desc)) return "Hartford Insurance";
  if (/Chase Credit Crd|Payment To Chase Card/i.test(desc)) return "Chase Credit Card Payment";
  if (/1654 Third Avenu/i.test(desc)) return "Rent";
  if (/Verizon/i.test(desc)) return "Verizon";
  if (/JPMorgan Chase|Ext Trnsf/i.test(desc)) return "JPMorgan Transfer";
  if (/Hiscox/i.test(desc)) return "Hiscox Insurance";
  if (/Internal Revenue|IRS|Fed Tax/i.test(desc)) return "IRS";
  if (/NY State|NYS DTF/i.test(desc)) return "NY State Tax";
  return "Other";
}

function extractCreditSource(desc: string): string {
  if (/AUTOMATIC PAYMENT/i.test(desc)) return "Chase Credit Card Payment";
  // Insurance
  if (/UTICA FIRST/i.test(desc)) return "Utica First Insurance";
  if (/NEXT INSUR/i.test(desc)) return "Next Insurance";
  if (/HISCOX/i.test(desc)) return "Hiscox Insurance";
  // Groceries / wholesale
  if (/WEGMANS/i.test(desc)) return "Wegmans";
  if (/COSTCO/i.test(desc)) return "Costco";
  if (/MR MANGO/i.test(desc)) return "Mr Mango";
  if (/JETRO/i.test(desc)) return "Jetro Cash & Carry";
  if (/RESTAURANT DEPOT|RESTAURANT CITY/i.test(desc)) return "Restaurant Depot";
  if (/KEY FOOD/i.test(desc)) return "Key Food";
  if (/WHOLEFDS|WHOLE FOODS/i.test(desc)) return "Whole Foods";
  if (/FINE FARE/i.test(desc)) return "Fine Fare";
  if (/FOOD FOR HEALTH/i.test(desc)) return "Food For Health";
  if (/ONLY FRESH/i.test(desc)) return "Only Fresh Produce";
  if (/C TOWN/i.test(desc)) return "C-Town";
  if (/PRIME GOURMET/i.test(desc)) return "Prime Gourmet";
  if (/FAIRWAY/i.test(desc)) return "Fairway Market";
  if (/GOLD LABEL/i.test(desc)) return "Gold Label";
  // Shopping / supplies
  if (/AMAZON|AMZN/i.test(desc)) return "Amazon";
  if (/TEMU/i.test(desc)) return "Temu";
  if (/ETSY/i.test(desc)) return "Etsy";
  if (/HOME DEPOT/i.test(desc)) return "Home Depot";
  if (/HOMEGOODS/i.test(desc)) return "HomeGoods";
  if (/IKEA/i.test(desc)) return "IKEA";
  if (/STAPLES/i.test(desc)) return "Staples";
  if (/MARSHALLS/i.test(desc)) return "Marshalls";
  if (/TARGET/i.test(desc)) return "Target";
  if (/HARDWARE/i.test(desc)) return "Hardware Store";
  if (/SUPPLYHOUSE/i.test(desc)) return "SupplyHouse";
  if (/MICHAELS/i.test(desc)) return "Michaels";
  if (/ECARD SYSTEMS/i.test(desc)) return "eCard Systems";
  if (/NEW EURO DESIGN/i.test(desc)) return "New Euro Design Kitchen";
  // Ads / marketing
  if (/GOOGLE.*ADS|GOOGLE \*ADS/i.test(desc)) return "Google Ads";
  if (/FACEBK|FACEBOOK/i.test(desc)) return "Facebook Ads";
  if (/YELP/i.test(desc)) return "Yelp Ads";
  if (/VISTAPRINT/i.test(desc)) return "Vistaprint";
  if (/MOBY SCHOOL/i.test(desc)) return "Moby School Sponsorship";
  // Telecom
  if (/VERIZON/i.test(desc)) return "Verizon";
  // Security
  if (/RING\b/i.test(desc)) return "Ring Security";
  // Software
  if (/SQUARESPACE|SQSP/i.test(desc)) return "Squarespace";
  if (/ROCKET MONEY/i.test(desc)) return "Rocket Money";
  // Permits
  if (/DOHMH|LIC\/PRMT/i.test(desc)) return "NYC Permits";
  if (/NYS DOS CORP/i.test(desc)) return "NYS Corp Filing";
  // Taxes
  if (/TAXACT/i.test(desc)) return "TaxAct";
  if (/NYC DEPT OF FINA/i.test(desc)) return "NYC Tax Payment";
  // Transport
  if (/MTA\b/i.test(desc)) return "MTA Transit";
  if (/TFL TRAVEL/i.test(desc)) return "London Transit";
  if (/METROPOLIS PARKING/i.test(desc)) return "Parking";
  // Services
  if (/FEDEX/i.test(desc)) return "FedEx";
  if (/CVS/i.test(desc)) return "CVS Pharmacy";
  if (/DUANE READE/i.test(desc)) return "Duane Reade";
  // Dining
  if (/STARBUCKS/i.test(desc)) return "Starbucks";
  if (/DAILYFISH/i.test(desc)) return "DailyFish";
  // Misc
  if (/FOREIGN TRANSACTION FEE/i.test(desc)) return "Foreign Transaction Fee";
  if (/TIKTOK/i.test(desc)) return "TikTok Shop";
  return desc.split(/\s{2,}/)[0].trim();
}

function cleanDescription(desc: string): string {
  // Remove trace numbers, IDs, and other noise
  return desc
    .replace(/Sec:CCD|Sec:PPD|Sec:Web/g, "")
    .replace(/Orig ID:\S+/g, "")
    .replace(/Desc Date:\S+/g, "")
    .replace(/CO Entry/g, "")
    .replace(/Trace#:\S+/g, "")
    .replace(/Eed:\S+/g, "")
    .replace(/Ind ID:\S*/g, "")
    .replace(/Ind Name:\S.*/g, "")
    .replace(/Trn: \S+/g, "")
    .replace(/T\d{7}/g, "")
    .replace(/ID:\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Categorization ─────────────────────────────────────────────

function categorizeExpense(desc: string, source: string): string {
  const d = desc.toUpperCase();
  const s = source.toUpperCase();

  // Rent
  if (s === "RENT" || d.includes("1654 THIRD")) return "Rent";

  // Internal transfers (credit card payments, bank transfers)
  if (s === "CHASE CREDIT CARD PAYMENT" || s === "JPMORGAN TRANSFER") return "Internal Transfer";

  // Taxes
  if (/NYS DTF|NY STATE TAX|IRS|FED TAX|INTERNAL REVENUE/i.test(s)) return "Taxes";
  if (/TAXACT/i.test(s)) return "Taxes";
  if (/NYC TAX PAYMENT/i.test(s)) return "Taxes";
  if (d.includes("NYS DTF") || d.includes("NTS DTF") || d.includes("TAX PAYMNTSEC")) return "Taxes";
  if (d.includes("NY DESCR:WEB PMTS")) return "Taxes";

  // Insurance
  if (/HARTFORD|UTICA FIRST|NEXT INSUR|HISCOX/i.test(s)) return "Insurance";
  if (d.includes("HARTFORD") || d.includes("UTICA FIRST") || d.includes("NEXT INSUR") || d.includes("HISCOX")) return "Insurance";

  // Payroll / Labor (harmonize with existing "Salary" category)
  if (s === "ZELLE" || d.includes("ZELLE")) return "Salary";

  // Utilities (harmonize with existing "Bills & Utilities" category)
  if (s === "CON EDISON" || d.includes("CON ED")) return "Bills & Utilities";
  if (s === "VERIZON" || d.includes("VERIZON")) return "Bills & Utilities";

  // Groceries (harmonize with existing "Groceries" category)
  if (/WEGMANS|COSTCO|MR MANGO|JETRO|RESTAURANT DEPOT|KEY FOOD|WHOLE FOODS|FINE FARE|FOOD FOR HEALTH|ONLY FRESH|C-TOWN|PRIME GOURMET|FAIRWAY|GOLD LABEL/i.test(s)) return "Groceries";
  if (d.includes("WEGMANS") || d.includes("COSTCO") || d.includes("JETRO") || d.includes("RESTAURANT DEPOT") || d.includes("RESTAURANT CITY") || d.includes("KEY FOOD") || d.includes("WHOLEFDS") || d.includes("WHOLE FOODS") || d.includes("FINE FARE")) return "Groceries";

  // Shopping / Supplies (harmonize with existing "Shopping" category)
  if (/AMAZON|TEMU|ETSY|HOME DEPOT|HOMEGOODS|IKEA|STAPLES|MARSHALLS|TARGET|HARDWARE|SUPPLYHOUSE|MICHAELS|ECARD SYSTEMS|TIKTOK SHOP/i.test(s)) return "Shopping";
  if (d.includes("AMAZON") || d.includes("AMZN") || d.includes("TEMU")) return "Shopping";

  // Construction / Equipment
  if (/NEW EURO DESIGN/i.test(s)) return "Construction";

  // Ads / Marketing
  if (/GOOGLE ADS|FACEBOOK ADS|YELP ADS|VISTAPRINT|MOBY SCHOOL/i.test(s)) return "Ads";
  if (d.includes("GOOGLE") && d.includes("ADS")) return "Ads";
  if (d.includes("FACEBK") || d.includes("FACEBOOK")) return "Ads";
  if (d.includes("YELP")) return "Ads";
  if (d.includes("VISTAPRINT")) return "Ads";

  // Security
  if (/RING SECURITY/i.test(s)) return "Security";
  if (d.includes("RING PRO") || d.includes("RING PREMIUM") || d.includes("SP RING USA")) return "Security";

  // Software & Tech
  if (/SQUARESPACE|ROCKET MONEY/i.test(s)) return "Software & Tech";

  // Permits & Licenses (harmonize with existing "Permits" category)
  if (/NYC PERMITS|NYS CORP FILING/i.test(s)) return "Permits";
  if (d.includes("DOHMH") || d.includes("LIC/PRMT") || d.includes("NYS DOS CORP")) return "Permits";

  // Transport
  if (/MTA TRANSIT|LONDON TRANSIT|PARKING/i.test(s)) return "Auto & Transport";
  if (d.includes("MTA")) return "Auto & Transport";

  // Fees
  if (/FOREIGN TRANSACTION FEE/i.test(s)) return "Fees";

  // Dining
  if (/STARBUCKS|DAILYFISH/i.test(s)) return "Dining & Drinks";

  // Drugstore / Pharmacy → Shopping
  if (/CVS|DUANE READE/i.test(s)) return "Shopping";

  // Services
  if (/FEDEX/i.test(s)) return "Shopping";

  return "Other";
}

// ── Main import logic ──────────────────────────────────────────

async function importStatements() {
  const baseDir = path.join(
    process.cwd(),
    "Data Exports",
    "Chase Statements"
  );

  if (!fs.existsSync(baseDir)) {
    console.error("Chase Statements folder not found at:", baseDir);
    process.exit(1);
  }

  // Collect all PDFs
  const bankPdfs: string[] = [];
  const creditPdfs: string[] = [];

  for (const yearDir of fs.readdirSync(baseDir).sort()) {
    const yearPath = path.join(baseDir, yearDir);
    if (!fs.statSync(yearPath).isDirectory()) continue;

    for (const typeDir of fs.readdirSync(yearPath)) {
      const typePath = path.join(yearPath, typeDir);
      if (!fs.statSync(typePath).isDirectory()) continue;

      const isBankDir = typeDir.trim().toLowerCase().startsWith("bank");
      const isCreditDir = typeDir.trim().toLowerCase().startsWith("credit");

      for (const file of fs.readdirSync(typePath).sort()) {
        if (!file.endsWith(".pdf")) continue;
        const filePath = path.join(typePath, file);
        if (isBankDir) bankPdfs.push(filePath);
        else if (isCreditDir) creditPdfs.push(filePath);
      }
    }
  }

  console.log(
    `Found ${bankPdfs.length} bank statements and ${creditPdfs.length} credit card statements\n`
  );

  // Parse all statements
  const allTransactions: ParsedTransaction[] = [];

  console.log("── Parsing Bank Statements ──");
  for (const pdf of bankPdfs) {
    const shortName = pdf.split("Chase Statements/")[1];
    process.stdout.write(`  ${shortName}... `);
    const text = extractPdfText(pdf);
    if (!text) continue;
    const txns = parseBankStatement(text, pdf);
    console.log(`${txns.length} transactions`);
    allTransactions.push(...txns);
  }

  console.log("\n── Parsing Credit Card Statements ──");
  for (const pdf of creditPdfs) {
    const shortName = pdf.split("Chase Statements/")[1];
    process.stdout.write(`  ${shortName}... `);
    const text = extractPdfText(pdf);
    if (!text) continue;
    const txns = parseCreditCardStatement(text, pdf);
    console.log(`${txns.length} transactions`);
    allTransactions.push(...txns);
  }

  // Summary before import
  const deposits = allTransactions.filter((t) => t.type === "deposit");
  const withdrawals = allTransactions.filter((t) => t.type === "withdrawal");
  const ccPurchases = allTransactions.filter((t) => t.type === "credit_purchase");
  const ccPayments = allTransactions.filter((t) => t.type === "credit_payment");
  const ccRefunds = allTransactions.filter((t) => t.type === "credit_refund");

  console.log("\n── Parsed Summary ──");
  console.log(`  Bank deposits:       ${deposits.length} (${fmt(deposits.reduce((s, t) => s + t.amount, 0))})`);
  console.log(`  Bank withdrawals:    ${withdrawals.length} (${fmt(withdrawals.reduce((s, t) => s + t.amount, 0))})`);
  console.log(`  CC purchases:        ${ccPurchases.length} (${fmt(ccPurchases.reduce((s, t) => s + t.amount, 0))})`);
  console.log(`  CC payments:         ${ccPayments.length} (${fmt(ccPayments.reduce((s, t) => s + t.amount, 0))})`);
  console.log(`  CC refunds:          ${ccRefunds.length} (${fmt(ccRefunds.reduce((s, t) => s + t.amount, 0))})`);
  console.log(`  Total:               ${allTransactions.length}`);

  // Deposit sources
  console.log("\n── Deposit Sources ──");
  const depositBySrc: Record<string, { count: number; total: number }> = {};
  for (const d of deposits) {
    if (!depositBySrc[d.source]) depositBySrc[d.source] = { count: 0, total: 0 };
    depositBySrc[d.source].count++;
    depositBySrc[d.source].total += d.amount;
  }
  for (const [src, data] of Object.entries(depositBySrc).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${src.padEnd(20)} ${String(data.count).padStart(5)} txns  ${fmt(data.total).padStart(12)}`);
  }

  // Expense categories
  console.log("\n── Expense Categories ──");
  const expensesByCat: Record<string, { count: number; total: number }> = {};
  const expenseTxns = [...withdrawals, ...ccPurchases];
  for (const t of expenseTxns) {
    const cat = categorizeExpense(t.description, t.source);
    if (!expensesByCat[cat]) expensesByCat[cat] = { count: 0, total: 0 };
    expensesByCat[cat].count++;
    expensesByCat[cat].total += t.amount;
  }
  for (const [cat, data] of Object.entries(expensesByCat).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${cat.padEnd(25)} ${String(data.count).padStart(5)} txns  ${fmt(data.total).padStart(12)}`);
  }

  // ── Database Import ──

  console.log("\n── Importing to Database ──");

  // Create import record
  const importRecord = await prisma.import.create({
    data: {
      id: randomUUID(),
      source: "chase-statements",
      fileName: "Chase Statements PDFs (2023-2025)",
      status: "processing",
      rowsProcessed: 0,
    },
  });

  let bankTxCount = 0;
  let expenseCount = 0;
  let skippedInternal = 0;

  // Deduplicate: check for existing bank transactions within ±1 day and same amount
  const existingBankTxns = await prisma.bankTransaction.findMany({
    select: { date: true, amount: true, description: true },
  });
  const existingKey = new Set(
    existingBankTxns.map(
      (t) =>
        `${t.date.toISOString().slice(0, 10)}|${t.amount.toFixed(2)}|${t.description?.slice(0, 30)}`
    )
  );

  // Import bank transactions (deposits + withdrawals)
  for (const tx of [...deposits, ...withdrawals]) {
    const key = `${tx.date.toISOString().slice(0, 10)}|${(tx.type === "withdrawal" ? -tx.amount : tx.amount).toFixed(2)}|${tx.description.slice(0, 30)}`;
    if (existingKey.has(key)) continue;

    const amount = tx.type === "withdrawal" ? -tx.amount : tx.amount;

    await prisma.bankTransaction.create({
      data: {
        id: randomUUID(),
        date: tx.date,
        description: tx.description,
        amount,
        category: tx.type === "deposit" ? `Deposit - ${tx.source}` : categorizeExpense(tx.description, tx.source),
        accountType: "Cash",
        accountName: "BUS COMPLETE CHK",
        institutionName: "Chase",
        importId: importRecord.id,
      },
    });
    bankTxCount++;
  }

  // Import expenses (withdrawals that are real expenses + credit card purchases)
  for (const tx of expenseTxns) {
    const category = categorizeExpense(tx.description, tx.source);

    // Skip internal transfers (credit card payments from bank to CC)
    if (category === "Internal Transfer") {
      skippedInternal++;
      continue;
    }

    // Find or create vendor
    const vendorName = tx.source !== "Other" ? tx.source : tx.description.split(/\s{2,}/)[0].slice(0, 50);
    let vendor = await prisma.vendor.findFirst({
      where: { name: vendorName },
    });
    if (!vendor) {
      vendor = await prisma.vendor.create({
        data: {
          id: randomUUID(),
          name: vendorName,
          category,
        },
      });
    }

    await prisma.expense.create({
      data: {
        id: randomUUID(),
        vendorId: vendor.id,
        amount: tx.amount,
        date: tx.date,
        category,
        paymentMethod: tx.accountType === "bank" ? "ACH" : "Credit Card",
        notes: tx.description,
        importId: importRecord.id,
      },
    });
    expenseCount++;
  }

  // Import credit card refunds as negative expenses
  for (const tx of ccRefunds) {
    const vendorName = tx.source !== "Other" ? tx.source : tx.description.split(/\s{2,}/)[0].slice(0, 50);
    let vendor = await prisma.vendor.findFirst({ where: { name: vendorName } });
    if (!vendor) {
      vendor = await prisma.vendor.create({
        data: { id: randomUUID(), name: vendorName, category: "Refund" },
      });
    }

    await prisma.expense.create({
      data: {
        id: randomUUID(),
        vendorId: vendor.id,
        amount: -tx.amount,
        date: tx.date,
        category: "Refund",
        paymentMethod: "Credit Card",
        notes: tx.description,
        importId: importRecord.id,
      },
    });
    expenseCount++;
  }

  // Also create Transaction records for bank deposits (so they appear as income in the dashboard)
  // These are payouts from platforms — don't duplicate if already imported from CSVs
  // Only import deposits that aren't already tracked as platform payouts
  let payoutTxCount = 0;
  for (const tx of deposits) {
    if (["Square", "Grubhub", "DoorDash", "UberEats"].includes(tx.source)) {
      // Create a payout transaction so reconciliation can work
      const existing = await prisma.transaction.findFirst({
        where: {
          type: "payout",
          sourcePlatform: tx.source.toLowerCase().replace("ubereats", "ubereats"),
          date: {
            gte: new Date(tx.date.getTime() - 86400000),
            lte: new Date(tx.date.getTime() + 86400000),
          },
          amount: { gte: tx.amount - 0.01, lte: tx.amount + 0.01 },
        },
      });
      if (!existing) {
        const platformKey = tx.source === "UberEats" ? "ubereats" :
          tx.source === "DoorDash" ? "doordash" :
          tx.source === "Grubhub" ? "grubhub" : "square";
        await prisma.transaction.create({
          data: {
            id: randomUUID(),
            date: tx.date,
            amount: tx.amount,
            type: "payout",
            sourcePlatform: platformKey,
            description: `${tx.source} payout deposited to Chase`,
            importId: importRecord.id,
          },
        });
        payoutTxCount++;
      }
    }
  }

  // Update import record
  await prisma.import.update({
    where: { id: importRecord.id },
    data: {
      status: "completed",
      rowsProcessed: bankTxCount + expenseCount + payoutTxCount,
    },
  });

  console.log(`\n── Import Complete ──`);
  console.log(`  Bank transactions:   ${bankTxCount}`);
  console.log(`  Expenses:            ${expenseCount}`);
  console.log(`  Payout transactions: ${payoutTxCount}`);
  console.log(`  Skipped (internal):  ${skippedInternal}`);
  console.log(`  Import ID:           ${importRecord.id}`);

  // ── Data Checks ──
  console.log("\n── Data Checks ──");
  await runDataChecks();
}

function fmt(n: number): string {
  return `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function runDataChecks() {
  // 1. Date range check
  const dateRange = await prisma.bankTransaction.aggregate({
    _min: { date: true },
    _max: { date: true },
    _count: true,
  });
  console.log(
    `  Bank transactions: ${dateRange._count} total, from ${dateRange._min.date?.toISOString().slice(0, 10)} to ${dateRange._max.date?.toISOString().slice(0, 10)}`
  );

  // 2. Expense date range
  const expRange = await prisma.expense.aggregate({
    _min: { date: true },
    _max: { date: true },
    _count: true,
  });
  console.log(
    `  Expenses:          ${expRange._count} total, from ${expRange._min.date?.toISOString().slice(0, 10)} to ${expRange._max.date?.toISOString().slice(0, 10)}`
  );

  // 3. Monthly bank deposit totals
  console.log("\n  Monthly bank deposits (from statements):");
  const monthlyDeposits = await prisma.$queryRawUnsafe<
    { month: string; total: number; cnt: number }[]
  >(
    `SELECT strftime('%Y-%m', date) as month, SUM(amount) as total, COUNT(*) as cnt
     FROM bank_transactions
     WHERE amount > 0 AND import_id IS NOT NULL
     GROUP BY strftime('%Y-%m', date)
     ORDER BY month DESC
     LIMIT 12`
  );
  for (const m of monthlyDeposits) {
    console.log(
      `    ${m.month}: ${fmt(Number(m.total)).padStart(12)} (${m.cnt} txns)`
    );
  }

  // 4. Monthly expense totals
  console.log("\n  Monthly expenses:");
  const monthlyExpenses = await prisma.$queryRawUnsafe<
    { month: string; total: number; cnt: number }[]
  >(
    `SELECT strftime('%Y-%m', date) as month, SUM(amount) as total, COUNT(*) as cnt
     FROM expenses
     WHERE amount > 0
     GROUP BY strftime('%Y-%m', date)
     ORDER BY month DESC
     LIMIT 12`
  );
  for (const m of monthlyExpenses) {
    console.log(
      `    ${m.month}: ${fmt(Number(m.total)).padStart(12)} (${m.cnt} txns)`
    );
  }

  // 5. Check for duplicates
  const dupes = await prisma.$queryRawUnsafe<{ cnt: number }[]>(
    `SELECT COUNT(*) as cnt FROM (
       SELECT date, amount, description, COUNT(*) as c
       FROM bank_transactions
       GROUP BY date, amount, description
       HAVING c > 1
     )`
  );
  const dupeCount = Number(dupes[0]?.cnt ?? 0);
  if (dupeCount > 0) {
    console.log(`\n  ⚠ ${dupeCount} potential duplicate bank transaction groups found`);
  } else {
    console.log(`\n  ✓ No duplicate bank transactions detected`);
  }

  // 6. Expense category breakdown
  console.log("\n  Expense category totals (all time):");
  const catTotals = await prisma.$queryRawUnsafe<
    { category: string; total: number; cnt: number }[]
  >(
    `SELECT category, SUM(amount) as total, COUNT(*) as cnt
     FROM expenses
     WHERE amount > 0
     GROUP BY category
     ORDER BY total DESC`
  );
  for (const c of catTotals) {
    console.log(
      `    ${(c.category || "Uncategorized").padEnd(25)} ${fmt(Number(c.total)).padStart(12)} (${c.cnt} txns)`
    );
  }
}

// ── Run ────────────────────────────────────────────────────────

importStatements()
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
