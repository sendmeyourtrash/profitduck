/**
 * Smart search parser — interprets user input into structured search criteria.
 *
 * Supports:
 *   "$45.99" or "45.99"       → exact amount match
 *   ">100" or "<50"           → amount comparison
 *   "100-500"                 → amount range
 *   "-500"                    → negative amount (exact)
 *   "3/22" or "03/22"         → date search (month/day of any year)
 *   "2025-03-22"              → exact date search
 *   Everything else           → text search across all fields
 */

export interface ParsedSearch {
  type: "text" | "amount_exact" | "amount_gt" | "amount_lt" | "amount_range" | "date";
  // Text search
  text?: string;
  // Amount search
  amount?: number;
  amountMin?: number;
  amountMax?: number;
  // Date search
  dateStr?: string; // YYYY-MM-DD or partial like %-03-22
}

export function parseSearch(input: string): ParsedSearch {
  const trimmed = input.trim();
  if (!trimmed) return { type: "text", text: "" };

  // --- Amount: "$45.99" or just "45.99" (but not if it looks like a date) ---
  const dollarMatch = trimmed.match(/^\$?([\d,]+\.?\d*)$/);
  if (dollarMatch) {
    const amount = parseFloat(dollarMatch[1].replace(/,/g, ""));
    if (!isNaN(amount)) return { type: "amount_exact", amount };
  }

  // --- Amount: negative "-500" or "-$500" (not a range) ---
  const negMatch = trimmed.match(/^-\$?([\d,]+\.?\d*)$/);
  if (negMatch) {
    const amount = -parseFloat(negMatch[1].replace(/,/g, ""));
    if (!isNaN(amount)) return { type: "amount_exact", amount };
  }

  // --- Amount comparison: ">100" or "<50" or ">=100" or "<=50" ---
  const gtMatch = trimmed.match(/^>\s*\$?([\d,]+\.?\d*)$/);
  if (gtMatch) {
    const amount = parseFloat(gtMatch[1].replace(/,/g, ""));
    if (!isNaN(amount)) return { type: "amount_gt", amount };
  }
  const gteMatch = trimmed.match(/^>=\s*\$?([\d,]+\.?\d*)$/);
  if (gteMatch) {
    const amount = parseFloat(gteMatch[1].replace(/,/g, ""));
    if (!isNaN(amount)) return { type: "amount_gt", amount };
  }
  const ltMatch = trimmed.match(/^<\s*\$?([\d,]+\.?\d*)$/);
  if (ltMatch) {
    const amount = parseFloat(ltMatch[1].replace(/,/g, ""));
    if (!isNaN(amount)) return { type: "amount_lt", amount };
  }
  const lteMatch = trimmed.match(/^<=\s*\$?([\d,]+\.?\d*)$/);
  if (lteMatch) {
    const amount = parseFloat(lteMatch[1].replace(/,/g, ""));
    if (!isNaN(amount)) return { type: "amount_lt", amount };
  }

  // --- Amount range: "100-500" or "$100-$500" (not a date like 2025-03) ---
  const rangeMatch = trimmed.match(/^\$?([\d,]+\.?\d*)\s*[-–]\s*\$?([\d,]+\.?\d*)$/);
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1].replace(/,/g, ""));
    const max = parseFloat(rangeMatch[2].replace(/,/g, ""));
    if (!isNaN(min) && !isNaN(max) && max > min) {
      return { type: "amount_range", amountMin: min, amountMax: max };
    }
  }

  // --- Date: "3/22" or "03/22" (month/day) ---
  const mdMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (mdMatch) {
    const m = mdMatch[1].padStart(2, "0");
    const d = mdMatch[2].padStart(2, "0");
    return { type: "date", dateStr: `%-${m}-${d}` };
  }

  // --- Date: "3/22/2025" or "03/22/2025" (full date) ---
  const mdyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdyMatch) {
    const m = mdyMatch[1].padStart(2, "0");
    const d = mdyMatch[2].padStart(2, "0");
    const y = mdyMatch[3].length === 2 ? `20${mdyMatch[3]}` : mdyMatch[3];
    return { type: "date", dateStr: `${y}-${m}-${d}` };
  }

  // --- Date: "2025-03-22" (ISO) ---
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return { type: "date", dateStr: trimmed };
  }

  // --- Fallback: text search ---
  return { type: "text", text: trimmed };
}

/**
 * Build SQL conditions for the parsed search (for sales.db orders table).
 * Returns { conditions: string[], params: (string|number)[] }
 */
export function buildSalesSearchSQL(parsed: ParsedSearch): { conditions: string[]; params: (string | number)[] } {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  switch (parsed.type) {
    case "amount_exact": {
      // Match gross_sales, net_sales, fees_total, tax, or tip within $0.01 tolerance
      const amt = parsed.amount!;
      const absAmt = Math.abs(amt);
      conditions.push("(ABS(gross_sales - ?) < 0.015 OR ABS(ABS(net_sales) - ?) < 0.015 OR ABS(ABS(fees_total) - ?) < 0.015 OR ABS(tax - ?) < 0.015 OR ABS(tip - ?) < 0.015)");
      params.push(absAmt, absAmt, absAmt, absAmt, absAmt);
      break;
    }
    case "amount_gt":
      conditions.push("gross_sales > ?");
      params.push(parsed.amount!);
      break;
    case "amount_lt":
      conditions.push("gross_sales < ?");
      params.push(parsed.amount!);
      break;
    case "amount_range":
      conditions.push("gross_sales >= ? AND gross_sales <= ?");
      params.push(parsed.amountMin!, parsed.amountMax!);
      break;
    case "date":
      conditions.push("date LIKE ?");
      params.push(parsed.dateStr!);
      break;
    case "text":
    default:
      if (parsed.text) {
        const term = `%${parsed.text}%`;
        conditions.push("(items LIKE ? OR order_id LIKE ? OR customer_name LIKE ? OR payment_method LIKE ? OR platform LIKE ? OR order_status LIKE ? OR dining_option LIKE ?)");
        params.push(term, term, term, term, term, term, term);
      }
      break;
  }

  return { conditions, params };
}

/**
 * Build SQL conditions for the parsed search (for bank.db rocketmoney table).
 * Returns { conditions: string[], params: (string|number)[] }
 */
export function buildBankSearchSQL(parsed: ParsedSearch): { conditions: string[]; params: (string | number)[] } {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  switch (parsed.type) {
    case "amount_exact": {
      const absAmt = Math.abs(parsed.amount!);
      // Bank amounts can be positive or negative — use tolerance for float comparison
      conditions.push("(ABS(ABS(CAST(amount AS REAL)) - ?) < 0.015)");
      params.push(absAmt);
      break;
    }
    case "amount_gt":
      conditions.push("ABS(CAST(amount AS REAL)) > ?");
      params.push(parsed.amount!);
      break;
    case "amount_lt":
      conditions.push("ABS(CAST(amount AS REAL)) < ?");
      params.push(parsed.amount!);
      break;
    case "amount_range":
      conditions.push("ABS(CAST(amount AS REAL)) >= ? AND ABS(CAST(amount AS REAL)) <= ?");
      params.push(parsed.amountMin!, parsed.amountMax!);
      break;
    case "date":
      conditions.push("date LIKE ?");
      params.push(parsed.dateStr!);
      break;
    case "text":
    default:
      if (parsed.text) {
        const term = `%${parsed.text}%`;
        conditions.push("(name LIKE ? OR description LIKE ? OR custom_name LIKE ? OR category LIKE ? OR account_name LIKE ? OR note LIKE ?)");
        params.push(term, term, term, term, term, term);
      }
      break;
  }

  return { conditions, params };
}
