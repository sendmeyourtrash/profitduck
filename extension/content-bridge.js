/**
 * Uber Eats ISOLATED world bridge — relays messages between MAIN world
 * content script and background service worker.
 *
 * Data flows:
 *   MAIN → bridge → background: intercepted orders, crawl status, auto-flush
 *   background → storage → bridge → MAIN: sync trigger commands
 *   MAIN → bridge → background → bridge → MAIN: known IDs for dedup
 */
(function () {
  "use strict";

  // MAIN world → background
  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) return;

    if (event.data.type === "PROFITDUCK_INTERCEPTED") {
      chrome.runtime.sendMessage({
        action: "api_intercepted",
        platform: event.data.platform,
        url: event.data.url,
        data: event.data.data,
        timestamp: event.data.timestamp,
      });
    } else if (event.data.type === "PROFITDUCK_AUTO_FLUSH") {
      chrome.runtime.sendMessage({ action: "auto_flush" });
    } else if (event.data.type === "PROFITDUCK_CRAWL_STATUS") {
      chrome.runtime.sendMessage({
        action: "crawl_status",
        platform: "ubereats",
        state: event.data.state,
        message: event.data.message,
        total: event.data.total,
        current: event.data.current,
        fetched: event.data.fetched,
        errors: event.data.errors,
      });
    } else if (event.data.type === "PROFITDUCK_GET_KNOWN_IDS") {
      chrome.runtime.sendMessage({ action: "get_known_ids", platform: "ubereats" }, (response) => {
        window.postMessage({ type: "PROFITDUCK_KNOWN_IDS_RESULT", orderIds: response?.orderIds || [] }, "*");
      });
    }
  });

  // Sync trigger: background writes syncRequest to storage, bridge relays to MAIN world
  let lastSyncTs = 0;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.syncRequest?.newValue) {
      const req = changes.syncRequest.newValue;
      if (req.platform && req.platform !== "ubereats" && req.platform !== "all") return;
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

  console.log("[Profit Duck] Uber Eats bridge active");
})();
