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

  let skipIntercept = false;
  let crawlActive = false;
  let crawlAbort = false;

  // Captured from DoorDash's own API calls
  let knownBusinessId = null;
  let knownStoreId = null;

  function postIntercepted(url, data) {
    try {
      window.postMessage({ type: INTERCEPT_TAG, platform: "doordash", url, data, timestamp: Date.now() }, "*");
    } catch (e) {}
  }

  function postCrawlStatus(status) {
    window.postMessage({ type: CRAWL_STATUS_TAG, ...status }, "*");
  }

  // ---- Patch fetch to capture DoorDash API responses ----

  const nativeFetch = window.fetch;
  window.fetch = function (...args) {
    if (skipIntercept) return nativeFetch.apply(this, args);

    const request = args[0];
    const url = typeof request === "string" ? request
      : request instanceof Request ? request.url : String(request);

    // Sniff outgoing requests for businessId/storeId
    try {
      if (url.includes(ORDER_LIST_PATH)) {
        const opts = args[1];
        if (opts?.body) {
          const body = JSON.parse(opts.body);
          if (body.businessIds?.[0]) knownBusinessId = body.businessIds[0];
          if (body.storeIds?.[0]) knownStoreId = body.storeIds[0];
        }
      }
      const bizMatch = url.match(/business_id=(\d+)/);
      if (bizMatch && !knownBusinessId) knownBusinessId = parseInt(bizMatch[1], 10);
      const storeMatch = url.match(/store_id=(\d+)/);
      if (storeMatch && !knownStoreId) knownStoreId = parseInt(storeMatch[1], 10);
    } catch {}

    const fetchPromise = nativeFetch.apply(this, args);

    // Only intercept order detail responses (these have items, fees, payout)
    if (url.includes(ORDER_DETAIL_PATH)) {
      fetchPromise.then((response) => {
        const clone = response.clone();
        clone.json().then((json) => {
          if (json?.data?.orderId) {
            postIntercepted(url, json);
            console.log(`[Profit Duck] DoorDash order detail captured: ${json.data.orderId}`);
          }
        }).catch(() => {});
      }).catch(() => {});
    }

    return fetchPromise;
  };

  // ---- Crawl API calls ----

  const PAGE_LIMIT = 20;
  const WEEK_MS = 7 * 86400000;

  async function crawlFetch(url, body) {
    skipIntercept = true;
    try {
      const response = await nativeFetch.call(window, url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      skipIntercept = false;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    } catch (err) {
      skipIntercept = false;
      throw err;
    }
  }

  function getStoreAndBusinessIds() {
    const storeId = knownStoreId || extractStoreId();
    const businessId = knownBusinessId || extractBusinessId() || extractBusinessIdFromPage();
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

  async function fetchOrderDetail(deliveryUuid) {
    const json = await crawlFetch(ORDER_DETAIL_URL + "/", { deliveryUuid });
    // Post lightweight capture event (full data is too large for message channel)
    const orderId = json?.data?.orderId || deliveryUuid;
    try {
      window.postMessage({ type: "PROFITDUCK_CAPTURED", platform: "doordash", orderId }, "*");
    } catch {}
    return json;
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

      // Filter out already-known orders
      const newOrders = knownIds.size > 0
        ? allOrders.filter(o => !knownIds.has(o.orderId))
        : allOrders;
      const skippedCount = allOrders.length - newOrders.length;

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

      let fetched = 0;
      const capturedDetails = [];
      for (const order of newOrders) {
        if (crawlAbort) {
          postCrawlStatus({ state: "done", message: `Stopped — ${fetched} orders captured.` });
          break;
        }

        try {
          const json = await fetchOrderDetail(order.deliveryUuid);
          capturedDetails.push(json);
          fetched++;
          postCrawlStatus({
            state: "fetching",
            message: `Fetching order ${fetched}/${newOrders.length}...`,
            total: newOrders.length,
            current: fetched,
          });
        } catch (err) {
          console.warn(`[Profit Duck] Failed to fetch order ${order.orderId}:`, err.message);
        }

        // Rate limit: 400ms between detail requests
        await new Promise(r => setTimeout(r, 400));
      }

      // Send captured orders to server via bridge (MAIN world can't reach localhost)
      if (capturedDetails.length > 0) {
        postCrawlStatus({ state: "syncing", message: `Syncing ${capturedDetails.length} orders to server...` });
        // Send in batches of 10 to avoid message size limits
        const BATCH_SIZE = 10;
        for (let i = 0; i < capturedDetails.length; i += BATCH_SIZE) {
          const batch = capturedDetails.slice(i, i + BATCH_SIZE);
          window.postMessage({
            type: "PROFITDUCK_SEND_ORDERS",
            platform: "doordash",
            orders: batch,
          }, "*");
          await new Promise(r => setTimeout(r, 500));
        }
        // Wait for server sync to complete
        await new Promise(r => setTimeout(r, 2000));
      }

      postCrawlStatus({
        state: "done",
        message: `Done! ${fetched} new, ${skippedCount} already synced.`,
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
