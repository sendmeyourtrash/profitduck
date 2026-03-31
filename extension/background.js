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

// ---- Platform detection ----
const SUPPORTED_PLATFORMS = {
  "merchants.ubereats.com": { platform: "ubereats", label: "Uber Eats", color: "#34d399", pages: {
    "/orders": "Orders", "/payments": "Payments", "/menu": "Menu", "/analytics": "Analytics",
  }},
  "doordash.com/merchant": { platform: "doordash", label: "DoorDash", color: "#ef4444", pages: {
    "/orders": "Orders", "/financials": "Financials", "/menu": "Menu",
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

// ---- DoorDash normalizer ----

function normalizeDoorDashOrder(data) {
  const od = data?.data;
  if (!od?.orderId) return null;

  const cents = (obj) => (obj?.unitAmount || 0) / 100;
  const fmt = (n) => n.toFixed(2);
  const completedAt = od.completedTime ? new Date(od.completedTime) : new Date();
  const pickupAt = od.pickupTime ? new Date(od.pickupTime) : null;

  const subtotal = cents(od.preTaxTotal);
  const tax = cents(od.tax || od.totalTax);
  const commission = cents(od.commission);
  const netPayout = cents(od.netPayout);
  const tip = cents(od.merchantTipAmount);
  const errorCharges = cents(od.errorCharges);
  const procFee = cents(od.paymentProcessingFee || od.processingFee);
  const tabletFee = cents(od.tabletFee);
  const adjustments = cents(od.adjustments);
  const discYou = cents(od.customerDiscountsFundedByYou || od.merchantFundedDiscount);
  const discDD = cents(od.customerDiscountsFundedByDoordash || od.doordashFundedDiscount);
  const ddCredit = cents(od.doordashMarketingCredit);

  let marketingFee = 0;
  if (od.feeGroups?.ad_fees?.totalAmount) {
    marketingFee = Math.abs(cents(od.feeGroups.ad_fees.totalAmount));
  }

  const items = [];
  if (od.orders && Array.isArray(od.orders)) {
    for (const orderGroup of od.orders) {
      if (orderGroup.orderItems && Array.isArray(orderGroup.orderItems)) {
        for (const item of orderGroup.orderItems) {
          const extras = (item.itemExtras || []).map(e => {
            const opt = e.itemExtraOptions || e.itemExtraOptionsList?.[0];
            return { name: e.name || e.title || "", option: opt?.name || "", price: cents(opt?.price) };
          }).filter(e => e.option);
          items.push({ name: item.name, quantity: item.quantity, price: cents(item.price), category: item.category || "", extras });
        }
      }
    }
  }

  const pad = (n) => String(n).padStart(2, "0");
  const orderDate = `${completedAt.getFullYear()}-${pad(completedAt.getMonth() + 1)}-${pad(completedAt.getDate())}`;
  const orderTime = `${pad(completedAt.getHours())}:${pad(completedAt.getMinutes())}:${pad(completedAt.getSeconds())}`;
  const utcDate = completedAt.toISOString().slice(0, 10);
  const utcTime = completedAt.toISOString().slice(11, 19);

  const fulfillment = od.fulfillmentType || "";
  const channel = fulfillment.toLowerCase().includes("pickup") ? "Pickup"
    : fulfillment.toLowerCase().includes("storefront") ? "Storefront" : "Marketplace";

  return {
    orderUUID: od.deliveryUuid || od.orderId,
    orderId: od.orderId,
    platform: "doordash",
    netPayout,
    items,
    csvRow: {
      "doordash_order_id": od.orderId,
      "delivery_uuid": od.deliveryUuid || "",
      "timestamp_local_date": orderDate,
      "timestamp_local_time": orderTime,
      "timestamp_utc_date": utcDate,
      "timestamp_utc_time": utcTime,
      "order_received_local_time": od.orderReceivedTime || "",
      "order_pickup_local_time": pickupAt ? pickupAt.toISOString() : "",
      "transaction_type": "Order",
      "channel": channel,
      "final_order_status": od.orderStatusDetails?.value || "DELIVERED_ORDER",
      "currency": "USD",
      "subtotal": fmt(subtotal),
      "subtotal_tax_passed_to_merchant": fmt(tax),
      "commission": fmt(-Math.abs(commission)),
      "payment_processing_fee": fmt(-Math.abs(procFee)),
      "tablet_fee": fmt(-Math.abs(tabletFee)),
      "marketing_fees": fmt(-Math.abs(marketingFee)),
      "customer_discounts_funded_by_you": fmt(-Math.abs(discYou)),
      "customer_discounts_funded_by_doordash": fmt(discDD),
      "doordash_marketing_credit": fmt(ddCredit),
      "error_charges": fmt(-Math.abs(errorCharges)),
      "adjustments": fmt(adjustments),
      "net_total": fmt(netPayout),
      "description": items.map(i => `${i.quantity}x ${i.name}`).join(", "),
      "customer_name": od.consumer?.formalNameAbbreviated || "",
      "tip": fmt(tip),
      "commission_rate": String(od.commissionRate || ""),
      "items_json": JSON.stringify(items),
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
  };
  const pConfig = platformUrls[platform] || platformUrls.ubereats;

  const tabs = await chrome.tabs.query({ url: pConfig.match });
  if (!tabs[0]?.id) {
    const tab = await chrome.tabs.create({ url: pConfig.open });
    crawlStatus = { state: "starting", message: `Opening ${detected.label || platform}...` };
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

  crawlStatus = { state: "starting", message: "Starting..." };
  const crawlCmd = mode === "smart" ? "smart-sync" : mode === "date-range" ? "date-range-sync" : mode === "full" ? "full-sync" : "start";

  await chrome.storage.local.set({
    syncRequest: { command: crawlCmd, startDate: options.startDate || "", endDate: options.endDate || "", ts: Date.now() }
  });
  console.log(`[Profit Duck] Sync request stored (${crawlCmd}) for ${platform}`);
}

async function triggerStop() {
  await chrome.storage.local.set({
    syncRequest: { command: "stop", ts: Date.now() }
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
      crawlStatus = { state: message.state, message: message.message, total: message.total, current: message.current };
      break;
    default:
      sendResponse({ error: "unknown action" });
  }
});

function handleIntercepted(message) {
  if (paused) return;
  const platform = message.platform || "ubereats";

  let order;
  if (platform === "doordash") {
    order = normalizeDoorDashOrder(message.data);
  } else {
    order = normalizeOrderDetails(message.data);
  }
  if (!order) return;

  // Tag with platform for multi-platform flush
  order._platform = platform === "doordash" ? "doordash" : "ubereats";

  const id = order.orderUUID;
  if (!id || sentIds.has(id) || orderQueue.has(id)) return;
  orderQueue.set(id, order);
  capturedCount++;
  updateBadge();
  scheduleFlush();
  console.log(`[Profit Duck] [${platform}] Captured order ${order.orderId} (${order.items?.length || 0} items, $${order.netPayout})`);
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
