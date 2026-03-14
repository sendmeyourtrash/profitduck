/**
 * Plaid API service — client setup, token management, and link/exchange flows.
 * Mirrors the Square API service pattern (globalThis cache, Settings persistence).
 */

import {
  PlaidApi,
  PlaidEnvironments,
  Configuration,
  Products,
  CountryCode,
} from "plaid";
import {
  getSetting,
  setSetting,
  SETTING_KEYS,
  getPlaidAccessToken,
  setPlaidAccessTokenDb,
  getPlaidItemId,
  setPlaidItemIdDb,
  clearAllPlaidSettings,
} from "./settings";

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------

export class PlaidApiError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "PlaidApiError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Runtime token cache (survives Next.js hot reloads via globalThis)
// ---------------------------------------------------------------------------

const globalStore = globalThis as unknown as {
  __plaidAccessToken?: string | null;
  __plaidItemId?: string | null;
  __plaidClient?: PlaidApi | null;
};

// ---------------------------------------------------------------------------
// Client initialization
// ---------------------------------------------------------------------------

function getEnvOrThrow(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new PlaidApiError(
      `Missing environment variable: ${key}. Set it in your .env file.`,
      "CONFIG_ERROR"
    );
  }
  return val;
}

function getPlaidEnv(): string {
  const env = process.env.PLAID_ENV || "sandbox";
  const envMap: Record<string, string> = {
    sandbox: PlaidEnvironments.sandbox,
    development: PlaidEnvironments.development,
    production: PlaidEnvironments.production,
  };
  return envMap[env] || PlaidEnvironments.sandbox;
}

/**
 * Get or create the singleton Plaid client.
 */
export function getPlaidClient(): PlaidApi {
  if (globalStore.__plaidClient) return globalStore.__plaidClient;

  const clientId = getEnvOrThrow("PLAID_CLIENT_ID");
  const secret = getEnvOrThrow("PLAID_SECRET");

  const configuration = new Configuration({
    basePath: getPlaidEnv(),
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  });

  globalStore.__plaidClient = new PlaidApi(configuration);
  return globalStore.__plaidClient;
}

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

/**
 * Load Plaid credentials from DB into runtime cache.
 * Call once at startup or before first API call.
 */
export async function initializePlaidFromDb(): Promise<void> {
  if (globalStore.__plaidAccessToken) return; // already loaded

  const token = await getPlaidAccessToken();
  const itemId = await getPlaidItemId();
  if (token) globalStore.__plaidAccessToken = token;
  if (itemId) globalStore.__plaidItemId = itemId;
}

export function getRuntimeAccessToken(): string | null {
  return globalStore.__plaidAccessToken ?? null;
}

export function getRuntimeItemId(): string | null {
  return globalStore.__plaidItemId ?? null;
}

export function isPlaidConfigured(): boolean {
  return !!globalStore.__plaidAccessToken;
}

/**
 * Store Plaid credentials in both runtime and DB.
 */
export async function setPlaidCredentials(
  accessToken: string,
  itemId: string
): Promise<void> {
  globalStore.__plaidAccessToken = accessToken;
  globalStore.__plaidItemId = itemId;
  await setPlaidAccessTokenDb(accessToken);
  await setPlaidItemIdDb(itemId);
}

/**
 * Clear all Plaid credentials from runtime and DB.
 */
export async function clearPlaidCredentials(): Promise<void> {
  // Try to revoke on Plaid's side first
  if (globalStore.__plaidAccessToken) {
    try {
      const client = getPlaidClient();
      await client.itemRemove({
        access_token: globalStore.__plaidAccessToken,
      });
    } catch {
      // Best-effort — continue clearing even if Plaid call fails
    }
  }

  globalStore.__plaidAccessToken = null;
  globalStore.__plaidItemId = null;
  await clearAllPlaidSettings();
}

// ---------------------------------------------------------------------------
// Link Token (step 1 of Plaid Link flow)
// ---------------------------------------------------------------------------

/**
 * Create a Plaid Link token for the frontend to launch the Link UI.
 */
export async function createLinkToken(): Promise<string> {
  const client = getPlaidClient();

  const response = await client.linkTokenCreate({
    user: { client_user_id: "restdash-user" },
    client_name: "RestDash",
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: "en",
  });

  return response.data.link_token;
}

// ---------------------------------------------------------------------------
// Token Exchange (step 2 of Plaid Link flow)
// ---------------------------------------------------------------------------

/**
 * Exchange a public_token for permanent access_token + item_id.
 * Also fetches and stores institution/account information.
 */
export async function exchangePublicToken(
  publicToken: string
): Promise<{ institutionName: string; accountName: string }> {
  const client = getPlaidClient();

  // Exchange token
  const exchangeResponse = await client.itemPublicTokenExchange({
    public_token: publicToken,
  });
  const { access_token, item_id } = exchangeResponse.data;

  // Store credentials
  await setPlaidCredentials(access_token, item_id);

  // Get institution name
  let institutionName = "Chase";
  try {
    const itemResponse = await client.itemGet({ access_token });
    const institutionId = itemResponse.data.item.institution_id;
    if (institutionId) {
      // Institution name is available from the item metadata
      institutionName = institutionId; // Will be something like "ins_3"
    }
  } catch {
    // Non-critical — default to "Chase"
  }

  // Get account info
  let accountName = "Checking";
  try {
    const accountsResponse = await client.accountsGet({ access_token });
    const accounts = accountsResponse.data.accounts;
    if (accounts.length > 0) {
      accountName = accounts[0].name || accounts[0].official_name || "Checking";
      // Use the institution name from accounts response if available
      const item = accountsResponse.data.item;
      if (item.institution_id) {
        // Map common institution IDs
        institutionName = "Chase"; // Since we're connecting Chase specifically
      }
    }
  } catch {
    // Non-critical
  }

  // Persist institution/account info
  await setSetting(SETTING_KEYS.PLAID_INSTITUTION_NAME, institutionName);
  await setSetting(SETTING_KEYS.PLAID_ACCOUNT_NAME, accountName);

  return { institutionName, accountName };
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

export async function getPlaidStatus(): Promise<{
  configured: boolean;
  institutionName: string | null;
  accountName: string | null;
  lastSyncAt: string | null;
}> {
  await initializePlaidFromDb();

  const [institutionName, accountName, lastSyncAt] = await Promise.all([
    getSetting(SETTING_KEYS.PLAID_INSTITUTION_NAME),
    getSetting(SETTING_KEYS.PLAID_ACCOUNT_NAME),
    getSetting(SETTING_KEYS.PLAID_LAST_SYNC_AT),
  ]);

  return {
    configured: isPlaidConfigured(),
    institutionName,
    accountName,
    lastSyncAt,
  };
}
