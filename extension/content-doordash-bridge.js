/**
 * DoorDash ISOLATED world bridge — relays messages between MAIN world
 * content script and background service worker.
 *
 * Data flows:
 *   MAIN → bridge → background: csvRows for server, crawl status
 *   background → storage → bridge → MAIN: sync trigger commands
 *   MAIN → bridge → background → bridge → MAIN: known IDs for dedup
 */
(function () {
  "use strict";

  // MAIN world → background
  window.addEventListener("message", (event) => {
    if (!event.data) return;

    if (event.data.type === "PROFITDUCK_SEND_ORDERS" && event.data.platform === "doordash") {
      // Route csvRows through background (its fetch isn't subject to page CORS)
      chrome.runtime.sendMessage({
        action: "send_doordash_csvrows",
        csvRows: event.data.csvRows || [],
      }, (response) => {
        if (response?.ok) {
          console.log(`[Profit Duck] Server accepted ${response.inserted || 0} new, ${response.skipped || 0} skipped`);
        } else {
          console.error(`[Profit Duck] Server error:`, response?.error || "unknown");
        }
      });
    } else if (event.data.type === "PROFITDUCK_DD_FETCH_DETAIL") {
      // Fetch order detail from ISOLATED world (not affected by page's service worker)
      const uuid = event.data.deliveryUuid;
      fetch("https://merchant-portal.doordash.com/merchant-analytics-service/api/v1/orders_details/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ deliveryUuid: uuid }),
      })
        .then(r => r.ok ? r.json() : null)
        .then(json => {
          window.postMessage({ type: "PROFITDUCK_DD_DETAIL_RESULT", deliveryUuid: uuid, data: json }, "*");
        })
        .catch(() => {
          window.postMessage({ type: "PROFITDUCK_DD_DETAIL_RESULT", deliveryUuid: uuid, data: null }, "*");
        });
    } else if (event.data.type === "PROFITDUCK_DD_SCRAPED_DETAIL") {
      // Store scraped order detail for enrichment during sync
      chrome.runtime.sendMessage({
        action: "store_dd_detail",
        deliveryUuid: event.data.deliveryUuid,
        detail: event.data.detail,
      });
    } else if (event.data.type === "PROFITDUCK_STORE_DD_HEADERS") {
      // Store GraphQL headers for background to use during sync
      chrome.storage.local.set({ ddGqlHeaders: event.data.headers });
    } else if (event.data.type === "PROFITDUCK_FETCH_DD_DETAILS") {
      // Route detail fetches through background (page context fetch hangs)
      chrome.runtime.sendMessage({
        action: "fetch_doordash_details",
        uuids: event.data.uuids || [],
        storeId: event.data.storeId || "",
      }, (response) => {
        window.postMessage({ type: "PROFITDUCK_DD_DETAILS_RESULT", details: response?.details || {} }, "*");
      });
    } else if (event.data.type === "PROFITDUCK_GET_KNOWN_IDS") {
      chrome.runtime.sendMessage({ action: "get_known_ids", platform: "doordash" }, (response) => {
        window.postMessage({ type: "PROFITDUCK_KNOWN_IDS_RESULT", orderIds: response?.orderIds || [] }, "*");
      });
    } else if (event.data.type === "PROFITDUCK_CRAWL_STATUS") {
      chrome.runtime.sendMessage({
        action: "crawl_status",
        platform: "doordash",
        state: event.data.state,
        message: event.data.message,
        total: event.data.total,
        current: event.data.current,
      }).catch(() => {});
    }
  });

  // Sync trigger: background writes syncRequest to storage, bridge relays to MAIN world
  let lastSyncTs = 0;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.syncRequest?.newValue) {
      const req = changes.syncRequest.newValue;
      if (req.platform && req.platform !== "doordash" && req.platform !== "all") return;
      if (req.ts > lastSyncTs) {
        lastSyncTs = req.ts;
        window.postMessage({
          type: "PROFITDUCK_CRAWL",
          command: req.command,
          startDate: req.startDate,
          endDate: req.endDate,
        }, "*");
        chrome.storage.local.remove("syncRequest");
      }
    }
  });

  console.log("[Profit Duck] DoorDash bridge active");
})();
