/**
 * MAIN world content script — Profit Duck DoorDash data capture.
 *
 * Intercepts API calls to DoorDash merchant portal endpoints:
 *   - /merchant-analytics-service/api/v1/get_orders (order list)
 *   - /merchant-analytics-service/api/v1/orders_details/ (order detail with items + fees)
 *
 * Order details are posted to the bridge script → background for normalization.
 */
(function () {
  "use strict";

  const INTERCEPT_TAG = "PROFITDUCK_INTERCEPTED";
  const CRAWL_STATUS_TAG = "PROFITDUCK_CRAWL_STATUS";

  // API base + URL patterns to intercept
  const API_BASE = "https://merchant-portal.doordash.com";
  const ORDER_DETAIL_PATH = "/merchant-analytics-service/api/v1/orders_details";
  const ORDER_LIST_PATH = "/merchant-analytics-service/api/v1/get_orders";
  const ORDER_DETAIL_URL = API_BASE + ORDER_DETAIL_PATH;
  const ORDER_LIST_URL = API_BASE + ORDER_LIST_PATH;

  let crawlActive = false;
  let crawlAbort = false;

  function postIntercepted(url, data) {
    try {
      window.postMessage({ type: INTERCEPT_TAG, platform: "doordash", url, data, timestamp: Date.now() }, "*");
    } catch (e) {}
  }

  function postCrawlStatus(status) {
    window.postMessage({ type: CRAWL_STATUS_TAG, ...status }, "*");
  }

  // ---- Patch fetch to capture DoorDash API responses ----

  // No fetch patch for DoorDash — businessId extracted from page scripts,
  // and crawl uses window.fetch directly without interception.

  // ---- Crawl API calls ----

  const PAGE_LIMIT = 20;
  const WEEK_MS = 7 * 86400000;

  function crawlFetch(url, body) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url, true);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.withCredentials = true;
      xhr.timeout = 30000;
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch { reject(new Error("Invalid JSON")); }
        } else {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.ontimeout = () => reject(new Error("Timeout"));
      xhr.send(JSON.stringify(body));
    });
  }

  // fetchOrderDetail removed — orders_details endpoint hangs from content script context.
  // We normalize from list data instead.

  function getStoreAndBusinessIds() {
    const storeId = extractStoreId();
    const businessId = extractBusinessId() || extractBusinessIdFromPage();
    if (!businessId) {
      throw new Error("Business ID not found. Navigate away and back to the orders page, then try sync again.");
    }
    return { storeId, businessId };
  }

  async function fetchOrderPage(businessId, storeId, dateGte, dateLt) {
    const requestBody = {
      businessIds: [businessId],
      organizations: [],
      storeIds: storeId ? [storeId] : [],
      type: "history",
      statuses: [],
      subStatuses: [],
      dateGte,
      dateLt,
      limit: PAGE_LIMIT,
    };
    console.log("[Profit Duck] get_orders request:", JSON.stringify(requestBody));
    return crawlFetch(ORDER_LIST_URL, requestBody);
  }



  function extractStoreId() {
    // Try to find storeId from URL params or page content
    const match = window.location.search.match(/store_id=(\d+)/i);
    if (match) return parseInt(match[1]);
    // Try from cookie or meta
    const cookieMatch = document.cookie.match(/selectedStoreId=(\d+)/);
    if (cookieMatch) return parseInt(cookieMatch[1]);
    // Try from page state — look for store name element
    return null;
  }

  function extractBusinessId() {
    const match = window.location.search.match(/business_id=(\d+)/i);
    if (match) return parseInt(match[1], 10);
    const cookieMatch = document.cookie.match(/selectedBusinessId=(\d+)/);
    if (cookieMatch) return parseInt(cookieMatch[1], 10);
    return null;
  }

  function extractBusinessIdFromPage() {
    // Scan inline script tags for businessId or business_id
    try {
      const scripts = document.querySelectorAll("script");
      for (const s of scripts) {
        if (s.textContent.includes("businessId") || s.textContent.includes("business_id")) {
          const m = s.textContent.match(/business[_I]d["\s:=]+(\d+)/);
          if (m) return parseInt(m[1], 10);
        }
      }
    } catch {}
    // Fallback: scan performance entries for URLs containing business_id
    try {
      const entries = performance.getEntriesByType("resource");
      for (const entry of entries) {
        const m = entry.name.match(/business_id=(\d+)/);
        if (m) return parseInt(m[1], 10);
      }
    } catch {}
    return null;
  }

  // ---- Normalize order list entry into csvRow for server ----
  // Uses data from get_orders (list endpoint), NOT orders_details (which hangs)

  function normalizeListOrderToCsvRow(order) {
    if (!order?.orderId) return null;
    const fmt = (n) => n.toFixed(2);
    const pad = (n) => String(n).padStart(2, "0");

    const completedAt = order.completedTime ? new Date(order.completedTime) : new Date();
    const orderDate = `${completedAt.getFullYear()}-${pad(completedAt.getMonth() + 1)}-${pad(completedAt.getDate())}`;
    const orderTime = `${pad(completedAt.getHours())}:${pad(completedAt.getMinutes())}:${pad(completedAt.getSeconds())}`;

    // orderValue from list has unitAmount in cents
    const subtotal = (order.orderValue?.unitAmount || 0) / 100;
    const customerName = order.consumer?.formalNameAbbreviated || order.consumer?.formalName || "";
    const status = order.orderStatusDisplay || order.orderStatusValue || "Completed";

    return {
      "doordash_order_id": order.orderId,
      "delivery_uuid": order.deliveryUuid || "",
      "timestamp_local_date": orderDate,
      "timestamp_local_time": orderTime,
      "timestamp_utc_date": completedAt.toISOString().slice(0, 10),
      "timestamp_utc_time": completedAt.toISOString().slice(11, 19),
      "transaction_type": "Order",
      "channel": "Marketplace",
      "final_order_status": status,
      "currency": order.orderValue?.currency || "USD",
      "subtotal": fmt(subtotal),
      "customer_name": customerName,
      "source": "extension",
    };
  }

  // ---- Listen for crawl commands ----

  window.addEventListener("message", async (event) => {
    if (!event.data || event.data.type !== "PROFITDUCK_CRAWL") return;

    const command = event.data.command;
    if (command === "stop") {
      crawlAbort = true;
      crawlActive = false;
      postCrawlStatus({ state: "done", message: "Stopped." });
      return;
    }

    if (crawlActive) return;
    crawlActive = true;
    crawlAbort = false;

    try {
      const { storeId, businessId } = getStoreAndBusinessIds();
      postCrawlStatus({ state: "scanning", message: "Fetching DoorDash orders..." });

      // Determine date range
      let rangeStart, rangeEnd;
      if (command === "date-range-sync" && event.data.startDate) {
        rangeStart = new Date(event.data.startDate + "T00:00:00Z");
        rangeEnd = event.data.endDate
          ? new Date(event.data.endDate + "T23:59:59Z")
          : new Date();
      } else {
        // Smart sync: last 30 days
        rangeStart = new Date(Date.now() - 30 * 86400000);
        rangeEnd = new Date();
      }

      const isFullSync = command === "full-sync";

      // Paginate in weekly windows (DoorDash rejects large ranges)
      let allOrders = [];
      let windowEnd = rangeEnd.getTime();
      const windowStart = rangeStart?.getTime() || 0;
      let emptyWeeks = 0;

      while (isFullSync ? (emptyWeeks < 3) : (windowEnd > windowStart)) {
        if (crawlAbort) break;
        const wStart = isFullSync
          ? windowEnd - WEEK_MS
          : Math.max(windowEnd - WEEK_MS, windowStart);
        postCrawlStatus({
          state: "scanning",
          message: `Scanning week of ${new Date(wStart).toLocaleDateString()}...`,
        });

        try {
          const listResponse = await fetchOrderPage(
            businessId, storeId,
            new Date(wStart).toISOString(),
            new Date(windowEnd).toISOString()
          );
          const orders = listResponse?.orders || [];
          allOrders = allOrders.concat(orders);
          console.log(`[Profit Duck] Week ${new Date(wStart).toLocaleDateString()}: ${orders.length} orders`);

          if (isFullSync) {
            emptyWeeks = orders.length === 0 ? emptyWeeks + 1 : 0;
          }
        } catch (err) {
          console.warn(`[Profit Duck] Failed to fetch week:`, err.message);
        }

        windowEnd = wStart;
        // Rate limit between list requests
        await new Promise(r => setTimeout(r, 500));
      }

      console.log(`[Profit Duck] Scan complete: ${allOrders.length} total orders found`);

      if (allOrders.length === 0) {
        postCrawlStatus({ state: "done", message: "No orders found in date range." });
        return;
      }

      // Load known order IDs for dedup (smart-sync skips known orders entirely)
      let knownIds = new Set();
      if (command === "smart-sync") {
        try {
          knownIds = await new Promise((resolve) => {
            window.postMessage({ type: "PROFITDUCK_GET_KNOWN_IDS", platform: "doordash" }, "*");
            const handler = (ev) => {
              if (ev.data?.type === "PROFITDUCK_KNOWN_IDS_RESULT") {
                window.removeEventListener("message", handler);
                resolve(new Set(ev.data.orderIds || []));
              }
            };
            window.addEventListener("message", handler);
            setTimeout(() => { window.removeEventListener("message", handler); resolve(new Set()); }, 5000);
          });
          console.log(`[Profit Duck] ${knownIds.size} DoorDash orders already in database`);
        } catch (e) {
          console.warn("[Profit Duck] Could not load known IDs:", e.message);
        }
      }

      console.log(`[Profit Duck] Known IDs: ${knownIds.size}, command: ${command}`);

      // Filter out already-known orders
      const newOrders = knownIds.size > 0
        ? allOrders.filter(o => !knownIds.has(o.orderId))
        : allOrders;
      const skippedCount = allOrders.length - newOrders.length;

      console.log(`[Profit Duck] After filter: ${newOrders.length} new, ${skippedCount} skipped`);

      if (newOrders.length === 0) {
        postCrawlStatus({ state: "done", message: `All ${allOrders.length} orders already synced.` });
        return;
      }

      postCrawlStatus({
        state: "fetching",
        message: `Fetching details for ${newOrders.length} new orders (${skippedCount} already synced)...`,
        total: newOrders.length,
        current: 0,
      });

      // Normalize directly from list data (detail endpoint hangs from content script)
      const csvRows = [];
      for (const order of newOrders) {
        const row = normalizeListOrderToCsvRow(order);
        if (row) csvRows.push(row);
      }

      console.log(`[Profit Duck] Normalized ${csvRows.length} orders from list data`);

      // Send to server via bridge (MAIN world can't reach localhost due to CSP)
      if (csvRows.length > 0) {
        postCrawlStatus({ state: "syncing", message: `Syncing ${csvRows.length} orders to server...` });
        window.postMessage({
          type: "PROFITDUCK_SEND_ORDERS",
          platform: "doordash",
          csvRows: csvRows,
        }, "*");
        // Wait for bridge to send to server
        await new Promise(r => setTimeout(r, 5000));
      }

      postCrawlStatus({
        state: "done",
        message: `Done! ${csvRows.length} new, ${skippedCount} already synced.`,
      });
    } catch (err) {
      postCrawlStatus({ state: "error", message: err.message || "DoorDash sync failed" });
    } finally {
      crawlActive = false;
      crawlAbort = false;
    }
  });

  console.log("[Profit Duck] DoorDash content script loaded — intercepting order API calls");
})();
