/**
 * Square API client for fetching payment data (processing fees).
 * Uses native fetch() with Bearer token auth and cursor-based pagination.
 *
 * Docs: https://developer.squareup.com/reference/square/payments-api/list-payments
 */

import {
  setSquareTokenDb,
  deleteSquareTokenDb,
  getSquareToken as getDbSquareToken,
} from "./settings";
import { ProgressCallback } from "./progress";

const SQUARE_BASE_URL = "https://connect.squareup.com/v2";
const PAGE_DELAY_MS = 200;

/**
 * Runtime token override — allows setting the token from the browser UI
 * without restarting the server. Takes precedence over .env value.
 *
 * Uses globalThis so the token is shared across all Next.js API route
 * module instances (which can differ in dev mode).
 */
const globalStore = globalThis as unknown as { __squareToken?: string | null };

/**
 * Set the Square token in both runtime memory and the database.
 */
export async function setSquareToken(token: string) {
  const trimmed = token.trim();
  globalStore.__squareToken = trimmed;
  await setSquareTokenDb(trimmed);
}

/**
 * Clear the Square token from runtime memory and the database.
 */
export async function clearSquareToken() {
  globalStore.__squareToken = null;
  await deleteSquareTokenDb();
}

/**
 * Load the persisted token from the database into runtime memory.
 * Called on app startup so getToken() stays synchronous.
 */
export async function initializeTokenFromDb() {
  if (getRuntimeToken()) return; // Already set at runtime
  if (process.env.SQUARE_ACCESS_TOKEN) return; // Env var takes precedence
  const dbToken = await getDbSquareToken();
  if (dbToken) {
    globalStore.__squareToken = dbToken;
  }
}

function getRuntimeToken(): string | null {
  return globalStore.__squareToken ?? null;
}

export interface SquarePayment {
  id: string;
  created_at: string;
  status: string;
  amount_money?: { amount: number; currency: string };
  processing_fee?: Array<{
    amount_money: { amount: number; currency: string };
  }>;
  order_id?: string;
  total_money?: { amount: number; currency: string };
  tip_money?: { amount: number; currency: string };
  refund_ids?: string[];
}

interface ListPaymentsResponse {
  payments?: SquarePayment[];
  cursor?: string;
  errors?: Array<{ code: string; detail: string; category?: string }>;
}

function getToken(): string {
  const token = getRuntimeToken() || process.env.SQUARE_ACCESS_TOKEN;
  if (!token) {
    throw new SquareApiError(
      "No Square API token configured. Paste your token above or add SQUARE_ACCESS_TOKEN to .env.",
      "NO_TOKEN"
    );
  }
  return token;
}

/**
 * Custom error class for Square API errors with user-friendly messages.
 */
export class SquareApiError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "SquareApiError";
    this.code = code;
  }
}

/**
 * Parse a Square API error response into a user-friendly message.
 */
function parseSquareError(status: number, body: string): SquareApiError {
  try {
    const data = JSON.parse(body);
    const errors = data.errors as Array<{
      code: string;
      detail: string;
      category?: string;
    }>;

    if (errors?.[0]) {
      const err = errors[0];

      if (
        status === 401 ||
        err.category === "AUTHENTICATION_ERROR" ||
        err.code === "UNAUTHORIZED"
      ) {
        return new SquareApiError(
          "Invalid or expired token. Check that you're using a production access token (not sandbox).",
          "AUTH_ERROR"
        );
      }

      if (err.code === "FORBIDDEN" || status === 403) {
        return new SquareApiError(
          "Token doesn't have permission to read payments. Check your Square app permissions.",
          "FORBIDDEN"
        );
      }

      if (err.code === "RATE_LIMITED" || status === 429) {
        return new SquareApiError(
          "Square API rate limit hit. Wait a minute and try again.",
          "RATE_LIMITED"
        );
      }

      return new SquareApiError(
        `Square API error: ${err.detail || err.code}`,
        err.code
      );
    }
  } catch {
    // couldn't parse JSON
  }

  return new SquareApiError(
    `Square API returned HTTP ${status}. Check your token and try again.`,
    `HTTP_${status}`
  );
}

/**
 * Validate a Square token by making a lightweight API call.
 * Returns merchant name on success, throws SquareApiError on failure.
 */
export async function validateToken(
  token: string
): Promise<{ valid: true; merchantName: string }> {
  const response = await fetch(
    `${SQUARE_BASE_URL}/merchants/me`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Square-Version": "2025-01-23",
      },
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw parseSquareError(response.status, body);
  }

  const data = await response.json();
  const merchantName =
    data.merchant?.business_name || data.merchant?.id || "Connected";

  return { valid: true, merchantName };
}

/**
 * Fetch all payments from the Square API with cursor-based pagination.
 * Optionally filter by date range (ISO 8601 strings).
 *
 * All monetary amounts in responses are in CENTS (integer).
 * Caller is responsible for dividing by 100 when storing as dollars.
 */
export async function fetchAllPayments(
  startDate?: string,
  endDate?: string,
  onProgress?: ProgressCallback
): Promise<SquarePayment[]> {
  const token = getToken();
  const allPayments: SquarePayment[] = [];
  let cursor: string | undefined;
  let pageCount = 0;

  do {
    const params = new URLSearchParams();
    if (startDate) params.set("begin_time", startDate);
    if (endDate) params.set("end_time", endDate);
    if (cursor) params.set("cursor", cursor);
    params.set("limit", "100");

    const url = `${SQUARE_BASE_URL}/payments?${params.toString()}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Square-Version": "2025-01-23",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw parseSquareError(response.status, body);
    }

    const data: ListPaymentsResponse = await response.json();

    if (data.errors && data.errors.length > 0) {
      throw new SquareApiError(
        data.errors.map((e) => e.detail).join(", "),
        data.errors[0].code
      );
    }

    if (data.payments) {
      const completed = data.payments.filter(
        (p) => p.status === "COMPLETED"
      );
      allPayments.push(...completed);
    }

    cursor = data.cursor;
    pageCount++;

    onProgress?.({
      phase: "fetching",
      current: allPayments.length,
      total: 0, // Unknown total with cursor-based pagination
      message: `Fetching payments from Square API... ${allPayments.length.toLocaleString()} so far (page ${pageCount})`,
    });

    if (cursor) {
      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
    }
  } while (cursor);

  console.log(
    `[Square API] Fetched ${allPayments.length} completed payments across ${pageCount} page(s)`
  );

  return allPayments;
}

/**
 * Check if a Square API token is configured.
 */
export function isSquareConfigured(): boolean {
  const token = getRuntimeToken() || process.env.SQUARE_ACCESS_TOKEN;
  return !!token && token.trim().length > 0;
}
