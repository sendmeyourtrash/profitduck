/**
 * ISOLATED world bridge for DoorDash — relays messages between
 * MAIN world content script and background service worker.
 *
 * Same pattern as content-bridge.js (Uber Eats).
 */
(function () {
  "use strict";

  // MAIN world → background
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;

    if (event.data?.type === "PROFITDUCK_INTERCEPTED" && event.data.platform === "doordash") {
      chrome.runtime.sendMessage({
        action: "api_intercepted",
        platform: "doordash",
        data: event.data.data,
        url: event.data.url,
        timestamp: event.data.timestamp,
      }).catch(() => {});
    }

    if (event.data?.type === "PROFITDUCK_GET_KNOWN_IDS") {
      const platform = event.data.platform || "doordash";
      chrome.runtime.sendMessage({ action: "get_known_ids", platform }, (response) => {
        window.postMessage({ type: "PROFITDUCK_KNOWN_IDS_RESULT", orderIds: response?.orderIds || [] }, "*");
      });
    }

    if (event.data?.type === "PROFITDUCK_CRAWL_STATUS") {
      chrome.runtime.sendMessage({
        action: "crawl_status",
        state: event.data.state,
        message: event.data.message,
        total: event.data.total,
        current: event.data.current,
      }).catch(() => {});
    }
  });

  // background → MAIN world (for crawl commands)
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "trigger_crawl") {
      window.postMessage({
        type: "PROFITDUCK_CRAWL",
        command: message.command,
        startDate: message.startDate,
        endDate: message.endDate,
      }, "*");
    }
  });

  // Watch for sync requests via chrome.storage
  let lastSyncTs = 0;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.syncRequest?.newValue) {
      const req = changes.syncRequest.newValue;
      if (req.ts > lastSyncTs) {
        lastSyncTs = req.ts;
        console.log("[Profit Duck] DoorDash bridge relaying sync request:", req.command);
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

  console.log("[Profit Duck] DoorDash bridge loaded");
})();
