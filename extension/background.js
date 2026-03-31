/**
 * Background service worker for Profit Duck extension.
 *
 * Handles:
 * - Receiving intercepted GraphQL data from content scripts
 * - Normalizing order data
 * - Batching and sending to Profit Duck server
 * - Triggering sync commands via chrome.debugger (only reliable cross-world method)
 */

// ---- In-memory state ----
const orderQueue = new Map();
const sentIds = new Set();
let capturedCount = 0;
let lastSync = { time: null, inserted: 0, skipped: 0, error: null };
let crawlStatus = {};  // Per-platform: { ubereats: { state, message }, doordash: { state, message } }
let paused = true; // Start paused — user must explicitly sync

// ---- Constants ----
const FLUSH_ALARM = "profitduck-flush";
const FLUSH_DELAY_MS = 5000;
const SERVER_ENDPOINT = "/api/ingest/extension";

// ---- Platform detection ----
const SUPPORTED_PLATFORMS = {
  "merchants.ubereats.com": { platform: "ubereats", label: "Uber Eats", color: "#34d399", pages: {
    "/orders": "Orders", "/payments": "Payments", "/menu": "Menu", "/analytics": "Analytics",
  }},
  "doordash.com/merchant": { platform: "doordash", label: "DoorDash", color: "#ef4444", pages: {
    "/orders": "Orders", "/financials": "Financials", "/menu": "Menu",
  }},
  "restaurant.grubhub.com": { platform: "grubhub", label: "GrubHub", color: "#f97316", pages: {
    "/orders": "Orders", "/dashboard": "Dashboard", "/financials": "Financials", "/menu": "Menu",
  }},
};

async function detectActivePlatform() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return { platform: null, page: null, label: null, color: null };

    for (const [host, config] of Object.entries(SUPPORTED_PLATFORMS)) {
      if (tab.url.includes(host)) {
        let page = "Other";
        for (const [path, name] of Object.entries(config.pages)) {
          if (tab.url.includes(path)) { page = name; break; }
        }
        return { platform: config.platform, page, label: config.label, color: config.color, tabId: tab.id };
      }
    }
  } catch {}
  return { platform: null, page: null, label: null, color: null };
}

// ---- GraphQL normalizer (Uber Eats) ----

function parseDollar(val) {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const cleaned = val.replace(/[$,\s]/g, "");
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

function normalizeOrderDetails(data) {
  if (!data?.data?.orderDetails) return null;
  const od = data.data.orderDetails;
  const status = od.issueSummary?.orderJobState || "UNKNOWN";
  const requestedAt = od.requestedAt ? new Date(od.requestedAt * 1000) : null;
  const completedAt = od.completedAtTimestamp ? new Date(parseInt(od.completedAtTimestamp)) : null;
  const orderDate = completedAt || requestedAt || new Date();

  const checkout = {};
  if (Array.isArray(od.checkoutInfo)) {
    for (const ci of od.checkoutInfo) checkout[ci.key] = parseDollar(ci.amount);
  }

  const subtotal = checkout.Subtotal || 0;
  const tax = checkout.TaxOnSubtotal || checkout.Tax || 0;
  const marketplaceFee = Math.abs(checkout.MarketplaceFee || 0);
  const tip = checkout.Tip || 0;
  const deliveryFee = checkout.DeliveryFee || 0;
  const serviceFee = Math.abs(checkout.ServiceFee || 0);
  const smallOrderFee = Math.abs(checkout.SmallOrderFee || 0);
  const promotions = checkout.Promotion || checkout.PickupPromotion || checkout.EatsPassDiscount || 0;
  const netPayout = parseDollar(od.netPayout || 0);
  const customerRefund = parseDollar(od.issueSummary?.customerRefund || 0);
  const adjustmentAmount = parseDollar(od.issueSummary?.adjustmentAmount || 0);

  const items = [];
  if (Array.isArray(od.items)) {
    for (const item of od.items) {
      const modifiers = [];
      if (Array.isArray(item.customizations)) {
        for (const cust of item.customizations) {
          if (Array.isArray(cust.options)) {
            for (const opt of cust.options) {
              modifiers.push({ group: cust.name, name: opt.name, price: parseDollar(opt.price || 0), quantity: opt.quantity || 1 });
            }
          }
        }
      }
      items.push({ name: item.name, price: parseDollar(item.price || 0), quantity: item.quantity || 1, modifiers });
    }
  }

  const customer = od.eater ? { name: od.eater.name || "", numOrders: od.eater.numOrders || 0 } : null;

  return {
    orderUUID: od.orderUUID,
    orderId: od.orderId,
    platform: "uber-eats",
    date: orderDate.toISOString().split("T")[0],
    time: orderDate.toTimeString().split(" ")[0],
    subtotal, tax, marketplaceFee, netPayout,
    status, fulfillmentType: od.fulfillmentType || "UNKNOWN",
    customer, items,
    csvRow: {
      "order_id": od.orderId,
      "order_uuid": od.orderUUID || "",
      "date": `${orderDate.getMonth() + 1}/${orderDate.getDate()}/${orderDate.getFullYear()}`,
      "time": orderDate.toTimeString().split(" ")[0],
      "timestamp_unix": od.requestedAt ? String(od.requestedAt) : "",
      "completed_at": od.completedAtTimestamp ? new Date(parseInt(od.completedAtTimestamp)).toISOString() : "",
      "customer": customer?.name || "",
      "customer_uuid": od.eater?.uuid || "",
      "customer_order_count": String(customer?.numOrders || 0),
      "order_status": status === "COMPLETED" ? "Completed" : status,
      "fulfillment_type": od.fulfillmentType || "",
      "sales_excl_tax": subtotal.toFixed(2),
      "tax": tax.toFixed(2),
      "marketplace_fee": (-marketplaceFee).toFixed(2),
      "marketplace_fee_rate": od.marketplaceFeeRate || "",
      "customer_refunds": (-Math.abs(customerRefund)).toFixed(2),
      "order_charges": (-Math.abs(serviceFee + smallOrderFee)).toFixed(2),
      "estimated_payout": netPayout.toFixed(2),
      "tip": tip.toFixed(2),
      "delivery_fee": deliveryFee.toFixed(2),
      "promotions": promotions.toFixed(2),
      "adjustment_amount": adjustmentAmount.toFixed(2),
      "checkout_info_json": JSON.stringify(checkout),
      "items_json": JSON.stringify(od.items || []),
      "raw_json": JSON.stringify(data),
      "source": "extension",
    },
  };
}

// ---- Server communication ----

async function getConfig() {
  try {
    const result = await chrome.storage.local.get(["serverUrl", "apiKey"]);
    return { serverUrl: result.serverUrl || "http://localhost:3000", apiKey: result.apiKey || null };
  } catch { return { serverUrl: "http://localhost:3000", apiKey: null }; }
}

async function sendToServer(orders, platform = "ubereats") {
  const { serverUrl, apiKey } = await getConfig();
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;

  const response = await fetch(`${serverUrl}${SERVER_ENDPOINT}`, {
    method: "POST", headers,
    body: JSON.stringify({
      platform,
      orders: orders.map(o => o.csvRow),
      richOrders: orders,
      source: "extension",
      extensionVersion: chrome.runtime.getManifest().version,
    }),
  });
  if (!response.ok) throw new Error(`Server ${response.status}: ${await response.text()}`);
  return response.json();
}

async function healthCheck() {
  const { serverUrl, apiKey } = await getConfig();
  const headers = {};
  if (apiKey) headers["x-api-key"] = apiKey;
  const response = await fetch(`${serverUrl}${SERVER_ENDPOINT}`, { method: "GET", headers });
  if (!response.ok) throw new Error(`Server ${response.status}`);
  return response.json();
}

// ---- Queue management ----

function scheduleFlush() {
  chrome.alarms.create(FLUSH_ALARM, { delayInMinutes: FLUSH_DELAY_MS / 60000 });
}

async function flushQueue() {
  if (orderQueue.size === 0) return;

  // Group by platform
  const byPlatform = new Map();
  for (const [id, order] of orderQueue) {
    const p = order._platform || "ubereats";
    if (!byPlatform.has(p)) byPlatform.set(p, { orders: [], ids: [] });
    byPlatform.get(p).orders.push(order);
    byPlatform.get(p).ids.push(id);
  }
  orderQueue.clear();

  let totalInserted = 0, totalSkipped = 0;
  let lastError = null;

  for (const [platform, batch] of byPlatform) {
    try {
      const result = await sendToServer(batch.orders, platform);
      totalInserted += result.inserted || 0;
      totalSkipped += result.skipped || 0;
      for (const id of batch.ids) sentIds.add(id);
      console.log(`[Profit Duck] [${platform}] Synced ${batch.orders.length}: ${result.inserted} new, ${result.skipped} skipped`);
    } catch (err) {
      lastError = err.message;
      for (let i = 0; i < batch.orders.length; i++) orderQueue.set(batch.ids[i], batch.orders[i]);
      console.error(`[Profit Duck] [${platform}] Sync failed: ${err.message}`);
    }
  }

  lastSync = { time: new Date().toISOString(), inserted: totalInserted, skipped: totalSkipped, error: lastError };
  await chrome.storage.local.set({ lastSync });
  updateBadge();
}

function updateBadge() {
  if (paused) {
    chrome.action.setBadgeText({ text: "||" });
    chrome.action.setBadgeBackgroundColor({ color: "#9ca3af" });
  } else {
    chrome.action.setBadgeText({ text: capturedCount > 0 ? String(capturedCount) : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#6366f1" });
  }
}

// ---- Trigger sync via chrome.storage (bridge watches for changes) ----

async function triggerSync(mode, options = {}) {
  const detected = await detectActivePlatform();
  const platform = options.platform || detected.platform || "ubereats";

  const platformUrls = {
    ubereats: { match: "https://merchants.ubereats.com/*", open: "https://merchants.ubereats.com/manager/orders" },
    doordash: { match: ["https://www.doordash.com/merchant/*", "https://doordash.com/merchant/*"], open: "https://www.doordash.com/merchant/orders" },
    grubhub: { match: "https://restaurant.grubhub.com/*", open: "https://restaurant.grubhub.com/financials/transactions" },
  };
  const pConfig = platformUrls[platform] || platformUrls.ubereats;

  const tabs = await chrome.tabs.query({ url: pConfig.match });
  if (!tabs[0]?.id) {
    const tab = await chrome.tabs.create({ url: pConfig.open });
    crawlStatus[platform] = { state: "starting", message: `Opening ${detected.label || platform}...` };
    await new Promise((resolve) => {
      const listener = (tabId, info) => {
        if (tabId === tab.id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 30000);
    });
    await new Promise(r => setTimeout(r, 3000));
    return triggerSync(mode, options);
  }

  crawlStatus[platform] = { state: "starting", message: "Starting..." };
  const crawlCmd = mode === "smart" ? "smart-sync" : mode === "date-range" ? "date-range-sync" : mode === "full" ? "full-sync" : "start";

  await chrome.storage.local.set({
    syncRequest: { command: crawlCmd, platform, startDate: options.startDate || "", endDate: options.endDate || "", ts: Date.now() }
  });
  console.log(`[Profit Duck] Sync request stored (${crawlCmd}) for ${platform}`);
}

async function triggerStop() {
  // Stop goes to all platforms
  await chrome.storage.local.set({
    syncRequest: { command: "stop", platform: "all", ts: Date.now() }
  });
  console.log("[Profit Duck] Stop request stored");
}

// ---- Message handlers ----

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case "api_intercepted":
      handleIntercepted(message);
      sendResponse({ ok: true });
      break;
    case "fetch_doordash_details":
      // Fetch DoorDash order details via GraphQL using captured auth headers
      (async () => {
        const uuids = message.uuids || [];
        const details = {};
        const GQL_URL = "https://merchant-portal.doordash.com/mx-menu-tools-bff/graphql";

        // Get stored GraphQL headers (captured from page's own API calls)
        const { ddGqlHeaders } = await chrome.storage.local.get("ddGqlHeaders");
        if (!ddGqlHeaders) {
          console.warn("[Profit Duck] [doordash] No GQL headers stored. Open an order detail page first.");
          sendResponse({ details: {} });
          return;
        }

        // Simple order detail query
        const query = `query OrderDetails($orderUuid: String!) {
          orderDetails(orderCartId: $orderUuid) {
            orderId orderUuid subtotal tax tip commission netPayout
            fulfillmentType orderStatus
            items { name quantity price category modifiers { name price } }
          }
        }`;

        for (const uuid of uuids) {
          try {
            const resp = await fetch(GQL_URL, {
              method: "POST",
              headers: { ...ddGqlHeaders, "Content-Type": "application/json" },
              body: JSON.stringify({ operationName: "OrderDetails", variables: { orderUuid: uuid }, query }),
            });
            if (resp.ok) {
              const json = await resp.json();
              if (json?.data) details[uuid] = json;
            }
          } catch (e) {
            // Skip failed fetches
          }
          await new Promise(r => setTimeout(r, 300));
        }

        console.log(`[Profit Duck] [doordash] Fetched GQL details for ${Object.keys(details).length}/${uuids.length} orders`);
        sendResponse({ details });
      })();
      return true;
    case "send_doordash_csvrows":
      // DoorDash csvRows sent from content script via bridge — send directly to server
      (async () => {
        try {
          const { serverUrl, apiKey } = await getConfig();
          const headers = { "Content-Type": "application/json" };
          if (apiKey) headers["x-api-key"] = apiKey;
          const resp = await fetch(`${serverUrl}${SERVER_ENDPOINT}`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              platform: "doordash",
              orders: message.csvRows || [],
              source: "extension",
              extensionVersion: chrome.runtime.getManifest().version,
            }),
          });
          if (!resp.ok) throw new Error(`Server ${resp.status}`);
          const result = await resp.json();
          lastSync = { time: new Date().toISOString(), inserted: result.inserted || 0, skipped: result.skipped || 0, error: null };
          await chrome.storage.local.set({ lastSync });
          console.log(`[Profit Duck] [doordash] Sent ${message.csvRows?.length || 0}: ${result.inserted} new, ${result.skipped} skipped`);
          sendResponse({ ok: true, inserted: result.inserted, skipped: result.skipped });
        } catch (e) {
          console.error(`[Profit Duck] [doordash] Send failed: ${e.message}`);
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;
    case "send_grubhub_csvrows":
      // GrubHub csvRows — same pattern as DoorDash
      (async () => {
        try {
          const { serverUrl, apiKey } = await getConfig();
          const headers = { "Content-Type": "application/json" };
          if (apiKey) headers["x-api-key"] = apiKey;
          const resp = await fetch(`${serverUrl}${SERVER_ENDPOINT}`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              platform: "grubhub",
              orders: message.csvRows || [],
              source: "extension",
              extensionVersion: chrome.runtime.getManifest().version,
            }),
          });
          if (!resp.ok) throw new Error(`Server ${resp.status}`);
          const result = await resp.json();
          lastSync = { time: new Date().toISOString(), inserted: result.inserted || 0, skipped: result.skipped || 0, error: null };
          await chrome.storage.local.set({ lastSync });
          console.log(`[Profit Duck] [grubhub] Sent ${message.csvRows?.length || 0}: ${result.inserted} new, ${result.skipped} skipped`);
          sendResponse({ ok: true, inserted: result.inserted, skipped: result.skipped });
        } catch (e) {
          console.error(`[Profit Duck] [grubhub] Send failed: ${e.message}`);
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;
    case "auto_flush":
      flushQueue().then(() => sendResponse({ ok: true, lastSync }));
      return true;
    case "get_status":
      sendResponse({ capturedCount, queueSize: orderQueue.size, sentCount: sentIds.size, lastSync, crawlStatus, paused });
      break;
    case "detect_platform":
      detectActivePlatform().then(p => sendResponse(p)).catch(() => sendResponse({ platform: null }));
      return true;
    case "toggle_pause":
      paused = !paused;
      chrome.storage.local.set({ paused });
      // If pausing during an active crawl, stop the crawl too
      if (paused) {
        const activeStates = ["fetching", "scanning", "starting", "syncing", "throttled"];
        for (const p of Object.keys(crawlStatus)) {
          if (activeStates.includes(crawlStatus[p]?.state)) {
            crawlStatus[p] = { state: "done", message: "Paused — sync stopped." };
          }
        }
        triggerStop();
      }
      updateBadge();
      sendResponse({ paused });
      break;
    case "flush_now":
      flushQueue().then(() => sendResponse({ ok: true, lastSync }));
      return true;
    case "health_check":
      healthCheck().then(d => sendResponse({ connected: true, version: d.version })).catch(() => sendResponse({ connected: false }));
      return true;
    case "get_known_ids":
      getConfig().then(async ({ serverUrl, apiKey }) => {
        try {
          const headers = {};
          if (apiKey) headers["x-api-key"] = apiKey;
          const resp = await fetch(`${serverUrl}/api/ingest/extension?action=known_ids&platform=${message.platform || "ubereats"}`, { headers });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const data = await resp.json();
          sendResponse({ orderIds: data.orderIds || [] });
        } catch (e) {
          console.warn("[Profit Duck] Failed to load known IDs:", e.message);
          sendResponse({ orderIds: [] });
        }
      });
      return true;
    case "start_sync":
      paused = false; // Auto-unpause when user triggers sync
      chrome.storage.local.set({ paused });
      triggerSync(message.mode || "smart", { startDate: message.startDate, endDate: message.endDate });
      sendResponse({ ok: true });
      break;
    case "stop_sync":
      triggerStop();
      sendResponse({ ok: true });
      break;
    case "crawl_status":
      const csPlatform = message.platform || "ubereats";
      crawlStatus[csPlatform] = { state: message.state, message: message.message, total: message.total, current: message.current };
      break;
    default:
      sendResponse({ error: "unknown action" });
  }
});

function handleIntercepted(message) {
  if (paused) return;
  const order = normalizeOrderDetails(message.data);
  if (!order) return;
  order._platform = "ubereats";

  const id = order.orderUUID;
  if (!id || sentIds.has(id) || orderQueue.has(id)) return;
  orderQueue.set(id, order);
  capturedCount++;
  updateBadge();
  scheduleFlush();
  console.log(`[Profit Duck] [ubereats] Captured order ${order.orderId} (${order.items?.length || 0} items, $${order.netPayout})`);
}

// ---- Alarm handler ----
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === FLUSH_ALARM) flushQueue(); });

// ---- Startup ----
chrome.runtime.onInstalled.addListener(() => { console.log("[Profit Duck] Extension installed"); updateBadge(); });
chrome.storage.local.get(["lastSync", "paused"]).then((result) => {
  if (result.lastSync) lastSync = result.lastSync;
  if (result.paused !== undefined) paused = result.paused;
  else paused = true; // Default to paused
  updateBadge();
});
