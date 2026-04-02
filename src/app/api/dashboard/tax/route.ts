/**
 * Tax Center API — Aggregates sales tax, expense deductions, and estimated payments.
 * Sources: sales.db (orders.tax, orders.gross_sales) + bank.db (rocketmoney expenses).
 */
import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import { resolveVendorCategory } from "@/lib/db/bank-db";
import { getAllCategoryIgnores } from "@/lib/db/config-db";
import { ensureBankView } from "@/lib/db/bank-db-setup";

const DB_DIR = path.join(process.cwd(), "databases");
function openDb(name: string) {
  return new Database(path.join(DB_DIR, name));
}

// Schedule C line mappings
const SCHEDULE_C_MAP: Record<string, { line: string; label: string }> = {
  "Marketing & Advertising": { line: "8", label: "Advertising" },
  "Fees & Charges": { line: "10", label: "Commissions & Fees" },
  "Insurance": { line: "15", label: "Insurance" },
  "Rent & Utilities": { line: "20b", label: "Rent" },
  "Groceries & Ingredients": { line: "25", label: "Supplies" },
  "Payroll & Salary": { line: "26", label: "Wages" },
  "Permits & Licenses": { line: "27a", label: "Other Expenses" },
  "Software & Tech": { line: "27a", label: "Other Expenses" },
  "Construction & Maintenance": { line: "21", label: "Repairs & Maintenance" },
  "Auto & Transport": { line: "9", label: "Car & Truck Expenses" },
  "Security": { line: "27a", label: "Other Expenses" },
  "Shopping": { line: "25", label: "Supplies" },
};

const PAYOUT_CATEGORIES = [
  "Square", "Square ", "GrubHub", "DOORDASH", "Uber Eats", "Credit Card Payment",
];

const QUARTER_DUE_DATES: Record<string, { month: number; day: number }> = {
  Q1: { month: 4, day: 15 },
  Q2: { month: 6, day: 15 },
  Q3: { month: 9, day: 15 },
  Q4: { month: 1, day: 15 }, // next year
};

function getQuarterLabel(month: number, year: number): string {
  const q = Math.ceil(month / 3);
  return `Q${q} ${year}`;
}

function getQuarterDates(q: number, year: number): { start: string; end: string } {
  const startMonth = (q - 1) * 3;
  const start = `${year}-${String(startMonth + 1).padStart(2, "0")}-01`;
  const endDate = new Date(year, startMonth + 3, 0);
  const end = `${year}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
  return { start, end };
}

function getQuarterDueDate(q: number, year: number): string {
  const key = `Q${q}` as keyof typeof QUARTER_DUE_DATES;
  const due = QUARTER_DUE_DATES[key];
  const dueYear = q === 4 ? year + 1 : year;
  return `${dueYear}-${String(due.month).padStart(2, "0")}-${String(due.day).padStart(2, "0")}`;
}

function getSalesTaxDueDate(year: number, month: number): string {
  // NYS monthly filer: due 20th of following month
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-20`;
}

function deadlineStatus(dueDate: string, today: string): "past" | "current" | "upcoming" {
  if (dueDate < today) return "past";
  const dueDateObj = new Date(dueDate + "T00:00:00");
  const todayObj = new Date(today + "T00:00:00");
  const daysUntil = Math.round((dueDateObj.getTime() - todayObj.getTime()) / 86_400_000);
  if (daysUntil <= 30) return "current";
  return "upcoming";
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const year = parseInt(searchParams.get("year") || String(now.getFullYear()));
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const salesDb = openDb("sales.db");
  const bankDb = openDb("bank.db");
  ensureBankView(bankDb);

  try {
    // ── Sales Tax: Annual ──
    const annualTax = salesDb.prepare(
      `SELECT ROUND(SUM(tax), 2) as collected, ROUND(SUM(gross_sales), 2) as grossSales, COUNT(*) as orders
       FROM orders WHERE order_status = 'completed' AND date >= ? AND date <= ?`
    ).get(yearStart, yearEnd) as { collected: number; grossSales: number; orders: number };

    // ── Sales Tax: Quarterly ──
    const quarterlyTax = [];
    for (let q = 1; q <= 4; q++) {
      const { start, end } = getQuarterDates(q, year);
      const row = salesDb.prepare(
        `SELECT ROUND(SUM(tax), 2) as collected, ROUND(SUM(gross_sales), 2) as grossSales, COUNT(*) as orders
         FROM orders WHERE order_status = 'completed' AND date >= ? AND date <= ?`
      ).get(start, end) as { collected: number; grossSales: number; orders: number };
      quarterlyTax.push({
        quarter: `Q${q} ${year}`,
        collected: row.collected || 0,
        grossSales: row.grossSales || 0,
        effectiveRate: row.grossSales > 0 ? Math.round((row.collected / row.grossSales) * 1000) / 10 : 0,
        orders: row.orders || 0,
        startDate: start,
        endDate: end,
        dueDate: getQuarterDueDate(q, year),
      });
    }

    // ── Sales Tax: Monthly ──
    const monthlyTax = salesDb.prepare(
      `SELECT strftime('%Y-%m', date) as month, ROUND(SUM(tax), 2) as collected, ROUND(SUM(gross_sales), 2) as grossSales
       FROM orders WHERE order_status = 'completed' AND date >= ? AND date <= ?
       GROUP BY strftime('%Y-%m', date) ORDER BY month`
    ).all(yearStart, yearEnd) as { month: string; collected: number; grossSales: number }[];

    // ── Sales Tax: By Platform ──
    const byPlatform = salesDb.prepare(
      `SELECT platform, ROUND(SUM(tax), 2) as collected, ROUND(SUM(gross_sales), 2) as grossSales
       FROM orders WHERE order_status = 'completed' AND date >= ? AND date <= ?
       GROUP BY platform ORDER BY grossSales DESC`
    ).all(yearStart, yearEnd) as { platform: string; collected: number; grossSales: number }[];

    // ── Revenue & Fees for profit calc ──
    const revenueRow = salesDb.prepare(
      `SELECT ROUND(SUM(gross_sales), 2) as gross, ROUND(SUM(ABS(fees_total)), 2) as fees
       FROM orders WHERE order_status = 'completed' AND date >= ? AND date <= ?`
    ).get(yearStart, yearEnd) as { gross: number; fees: number };

    // ── Expenses by category (from bank.db) ──
    const payoutPlaceholders = PAYOUT_CATEGORIES.map(() => "?").join(",");
    const ignoredCats = getAllCategoryIgnores();
    const ignoredSet = new Set(ignoredCats.map((ic) => ic.category_name.toLowerCase()));

    const allExpenses = bankDb.prepare(
      `SELECT name, custom_name, description, category, amount,
              COALESCE(display_vendor, COALESCE(NULLIF(custom_name, ''), name)) as display_vendor
       FROM all_bank_transactions
       WHERE CAST(amount AS REAL) > 0 AND category NOT IN (${payoutPlaceholders})
       AND category IS NOT NULL AND date >= ? AND date <= ?`
    ).all(...PAYOUT_CATEGORIES, yearStart, yearEnd) as {
      name: string; custom_name: string; description: string; category: string; amount: string; display_vendor: string;
    }[];

    const categoryTotals = new Map<string, number>();
    let totalExpenses = 0;
    for (const r of allExpenses) {
      const amt = parseFloat(r.amount) || 0;
      if (amt <= 0) continue;
      const vendorName = r.display_vendor || r.custom_name || r.name || "";
      const resolved = resolveVendorCategory(vendorName);
      const catName = resolved || r.category || "Uncategorized";
      if (ignoredSet.has(catName.toLowerCase())) continue;
      categoryTotals.set(catName, (categoryTotals.get(catName) || 0) + amt);
      totalExpenses += amt;
    }

    // ── Platform fees as deduction ──
    const platformFees = revenueRow.fees || 0;

    // ── Schedule C mapping ──
    const scheduleCLines = new Map<string, { line: string; label: string; categories: string[]; amount: number }>();

    // Add platform fees as Line 10
    scheduleCLines.set("10-fees", { line: "10", label: "Commissions & Fees", categories: ["Platform Fees"], amount: platformFees });

    for (const [cat, total] of categoryTotals.entries()) {
      const mapping = SCHEDULE_C_MAP[cat];
      const line = mapping?.line || "27a";
      const label = mapping?.label || "Other Expenses";
      const key = `${line}-${label}`;
      const existing = scheduleCLines.get(key);
      if (existing) {
        existing.amount += total;
        existing.categories.push(cat);
      } else {
        scheduleCLines.set(key, { line, label, categories: [cat], amount: total });
      }
    }

    const scheduleCSorted = [...scheduleCLines.values()]
      .map((s) => ({
        line: s.line,
        label: s.label,
        categories: s.categories,
        amount: Math.round(s.amount * 100) / 100,
      }))
      .sort((a, b) => {
        const lineA = parseFloat(a.line) || 99;
        const lineB = parseFloat(b.line) || 99;
        return lineA - lineB;
      });

    const totalDeductions = Math.round((totalExpenses + platformFees) * 100) / 100;

    // ── Estimated Tax ──
    const grossRevenue = revenueRow.gross || 0;
    const annualProfit = Math.max(0, grossRevenue - platformFees - totalExpenses);
    const seBase = annualProfit * 0.9235;
    const selfEmploymentTax = Math.round(seBase * 0.153 * 100) / 100;
    const taxableIncome = annualProfit - (selfEmploymentTax / 2);
    const estimatedIncomeTax = Math.round(Math.max(0, taxableIncome) * 0.22 * 100) / 100; // rough 22% bracket
    const totalEstimated = Math.round((selfEmploymentTax + estimatedIncomeTax) * 100) / 100;
    const quarterlyPayment = Math.round((totalEstimated / 4) * 100) / 100;

    const estPayments = [1, 2, 3, 4].map((q) => ({
      quarter: `Q${q}`,
      dueDate: getQuarterDueDate(q, year),
      amount: quarterlyPayment,
      status: deadlineStatus(getQuarterDueDate(q, year), today),
    }));

    // ── Tax Payments Made (from bank.db) ──
    const taxPayments = bankDb.prepare(
      `SELECT date, name, custom_name, description, amount,
              COALESCE(display_vendor, COALESCE(NULLIF(custom_name, ''), name)) as display_vendor
       FROM all_bank_transactions
       WHERE CAST(amount AS REAL) > 0 AND (category = 'Taxes' OR LOWER(name) LIKE '%tax%' OR LOWER(description) LIKE '%tax%')
       AND date >= ? AND date <= ?
       ORDER BY date DESC`
    ).all(yearStart, yearEnd) as {
      date: string; name: string; custom_name: string; description: string; amount: string; display_vendor: string;
    }[];

    const taxPaymentsMade = taxPayments.map((t) => ({
      date: t.date,
      description: t.display_vendor || t.custom_name || t.name || "",
      amount: Math.round(parseFloat(t.amount) * 100) / 100,
    }));
    const totalPaid = taxPaymentsMade.reduce((s, t) => s + t.amount, 0);

    // ── Filing Deadlines ──
    const deadlines: { type: string; period: string; dueDate: string; amount: number; status: string }[] = [];

    // NYS Sales Tax monthly deadlines
    for (let m = 1; m <= 12; m++) {
      const monthStr = `${year}-${String(m).padStart(2, "0")}`;
      const monthData = monthlyTax.find((mt) => mt.month === monthStr);
      const dueDate = getSalesTaxDueDate(year, m);
      if (monthData && monthData.collected > 0) {
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        deadlines.push({
          type: "NYS Sales Tax",
          period: `${monthNames[m - 1]} ${year}`,
          dueDate,
          amount: monthData.collected,
          status: deadlineStatus(dueDate, today),
        });
      }
    }

    // Federal estimated quarterly deadlines
    for (const ep of estPayments) {
      deadlines.push({
        type: "Federal Estimated",
        period: `${ep.quarter} ${year}`,
        dueDate: ep.dueDate,
        amount: ep.amount,
        status: ep.status as string,
      });
    }

    deadlines.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    // ── Available years ──
    const yearsRow = salesDb.prepare(
      `SELECT MIN(strftime('%Y', date)) as minY, MAX(strftime('%Y', date)) as maxY
       FROM orders WHERE order_status = 'completed'`
    ).get() as { minY: string; maxY: string };
    const minYear = parseInt(yearsRow.minY) || year;
    const maxYear = parseInt(yearsRow.maxY) || year;
    const availableYears = [];
    for (let y = maxYear; y >= minYear; y--) availableYears.push(y);

    return NextResponse.json({
      year,
      availableYears,

      salesTax: {
        annual: {
          collected: annualTax.collected || 0,
          orders: annualTax.orders || 0,
          grossSales: annualTax.grossSales || 0,
          effectiveRate: annualTax.grossSales > 0
            ? Math.round((annualTax.collected / annualTax.grossSales) * 1000) / 10
            : 0,
        },
        quarterly: quarterlyTax,
        monthly: monthlyTax.map((m) => ({
          month: m.month,
          collected: m.collected || 0,
          grossSales: m.grossSales || 0,
        })),
        byPlatform: byPlatform.map((p) => ({
          platform: p.platform,
          collected: p.collected || 0,
          grossSales: p.grossSales || 0,
          effectiveRate: p.grossSales > 0
            ? Math.round((p.collected / p.grossSales) * 1000) / 10
            : 0,
        })),
      },

      scheduleC: {
        totalDeductions,
        grossRevenue: Math.round(grossRevenue * 100) / 100,
        lines: scheduleCSorted,
      },

      estimatedTax: {
        annualProfit: Math.round(annualProfit * 100) / 100,
        selfEmploymentTax,
        estimatedIncomeTax,
        totalEstimated,
        quarterlyPayment,
        payments: estPayments,
      },

      taxPaymentsMade,
      totalPaid: Math.round(totalPaid * 100) / 100,
      balanceDue: Math.round((totalEstimated - totalPaid) * 100) / 100,

      deadlines,
    });
  } finally {
    salesDb.close();
    bankDb.close();
  }
}
