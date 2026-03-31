/**
 * MAIN world content script — Profit Duck DoorDash data capture.
 *
 * Fetches order list from DoorDash merchant API, normalizes to csvRow format,
 * and sends to server via bridge → background.
 *
 * Data flow: get_orders API → normalize → postMessage → bridge → background → server
 */
(function () {
  "use strict";

  const CRAWL_STATUS_TAG = "PROFITDUCK_CRAWL_STATUS";
  const API_BASE = "https://merchant-portal.doordash.com";
  const ORDER_LIST_URL = API_BASE + "/merchant-analytics-service/api/v1/get_orders";

  let crawlActive = false;
  let crawlAbort = false;

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

  // ---- Normalize order to csvRow (merges list + detail data) ----

  function normalizeOrderToCsvRow(order, detail) {
    if (!order?.orderId) return null;
    const cents = (obj) => ((obj?.unitAmount || 0) / 100);
    const fmt = (n) => n.toFixed(2);
    const pad = (n) => String(n).padStart(2, "0");

    const completedAt = order.completedTime ? new Date(order.completedTime) : new Date();
    const orderDate = `${completedAt.getFullYear()}-${pad(completedAt.getMonth() + 1)}-${pad(completedAt.getDate())}`;
    const orderTime = `${pad(completedAt.getHours())}:${pad(completedAt.getMinutes())}:${pad(completedAt.getSeconds())}`;

    // List data (always available)
    const subtotal = (order.orderValue?.unitAmount || 0) / 100;
    const customerName = order.consumer?.formalNameAbbreviated || order.consumer?.formalName || "";
    const status = order.orderStatusDisplay || order.orderStatusValue || "Completed";

    // Detail data (from orders_details API, may be null)
    const od = detail?.data;
    const hasDetail = !!od;

    // Extract items from detail
    const items = [];
    if (od?.orders && Array.isArray(od.orders)) {
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
    if (od?.feeGroups?.ad_fees?.totalAmount) marketingFee = Math.abs(cents(od.feeGroups.ad_fees.totalAmount));

    const fulfillment = od?.fulfillmentType || order.fulfillmentDetails?.fulfillmentType || "";
    const channel = fulfillment.toLowerCase().includes("pickup") ? "Pickup"
      : fulfillment.toLowerCase().includes("storefront") ? "Storefront" : "Marketplace";

    const row = {
      "doordash_order_id": order.orderId,
      "delivery_uuid": order.deliveryUuid || "",
      "timestamp_local_date": orderDate,
      "timestamp_local_time": orderTime,
      "timestamp_utc_date": completedAt.toISOString().slice(0, 10),
      "timestamp_utc_time": completedAt.toISOString().slice(11, 19),
      "transaction_type": "Order",
      "channel": channel,
      "final_order_status": od?.orderStatusDetails?.value || status,
      "currency": order.orderValue?.currency || "USD",
      "subtotal": fmt(subtotal),
      "customer_name": customerName,
      "source": "extension",
    };

    // Enrich with detail data if available
    if (hasDetail) {
      row["subtotal_tax_passed_to_merchant"] = fmt(cents(od.tax || od.totalTax));
      row["commission"] = fmt(-Math.abs(cents(od.commission)));
      row["payment_processing_fee"] = fmt(-Math.abs(cents(od.paymentProcessingFee || od.processingFee)));
      row["tablet_fee"] = fmt(-Math.abs(cents(od.tabletFee)));
      row["marketing_fees"] = fmt(-Math.abs(marketingFee));
      row["error_charges"] = fmt(-Math.abs(cents(od.errorCharges)));
      row["adjustments"] = fmt(cents(od.adjustments));
      row["net_total"] = fmt(cents(od.netPayout));
      row["tip"] = fmt(cents(od.merchantTipAmount));
      row["commission_rate"] = String(od.commissionRate || "");
      row["description"] = items.map(i => `${i.quantity}x ${i.name}`).join(", ");
      row["items_json"] = items.length > 0 ? JSON.stringify(items) : "";
    }

    return row;
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

      // Fetch order details via background service worker (page context fetch hangs)
      postCrawlStatus({ state: "fetching", message: `Fetching details for ${newOrders.length} orders...` });

      const uuids = newOrders.map(o => o.deliveryUuid).filter(Boolean);
      let details = {};

      try {
        details = await new Promise((resolve) => {
          window.postMessage({ type: "PROFITDUCK_FETCH_DD_DETAILS", uuids, storeId: extractStoreId() }, "*");
          const handler = (ev) => {
            if (ev.data?.type === "PROFITDUCK_DD_DETAILS_RESULT") {
              window.removeEventListener("message", handler);
              resolve(ev.data.details || {});
            }
          };
          window.addEventListener("message", handler);
          // Timeout after 2 min for all details
          setTimeout(() => { window.removeEventListener("message", handler); resolve({}); }, 120000);
        });
        console.log(`[Profit Duck] Got details for ${Object.keys(details).length}/${uuids.length} orders`);
      } catch (e) {
        console.warn("[Profit Duck] Detail fetch failed:", e.message);
      }

      const csvRows = [];
      for (const order of newOrders) {
        const detail = details[order.deliveryUuid] || null;
        const row = normalizeOrderToCsvRow(order, detail);
        if (row) csvRows.push(row);
      }

      const enrichedCount = Object.keys(details).length;
      console.log(`[Profit Duck] Normalized ${csvRows.length} orders (${enrichedCount} enriched)`);

      // Send to server via bridge
      if (csvRows.length > 0) {
        postCrawlStatus({ state: "syncing", message: `Syncing ${csvRows.length} orders to server...` });
        window.postMessage({
          type: "PROFITDUCK_SEND_ORDERS",
          platform: "doordash",
          csvRows: csvRows,
        }, "*");
        await new Promise(r => setTimeout(r, 5000));
      }

      postCrawlStatus({
        state: "done",
        message: `Done! ${csvRows.length} new (${detailSuccess} enriched), ${skippedCount} already synced.`,
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
