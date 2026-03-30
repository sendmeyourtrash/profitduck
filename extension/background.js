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
let crawlStatus = { state: "idle", message: "" };
let paused = true; // Start paused — user must explicitly sync

// ---- Constants ----
const FLUSH_ALARM = "profitduck-flush";
const FLUSH_DELAY_MS = 5000;
const SERVER_ENDPOINT = "/api/ingest/extension";

// ---- GraphQL normalizer ----

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
  const netPayout = parseDollar(od.netPayout || 0);

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
      "customer_refunds": "0.00",
      "order_charges": "0.00",
      "estimated_payout": netPayout.toFixed(2),
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

async function sendToServer(orders) {
  const { serverUrl, apiKey } = await getConfig();
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;

  const response = await fetch(`${serverUrl}${SERVER_ENDPOINT}`, {
    method: "POST", headers,
    body: JSON.stringify({
      platform: "ubereats",
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
  const orders = Array.from(orderQueue.values());
  const orderIds = Array.from(orderQueue.keys());
  orderQueue.clear();

  try {
    const result = await sendToServer(orders);
    lastSync = { time: new Date().toISOString(), inserted: result.inserted || 0, skipped: result.skipped || 0, error: null };
    for (const id of orderIds) sentIds.add(id);
    await chrome.storage.local.set({ lastSync });
    updateBadge();
    console.log(`[Profit Duck] Synced ${orders.length} orders: ${result.inserted} new, ${result.skipped} skipped`);
  } catch (err) {
    lastSync = { time: new Date().toISOString(), inserted: 0, skipped: 0, error: err.message };
    await chrome.storage.local.set({ lastSync });
    // Re-queue failed orders
    for (let i = 0; i < orders.length; i++) orderQueue.set(orderIds[i], orders[i]);
    console.error(`[Profit Duck] Sync failed: ${err.message}`);
  }
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

// ---- Trigger sync in content script via chrome.debugger ----

async function triggerSync(mode, options = {}) {
  const tabs = await chrome.tabs.query({ url: "https://merchants.ubereats.com/*" });
  if (!tabs[0]?.id) {
    // No Uber Eats tab — open one
    const tab = await chrome.tabs.create({ url: "https://merchants.ubereats.com/manager/orders" });
    crawlStatus = { state: "starting", message: "Opening Uber Eats..." };
    // Wait for tab to load
    await new Promise((resolve) => {
      const listener = (tabId, info) => {
        if (tabId === tab.id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      // Timeout after 30s
      setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 30000);
    });
    // Give content script time to initialize
    await new Promise(r => setTimeout(r, 3000));
    return triggerSync(mode, options);
  }

  const tabId = tabs[0].id;
  crawlStatus = { state: "starting", message: "Starting..." };

  // Build the command based on mode
  let command;
  if (mode === "smart") {
    command = `window.postMessage({ type: "PROFITDUCK_CRAWL", command: "smart-sync" }, "*")`;
  } else if (mode === "full") {
    command = `window.postMessage({ type: "PROFITDUCK_CRAWL", command: "full-sync" }, "*")`;
  } else if (mode === "date-range") {
    command = `window.postMessage({ type: "PROFITDUCK_CRAWL", command: "date-range-sync", startDate: "${options.startDate}", endDate: "${options.endDate}" }, "*")`;
  } else {
    command = `window.postMessage({ type: "PROFITDUCK_CRAWL", command: "start" }, "*")`;
  }

  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    const result = await chrome.debugger.sendCommand(
      { tabId },
      "Runtime.evaluate",
      { expression: `${command}; "triggered-${mode}"` }
    );
    await chrome.debugger.detach({ tabId });
    console.log(`[Profit Duck] Sync triggered (${mode}):`, result?.result?.value);
  } catch (e) {
    try { await chrome.debugger.detach({ tabId }); } catch (_) {}
    crawlStatus = { state: "error", message: `Trigger failed: ${e.message}` };
    console.error("[Profit Duck] Debugger error:", e.message);
  }
}

async function triggerStop() {
  const tabs = await chrome.tabs.query({ url: "https://merchants.ubereats.com/*" });
  const tabId = tabs[0]?.id;
  if (tabId) {
    try {
      await chrome.debugger.attach({ tabId }, "1.3");
      await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
        expression: 'window.postMessage({ type: "PROFITDUCK_CRAWL", command: "stop" }, "*")'
      });
      await chrome.debugger.detach({ tabId });
    } catch (e) {
      try { await chrome.debugger.detach({ tabId }); } catch (_) {}
    }
  }
}

// ---- Message handlers ----

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case "api_intercepted":
      handleIntercepted(message);
      sendResponse({ ok: true });
      break;
    case "auto_flush":
      flushQueue().then(() => sendResponse({ ok: true, lastSync }));
      return true;
    case "get_status":
      sendResponse({ capturedCount, queueSize: orderQueue.size, sentCount: sentIds.size, lastSync, crawlStatus, paused });
      break;
    case "toggle_pause":
      paused = !paused;
      chrome.storage.local.set({ paused });
      // If pausing during an active crawl, stop the crawl too
      if (paused && ["fetching", "scanning", "starting", "syncing", "throttled"].includes(crawlStatus.state)) {
        triggerStop();
        crawlStatus = { state: "done", message: "Paused — sync stopped." };
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
      crawlStatus = { state: message.state, message: message.message, total: message.total, current: message.current };
      break;
    default:
      sendResponse({ error: "unknown action" });
  }
});

function handleIntercepted(message) {
  // Allow capture during active sync even when paused (user explicitly triggered it)
  const isCrawling = ["fetching", "scanning", "starting", "syncing", "throttled"].includes(crawlStatus.state);
  if (paused && !isCrawling) return;
  const order = normalizeOrderDetails(message.data);
  if (!order) return;
  const id = order.orderUUID;
  if (!id || sentIds.has(id) || orderQueue.has(id)) return;
  orderQueue.set(id, order);
  capturedCount++;
  updateBadge();
  scheduleFlush();
  console.log(`[Profit Duck] Captured order ${order.orderId} (${order.items.length} items, $${order.netPayout})`);
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
