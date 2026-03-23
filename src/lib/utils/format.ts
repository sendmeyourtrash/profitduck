/**
 * Format a number as USD currency.
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

/**
 * Format a Date or ISO string as a short date (e.g., "Mar 12, 2026").
 */
export function formatDate(date: Date | string): string {
  const raw = typeof date === "string" ? date : date.toISOString();
  // Date-only strings ("2026-03-22") are parsed as UTC midnight, which shifts
  // to the prior day in US timezones. Append T12:00:00 to keep the local date stable.
  const d = new Date(raw.length === 10 ? raw + "T12:00:00" : raw);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Format a Date or ISO string as a short date with time.
 */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Capitalize first letter.
 */
export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Safely parse a float from a string. Returns 0 for invalid values.
 */
export function safeFloat(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const str = String(value).replace(/[$,]/g, "").trim();
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

/**
 * Parse a date string in various formats. Returns null if unparseable.
 * NOTE: For date-only strings (no time), returns midnight UTC.
 * Use parseDateTime() when you have time/timezone info available.
 */
export function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const str = String(value).trim();
  if (!str) return null;

  // Try ISO format first
  const iso = new Date(str);
  if (!isNaN(iso.getTime())) return iso;

  // Try MM/DD/YYYY or M/D/YYYY
  const mdyMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdyMatch) {
    const [, m, d, y] = mdyMatch;
    const year = y.length === 2 ? 2000 + parseInt(y) : parseInt(y);
    return new Date(year, parseInt(m) - 1, parseInt(d));
  }

  return null;
}

/**
 * Map of common timezone names/abbreviations to UTC offset strings.
 * Square uses names like "Eastern Time (US & Canada)".
 * Grubhub uses IANA like "America/New_York".
 */
const TZ_OFFSETS: Record<string, string> = {
  // Standard names (from Square CSVs)
  "eastern time (us & canada)": "-05:00",
  "central time (us & canada)": "-06:00",
  "mountain time (us & canada)": "-07:00",
  "pacific time (us & canada)": "-08:00",
  // IANA zones (from Grubhub)
  "america/new_york": "-05:00",
  "america/chicago": "-06:00",
  "america/denver": "-07:00",
  "america/los_angeles": "-08:00",
  // Abbreviations
  est: "-05:00",
  edt: "-04:00",
  cst: "-06:00",
  cdt: "-05:00",
  mst: "-07:00",
  mdt: "-06:00",
  pst: "-08:00",
  pdt: "-07:00",
  utc: "+00:00",
  gmt: "+00:00",
};

/**
 * Resolve a timezone string to a UTC offset like "-05:00".
 * Falls back to "-05:00" (Eastern) for NYC-based business.
 */
function resolveTimezone(tz?: string | null): string {
  if (!tz) return "-05:00"; // Default to Eastern for NYC
  const normalized = tz.trim().toLowerCase();
  return TZ_OFFSETS[normalized] || "-05:00";
}

/**
 * Parse a date + time + timezone into a proper Date object.
 * Supports multiple formats from our CSV sources:
 *
 * - Square: date="2026-03-12", time="17:44:41", tz="Eastern Time (US & Canada)"
 * - DoorDash: combined="2026-03-11 10:51:14.991931" (local time)
 * - Grubhub: date="2026-03-12", time="11:06:00 AM", tz="America/New_York"
 * - UberEats: date="3/12/2026" (date only)
 * - Rocket Money: date="2023-05-09" (date only)
 */
export function parseDateTime(
  dateStr: string,
  timeStr?: string | null,
  tzStr?: string | null
): Date | null {
  if (!dateStr) return null;
  const d = dateStr.trim();
  const t = timeStr?.trim() || null;

  // If dateStr already contains time (e.g., DoorDash "2026-03-11 10:51:14.991931")
  if (/\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}/.test(d)) {
    // Extract just the date and time portions, discard fractional seconds
    const match = d.match(
      /^(\d{4}-\d{2}-\d{2})[\sT](\d{2}:\d{2}:\d{2})/
    );
    if (match) {
      const offset = resolveTimezone(tzStr);
      const iso = `${match[1]}T${match[2]}${offset}`;
      const result = new Date(iso);
      if (!isNaN(result.getTime())) return result;
    }
  }

  // Parse the date portion
  let datePart: string;

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    datePart = d;
  }
  // M/D/YYYY or MM/DD/YYYY
  else {
    const mdyMatch = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (mdyMatch) {
      const [, m, day, y] = mdyMatch;
      const year = y.length === 2 ? 2000 + parseInt(y) : parseInt(y);
      datePart = `${year}-${m.padStart(2, "0")}-${day.padStart(2, "0")}`;
    } else {
      // Fallback to parseDate for other formats
      const fallback = parseDate(d);
      return fallback;
    }
  }

  // Parse time portion
  let timePart = "00:00:00";
  if (t) {
    // Handle "11:06:00 AM" format (Grubhub)
    const ampmMatch = t.match(
      /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i
    );
    if (ampmMatch) {
      let hour = parseInt(ampmMatch[1]);
      const min = ampmMatch[2];
      const sec = ampmMatch[3] || "00";
      const ampm = ampmMatch[4].toUpperCase();
      if (ampm === "PM" && hour < 12) hour += 12;
      if (ampm === "AM" && hour === 12) hour = 0;
      timePart = `${String(hour).padStart(2, "0")}:${min}:${sec}`;
    }
    // Handle "17:44:41" 24-hour format (Square)
    else if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) {
      timePart = t.length <= 5 ? `${t}:00` : t;
    }
  }

  const offset = resolveTimezone(tzStr);
  const iso = `${datePart}T${timePart}${offset}`;
  const result = new Date(iso);
  return isNaN(result.getTime()) ? null : result;
}
