/**
 * HTTP client for communicating with the Profit Duck server.
 */

const DEFAULT_SERVER = "http://localhost:3000";
const ENDPOINT = "/api/ingest/extension";

/**
 * Get server URL from storage, falling back to default.
 * @returns {Promise<string>}
 */
async function getServerUrl() {
  try {
    const result = await chrome.storage.local.get("serverUrl");
    return result.serverUrl || DEFAULT_SERVER;
  } catch {
    return DEFAULT_SERVER;
  }
}

/**
 * Get API key from storage.
 * @returns {Promise<string|null>}
 */
async function getApiKey() {
  try {
    const result = await chrome.storage.local.get("apiKey");
    return result.apiKey || null;
  } catch {
    return null;
  }
}

/**
 * Send captured orders to the Profit Duck server.
 *
 * @param {string} platform - e.g., "ubereats"
 * @param {Array<Record<string, string>>} orders - Normalized order rows
 * @returns {Promise<{success: boolean, inserted?: number, skipped?: number, error?: string}>}
 */
export async function sendOrders(platform, orders) {
  const serverUrl = await getServerUrl();
  const apiKey = await getApiKey();

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;

  try {
    const response = await fetch(`${serverUrl}${ENDPOINT}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        platform,
        orders,
        source: "extension",
        extensionVersion: chrome.runtime.getManifest().version,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Server error ${response.status}: ${text}` };
    }

    return await response.json();
  } catch (err) {
    return { success: false, error: `Connection failed: ${err.message}` };
  }
}

/**
 * Health check — ping the server to verify connection.
 * @returns {Promise<{connected: boolean, version?: string}>}
 */
export async function healthCheck() {
  const serverUrl = await getServerUrl();
  const apiKey = await getApiKey();

  const headers = {};
  if (apiKey) headers["x-api-key"] = apiKey;

  try {
    const response = await fetch(`${serverUrl}${ENDPOINT}`, {
      method: "GET",
      headers,
    });

    if (!response.ok) return { connected: false };

    const data = await response.json();
    return { connected: true, version: data.version };
  } catch {
    return { connected: false };
  }
}
