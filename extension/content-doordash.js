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

  async function crawlFetch(url, body) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

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

  // ---- Normalize order detail into csvRow for server ----

  function normalizeOrderToCsvRow(json) {
    const od = json?.data;
    if (!od?.orderId) return null;
    const cents = (obj) => (obj?.unitAmount || 0) / 100;
    const fmt = (n) => n.toFixed(2);
    const completedAt = od.completedTime ? new Date(od.completedTime) : new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const orderDate = `${completedAt.getFullYear()}-${pad(completedAt.getMonth() + 1)}-${pad(completedAt.getDate())}`;
    const orderTime = `${pad(completedAt.getHours())}:${pad(completedAt.getMinutes())}:${pad(completedAt.getSeconds())}`;

    const items = [];
    if (od.orders && Array.isArray(od.orders)) {
      for (const g of od.orders) {
        for (const item of (g.orderItems || [])) {
          const extras = (item.itemExtras || []).map(e => {
            const opt = e.itemExtraOptions || e.itemExtraOptionsList?.[0];
            return { name: e.name || "", option: opt?.name || "", price: cents(opt?.price) };
          }).filter(e => e.option);
          items.push({ name: item.name, quantity: item.quantity, price: cents(item.price), category: item.category || "", extras });
        }
      }
    }

    let marketingFee = 0;
    if (od.feeGroups?.ad_fees?.totalAmount) marketingFee = Math.abs(cents(od.feeGroups.ad_fees.totalAmount));

    const fulfillment = od.fulfillmentType || "";
    const channel = fulfillment.toLowerCase().includes("pickup") ? "Pickup"
      : fulfillment.toLowerCase().includes("storefront") ? "Storefront" : "Marketplace";

    return {
      "doordash_order_id": od.orderId,
      "delivery_uuid": od.deliveryUuid || "",
      "timestamp_local_date": orderDate,
      "timestamp_local_time": orderTime,
      "timestamp_utc_date": completedAt.toISOString().slice(0, 10),
      "timestamp_utc_time": completedAt.toISOString().slice(11, 19),
      "transaction_type": "Order",
      "channel": channel,
      "final_order_status": od.orderStatusDetails?.value || "DELIVERED_ORDER",
      "currency": "USD",
      "subtotal": fmt(cents(od.preTaxTotal)),
      "subtotal_tax_passed_to_merchant": fmt(cents(od.tax || od.totalTax)),
      "commission": fmt(-Math.abs(cents(od.commission))),
      "payment_processing_fee": fmt(-Math.abs(cents(od.paymentProcessingFee || od.processingFee))),
      "tablet_fee": fmt(-Math.abs(cents(od.tabletFee))),
      "marketing_fees": fmt(-Math.abs(marketingFee)),
      "error_charges": fmt(-Math.abs(cents(od.errorCharges))),
      "adjustments": fmt(cents(od.adjustments)),
      "net_total": fmt(cents(od.netPayout)),
      "description": items.map(i => `${i.quantity}x ${i.name}`).join(", "),
      "customer_name": od.consumer?.formalNameAbbreviated || "",
      "tip": fmt(cents(od.merchantTipAmount)),
      "commission_rate": String(od.commissionRate || ""),
      "items_json": JSON.stringify(items),
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

      console.log(`[Profit Duck] Starting detail fetch for ${newOrders.length} orders. First: ${newOrders[0]?.orderId}, UUID: ${newOrders[0]?.deliveryUuid}`);

      let fetched = 0;
      const csvRows = [];
      for (const order of newOrders) {
        if (crawlAbort) {
          postCrawlStatus({ state: "done", message: `Stopped — ${fetched} orders captured.` });
          break;
        }

        try {
          const json = await fetchOrderDetail(order.deliveryUuid);
          const row = normalizeOrderToCsvRow(json);
          if (row) csvRows.push(row);
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

      // Send normalized csvRows to server via bridge one at a time (large batches fail postMessage)
      if (csvRows.length > 0) {
        postCrawlStatus({ state: "syncing", message: `Syncing ${csvRows.length} orders to server...` });
        for (let i = 0; i < csvRows.length; i++) {
          window.postMessage({
            type: "PROFITDUCK_SEND_ORDERS",
            platform: "doordash",
            csvRows: [csvRows[i]],
          }, "*");
          // Small delay between sends
          if (i % 5 === 4) await new Promise(r => setTimeout(r, 1000));
        }
        // Wait for bridge to finish sending
        await new Promise(r => setTimeout(r, 3000));
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
