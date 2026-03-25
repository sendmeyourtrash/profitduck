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
 * Uses the configured timezone to prevent day-shift issues.
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
    timeZone: _configuredTimezone,
  });
}

/**
 * Format a Date or ISO string as a short date with time.
 * Uses the configured timezone.
 */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: _configuredTimezone,
  });
}

/**
 * Convert a date string to a stable local YYYY-MM-DD string in the configured timezone.
 * Use this instead of toISOString().slice(0,10) to avoid UTC day-shift.
 */
export function toLocalDateStr(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: _configuredTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value || "2026";
  const m = parts.find((p) => p.type === "month")?.value || "01";
  const dy = parts.find((p) => p.type === "day")?.value || "01";
  return `${y}-${m}-${dy}`;
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
 * Map of common timezone names/abbreviations to IANA timezone identifiers.
 * Square uses names like "Eastern Time (US & Canada)".
 * Grubhub uses IANA like "America/New_York".
 */
const TZ_TO_IANA: Record<string, string> = {
  // Standard names (from Square CSVs)
  "eastern time (us & canada)": "America/New_York",
  "central time (us & canada)": "America/Chicago",
  "mountain time (us & canada)": "America/Denver",
  "pacific time (us & canada)": "America/Los_Angeles",
  // IANA zones (from Grubhub) — pass through
  "america/new_york": "America/New_York",
  "america/chicago": "America/Chicago",
  "america/denver": "America/Denver",
  "america/los_angeles": "America/Los_Angeles",
  // Abbreviations
  est: "America/New_York",
  edt: "America/New_York",
  cst: "America/Chicago",
  cdt: "America/Chicago",
  mst: "America/Denver",
  mdt: "America/Denver",
  pst: "America/Los_Angeles",
  pdt: "America/Los_Angeles",
  utc: "UTC",
  gmt: "UTC",
};

/** Map IANA timezone to current UTC offset string (handles DST automatically) */
function ianaToOffset(iana: string): string {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: iana,
      timeZoneName: "shortOffset",
    });
    const parts = formatter.formatToParts(now);
    const tzPart = parts.find((p) => p.type === "timeZoneName");
    if (tzPart) {
      // "GMT-5" → "-05:00", "GMT+0" → "+00:00", "GMT-4" → "-04:00"
      const match = tzPart.value.match(/GMT([+-]?\d+)?(?::(\d+))?/);
      if (match) {
        const hours = parseInt(match[1] || "0");
        const mins = parseInt(match[2] || "0");
        const sign = hours >= 0 ? "+" : "-";
        return `${sign}${String(Math.abs(hours)).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
      }
    }
  } catch { /* fallback below */ }
  return "+00:00";
}

/**
 * Configured timezone (IANA format). Set once from settings, used everywhere.
 * Defaults to browser/server local timezone.
 */
let _configuredTimezone: string = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";

/** Set the app-wide timezone (call from settings load) */
export function setConfiguredTimezone(iana: string): void {
  _configuredTimezone = iana;
}

/** Get the app-wide configured timezone */
export function getConfiguredTimezone(): string {
  return _configuredTimezone;
}

/**
 * Resolve a source timezone string to a UTC offset like "-05:00".
 * If no source TZ provided, uses the app-configured timezone.
 * Handles DST automatically via IANA timezone lookup.
 */
export function resolveTimezone(tz?: string | null): string {
  if (!tz) return ianaToOffset(_configuredTimezone);
  const normalized = tz.trim().toLowerCase();
  const iana = TZ_TO_IANA[normalized];
  if (iana) return ianaToOffset(iana);
  // Try as IANA directly
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz.trim() });
    return ianaToOffset(tz.trim());
  } catch { /* not valid IANA */ }
  return ianaToOffset(_configuredTimezone);
}

/**
 * Resolve a source timezone string to an IANA timezone identifier.
 */
export function resolveToIANA(tz?: string | null): string {
  if (!tz) return _configuredTimezone;
  const normalized = tz.trim().toLowerCase();
  return TZ_TO_IANA[normalized] || _configuredTimezone;
}

/**
 * Load timezone from a value (e.g., fetched from settings API or DB).
 * Server-side API routes should call: setConfiguredTimezone(getSettingValue("timezone"))
 * Client-side pages should fetch timezone from /api/settings and call setConfiguredTimezone().
 */
export function loadConfiguredTimezone(): string {
  // No-op — returns current configured timezone.
  // To actually load from DB, server code should use:
  //   import { getSettingValue } from "@/lib/db/config-db";
  //   setConfiguredTimezone(getSettingValue("timezone") || "America/New_York");
  return _configuredTimezone;
}

/**
 * Get today's date as YYYY-MM-DD in the configured timezone.
 */
export function todayInConfiguredTz(): string {
  loadConfiguredTimezone();
  return toLocalDateStr(new Date());
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
