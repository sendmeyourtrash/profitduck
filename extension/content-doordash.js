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

  // API URL patterns to intercept
  const ORDER_DETAIL_URL = "/merchant-analytics-service/api/v1/orders_details";
  const ORDER_LIST_URL = "/merchant-analytics-service/api/v1/get_orders";

  let skipIntercept = false;
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

  const nativeFetch = window.fetch;
  window.fetch = function (...args) {
    if (skipIntercept) return nativeFetch.apply(this, args);

    const request = args[0];
    const url = typeof request === "string" ? request
      : request instanceof Request ? request.url : String(request);

    const fetchPromise = nativeFetch.apply(this, args);

    // Only intercept order detail responses (these have items, fees, payout)
    if (url.includes(ORDER_DETAIL_URL)) {
      fetchPromise.then((response) => {
        const clone = response.clone();
        clone.json().then((json) => {
          if (json?.data?.orderId) {
            postIntercepted(url, json);
            console.log(`[Profit Duck] DoorDash order detail captured: ${json.data.orderId}`);
          }
        }).catch(() => {});
        return response;
      }).catch(() => {});
    }

    return fetchPromise;
  };

  // ---- Crawl: fetch all order details by iterating the order list ----

  async function fetchOrderList(dateGte, dateLt, limit = 50) {
    skipIntercept = true;
    try {
      // Get business/store IDs from the page URL or existing API calls
      const storeId = extractStoreId();
      const businessId = extractBusinessId();

      const response = await nativeFetch.call(window, ORDER_LIST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          businessIds: businessId ? [businessId] : [],
          organizations: [],
          storeIds: storeId ? [storeId] : [],
          type: "history",
          statuses: [],
          subStatuses: [],
          dateGte: dateGte || new Date(Date.now() - 90 * 86400000).toISOString(),
          dateLt: dateLt || new Date().toISOString(),
          limit,
        }),
      });
      skipIntercept = false;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    } catch (err) {
      skipIntercept = false;
      throw err;
    }
  }

  async function fetchOrderDetail(deliveryUuid) {
    skipIntercept = true;
    try {
      const response = await nativeFetch.call(window, ORDER_DETAIL_URL + "/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ deliveryUuid }),
      });
      skipIntercept = false;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      // Also post to background for capture
      postIntercepted(ORDER_DETAIL_URL, json);
      return json;
    } catch (err) {
      skipIntercept = false;
      throw err;
    }
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
    if (match) return parseInt(match[1]);
    const cookieMatch = document.cookie.match(/selectedBusinessId=(\d+)/);
    if (cookieMatch) return parseInt(cookieMatch[1]);
    return null;
  }

  // ---- Listen for crawl commands ----

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== "PROFITDUCK_CRAWL") return;

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
      postCrawlStatus({ state: "scanning", message: "Fetching DoorDash order list..." });

      // Determine date range
      let dateGte, dateLt;
      if (command === "date-range-sync" && event.data.startDate) {
        dateGte = new Date(event.data.startDate + "T00:00:00Z").toISOString();
        dateLt = event.data.endDate
          ? new Date(event.data.endDate + "T23:59:59Z").toISOString()
          : new Date().toISOString();
      } else {
        // Default: last 90 days
        dateGte = new Date(Date.now() - 90 * 86400000).toISOString();
        dateLt = new Date().toISOString();
      }

      const listResponse = await fetchOrderList(dateGte, dateLt, 200);
      const orders = listResponse?.orders || [];

      if (orders.length === 0) {
        postCrawlStatus({ state: "done", message: "No orders found in date range." });
        return;
      }

      postCrawlStatus({
        state: "fetching",
        message: `Fetching details for ${orders.length} orders...`,
        total: orders.length,
        current: 0,
      });

      let fetched = 0;
      for (const order of orders) {
        if (crawlAbort) {
          postCrawlStatus({ state: "done", message: `Stopped — ${fetched} orders captured.` });
          return;
        }

        try {
          await fetchOrderDetail(order.deliveryUuid);
          fetched++;
          postCrawlStatus({
            state: "fetching",
            message: `Fetching order ${fetched}/${orders.length}...`,
            total: orders.length,
            current: fetched,
          });
        } catch (err) {
          console.warn(`[Profit Duck] Failed to fetch order ${order.orderId}:`, err.message);
          // Continue with next order
        }

        // Rate limit: 400ms between requests
        await new Promise(r => setTimeout(r, 400));
      }

      postCrawlStatus({
        state: "done",
        message: `Done! Captured ${fetched} DoorDash orders.`,
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
