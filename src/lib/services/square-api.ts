/**
 * Square API client for fetching payment and payout data.
 * Uses native fetch() with Bearer token auth and cursor-based pagination.
 *
 * Docs:
 *  - https://developer.squareup.com/reference/square/payments-api/list-payments
 *  - https://developer.squareup.com/reference/square/payouts-api/list-payouts
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
  source_type?: string; // "CARD", "CASH", "WALLET", "EXTERNAL", etc.
  amount_money?: { amount: number; currency: string };
  processing_fee?: Array<{
    amount_money: { amount: number; currency: string };
  }>;
  order_id?: string;
  total_money?: { amount: number; currency: string };
  tip_money?: { amount: number; currency: string };
  tax_money?: { amount: number; currency: string };
  refund_ids?: string[];
  card_details?: {
    card?: {
      card_brand?: string; // "VISA", "MASTERCARD", "AMERICAN_EXPRESS", etc.
      last_4?: string;
    };
  };
  cash_details?: {
    buyer_supplied_money?: { amount: number; currency: string };
    change_back_money?: { amount: number; currency: string };
  };
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

export interface SquareOrderLineItem {
  name: string;
  quantity: string;
  catalog_object_id?: string;
  base_price_money?: { amount: number; currency: string };
  total_money?: { amount: number; currency: string };
  total_tax_money?: { amount: number; currency: string };
  total_discount_money?: { amount: number; currency: string };
  variation_name?: string;
  modifiers?: {
    name?: string;
    base_price_money?: { amount: number; currency: string };
    total_price_money?: { amount: number; currency: string };
    catalog_object_id?: string;
  }[];
}

export interface SquareOrderData {
  totalTaxCents: number;
  lineItems: SquareOrderLineItem[];
  fulfillmentType: string | null; // "PICKUP", "DELIVERY", etc.
  diningOption: string | null;    // "To Go", "Delivery", null if unknown
}

/**
 * Batch-retrieve Square orders by order IDs (up to 100 per call).
 * Returns tax, line items, fulfillment, and dining option data.
 */
export async function batchRetrieveOrders(
  orderIds: string[]
): Promise<Map<string, SquareOrderData>> {
  const token = getToken();
  const result = new Map<string, SquareOrderData>();

  // Process in batches of 100 (Square API limit)
  for (let i = 0; i < orderIds.length; i += 100) {
    const batch = orderIds.slice(i, i + 100);

    const response = await fetch(
      `${SQUARE_BASE_URL}/orders/batch-retrieve`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Square-Version": "2025-01-23",
        },
        body: JSON.stringify({ order_ids: batch }),
      }
    );

    if (!response.ok) {
      // Non-fatal: just skip data for this batch
      console.warn(
        `[Square API] Failed to batch-retrieve orders (HTTP ${response.status}), skipping order data`
      );
      continue;
    }

    const data = await response.json();
    if (data.orders) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const order of data.orders as any[]) {
        const taxCents = order.total_tax_money?.amount || 0;

        // Extract line items
        const lineItems: SquareOrderLineItem[] = (order.line_items || []).map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (li: any) => ({
            name: li.name || "",
            quantity: li.quantity || "0",
            catalog_object_id: li.catalog_object_id || undefined,
            base_price_money: li.base_price_money,
            total_money: li.total_money,
            total_tax_money: li.total_tax_money,
            total_discount_money: li.total_discount_money,
            variation_name: li.variation_name,
            modifiers: (li.modifiers || []).map((m: any) => ({
              name: m.name || "",
              base_price_money: m.base_price_money,
              total_price_money: m.total_price_money,
              catalog_object_id: m.catalog_object_id,
            })),
          })
        );

        // Extract fulfillment type (PICKUP, DELIVERY, SHIPMENT, etc.)
        let fulfillmentType: string | null = null;
        if (order.fulfillments && order.fulfillments.length > 0) {
          fulfillmentType = order.fulfillments[0].type || null;
        }

        // Derive dining option from fulfillment or metadata
        let diningOption: string | null = null;
        if (fulfillmentType === "PICKUP") {
          diningOption = "To Go";
        } else if (fulfillmentType === "DELIVERY") {
          diningOption = "Delivery";
        } else if (fulfillmentType === "SHIPMENT") {
          diningOption = "Shipment";
        } else if (!fulfillmentType) {
          // No fulfillment data — don't assume
          diningOption = null;
        }

        // Check metadata for explicit dining option
        if (order.metadata?.dining_option) {
          diningOption = order.metadata.dining_option;
        }

        result.set(order.id, {
          totalTaxCents: taxCents,
          lineItems,
          fulfillmentType,
          diningOption,
        });
      }
    }

    if (i + 100 < orderIds.length) {
      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
    }
  }

  return result;
}

/**
 * Check if a Square API token is configured.
 */
export function isSquareConfigured(): boolean {
  const token = getRuntimeToken() || process.env.SQUARE_ACCESS_TOKEN;
  return !!token && token.trim().length > 0;
}

// ── Payouts API ──────────────────────────────────────────────────────────

export interface SquarePayout {
  id: string;
  status: string; // SENT, PENDING, FAILED
  amount_money?: { amount: number; currency: string };
  arrival_date?: string; // ISO 8601 date (when deposited)
  created_at: string;
  updated_at?: string;
  location_id?: string;
}

export interface SquarePayoutEntry {
  id: string;
  payout_id: string;
  effective_at?: string;
  type: string; // CHARGE, REFUND, ADJUSTMENT, FEE, etc.
  gross_amount_money?: { amount: number; currency: string };
  fee_amount_money?: { amount: number; currency: string };
  net_amount_money?: { amount: number; currency: string };
  type_charge_details?: { payment_id: string };
  type_refund_details?: { payment_id: string; refund_id: string };
}

interface ListPayoutsResponse {
  payouts?: SquarePayout[];
  cursor?: string;
  errors?: Array<{ code: string; detail: string; category?: string }>;
}

interface ListPayoutEntriesResponse {
  payout_entries?: SquarePayoutEntry[];
  cursor?: string;
  errors?: Array<{ code: string; detail: string; category?: string }>;
}

/**
 * Fetch all payouts from the Square Payouts API with cursor-based pagination.
 * Only returns SENT (deposited) payouts by default.
 * All amounts are in CENTS.
 */
export async function fetchAllPayouts(
  startDate?: string,
  endDate?: string,
  onProgress?: ProgressCallback
): Promise<SquarePayout[]> {
  const token = getToken();
  const allPayouts: SquarePayout[] = [];
  let cursor: string | undefined;
  let pageCount = 0;

  do {
    const params = new URLSearchParams();
    if (startDate) params.set("begin_time", startDate);
    if (endDate) params.set("end_time", endDate);
    if (cursor) params.set("cursor", cursor);
    params.set("limit", "100");
    params.set("sort_order", "DESC");

    const url = `${SQUARE_BASE_URL}/payouts?${params.toString()}`;

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

    const data: ListPayoutsResponse = await response.json();

    if (data.errors && data.errors.length > 0) {
      throw new SquareApiError(
        data.errors.map((e) => e.detail).join(", "),
        data.errors[0].code
      );
    }

    if (data.payouts) {
      // Only keep SENT (deposited) payouts
      const sent = data.payouts.filter((p) => p.status === "SENT");
      allPayouts.push(...sent);
    }

    cursor = data.cursor;
    pageCount++;

    onProgress?.({
      phase: "fetching",
      current: allPayouts.length,
      total: 0,
      message: `Fetching payouts from Square API... ${allPayouts.length.toLocaleString()} so far (page ${pageCount})`,
    });

    if (cursor) {
      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
    }
  } while (cursor);

  console.log(
    `[Square API] Fetched ${allPayouts.length} sent payouts across ${pageCount} page(s)`
  );

  return allPayouts;
}

/**
 * Fetch all entries for a specific payout (the individual payments/refunds
 * that make up a batch deposit). Cursor-paginated.
 * All amounts are in CENTS.
 */
export async function fetchPayoutEntries(
  payoutId: string
): Promise<SquarePayoutEntry[]> {
  const token = getToken();
  const allEntries: SquarePayoutEntry[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    params.set("limit", "100");

    const url = `${SQUARE_BASE_URL}/payouts/${payoutId}/payout-entries?${params.toString()}`;

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

    const data: ListPayoutEntriesResponse = await response.json();

    if (data.errors && data.errors.length > 0) {
      throw new SquareApiError(
        data.errors.map((e) => e.detail).join(", "),
        data.errors[0].code
      );
    }

    if (data.payout_entries) {
      allEntries.push(...data.payout_entries);
    }

    cursor = data.cursor;

    if (cursor) {
      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
    }
  } while (cursor);

  return allEntries;
}

// ── Catalog API ──────────────────────────────────────────────────────────

export interface SquareCatalogCategory {
  id: string;
  name: string;
  parentCategoryId?: string;
  isTopLevel: boolean;
  categoryType?: string; // REGULAR_CATEGORY or MENU_CATEGORY
}

export interface SquareCatalogItem {
  id: string;
  name: string;
  categoryIds: string[];
  variationIds: string[];
  variations: { id: string; name: string }[];
}

export interface SquareCatalogData {
  categories: SquareCatalogCategory[];
  items: SquareCatalogItem[];
  /** Maps variation_id → parent item_id for resolving line item catalog_object_ids */
  variationToItemId: Map<string, string>;
}

/**
 * Fetch the full Square catalog (categories + items + variations).
 * Uses cursor-based pagination on /v2/catalog/list.
 *
 * Line items in Orders use `catalog_object_id` which points to a
 * CatalogItemVariation, not the CatalogItem itself. We build a
 * variationToItemId map to resolve this.
 */
export async function fetchCatalog(
  onProgress?: ProgressCallback
): Promise<SquareCatalogData> {
  const token = getToken();
  const categories: SquareCatalogCategory[] = [];
  const items: SquareCatalogItem[] = [];
  const variationToItemId = new Map<string, string>();
  let cursor: string | undefined;
  let pageCount = 0;

  do {
    const params = new URLSearchParams();
    params.set("types", "CATEGORY,ITEM");
    if (cursor) params.set("cursor", cursor);

    const url = `${SQUARE_BASE_URL}/catalog/list?${params.toString()}`;

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: { objects?: any[]; cursor?: string } = await response.json();

    if (data.objects) {
      for (const obj of data.objects) {
        if (obj.type === "CATEGORY" && obj.category_data) {
          const cd = obj.category_data;
          categories.push({
            id: obj.id,
            name: cd.name || "",
            parentCategoryId: cd.parent_category?.id || undefined,
            isTopLevel: cd.is_top_level ?? !cd.parent_category?.id,
            categoryType: cd.category_type || undefined,
          });
        } else if (obj.type === "ITEM" && obj.item_data) {
          const id = obj.item_data;
          const categoryIds: string[] = (id.categories || []).map(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (c: any) => c.id
          );
          const variations: { id: string; name: string }[] = (id.variations || []).map(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (v: any) => ({
              id: v.id,
              name: v.item_variation_data?.name || "",
            })
          );

          // Build variation → item mapping
          for (const v of variations) {
            variationToItemId.set(v.id, obj.id);
          }

          items.push({
            id: obj.id,
            name: id.name || "",
            categoryIds,
            variationIds: variations.map((v) => v.id),
            variations,
          });
        }
      }
    }

    cursor = data.cursor;
    pageCount++;

    onProgress?.({
      phase: "fetching",
      current: categories.length + items.length,
      total: 0,
      message: `Fetching Square catalog... ${categories.length} categories, ${items.length} items (page ${pageCount})`,
    });

    if (cursor) {
      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
    }
  } while (cursor);

  console.log(
    `[Square API] Catalog: ${categories.length} categories, ${items.length} items, ${variationToItemId.size} variations`
  );

  return { categories, items, variationToItemId };
}
