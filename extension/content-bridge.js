/**
 * ISOLATED world content script — relays messages between the MAIN world
 * content script and the background service worker via chrome.runtime.
 */

(function () {
  "use strict";

  // Relay intercepted API data and crawl status from MAIN → background
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!event.data) return;

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
        state: event.data.state,
        message: event.data.message,
        total: event.data.total,
        current: event.data.current,
        fetched: event.data.fetched,
        errors: event.data.errors,
      });
    }
  });

  // Relay crawl commands from background → MAIN world via DOM attribute
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "start_crawl") {
      // Set DOM attribute that MAIN world polls for
      document.documentElement.setAttribute('data-pd-cmd', 'start');
      console.log("[Profit Duck] Bridge set data-pd-cmd=start");
      sendResponse({ ok: true });
    } else if (message.action === "stop_crawl") {
      document.documentElement.setAttribute('data-pd-cmd', 'stop');
      sendResponse({ ok: true });
    } else if (message.action === "get_order_links") {
      // Ask MAIN world for order links, relay back
      window.postMessage({ type: "PROFITDUCK_GET_LINKS" }, "*");
      // Listen for the response
      const handler = (event) => {
        if (event.source !== window) return;
        if (event.data?.type === "PROFITDUCK_LINKS_RESULT") {
          window.removeEventListener("message", handler);
          sendResponse({ links: event.data.links, restaurantUUID: event.data.restaurantUUID });
        }
      };
      window.addEventListener("message", handler);
      // Timeout after 5s
      setTimeout(() => {
        window.removeEventListener("message", handler);
        sendResponse({ links: [], restaurantUUID: null });
      }, 5000);
      return true; // async response
    }
  });

  // Watch for sync requests via chrome.storage (popup → background → storage → bridge → MAIN)
  let lastSyncTs = 0;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.syncRequest?.newValue) {
      const req = changes.syncRequest.newValue;
      if (req.platform && req.platform !== "ubereats" && req.platform !== "all") return;
      if (req.ts > lastSyncTs) {
        lastSyncTs = req.ts;
        console.log("[Profit Duck] Bridge relaying sync:", req.command);
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

  // Handle known IDs request from MAIN world
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.type === "PROFITDUCK_GET_KNOWN_IDS") {
      chrome.runtime.sendMessage({ action: "get_known_ids", platform: event.data.platform || "ubereats" }, (response) => {
        window.postMessage({ type: "PROFITDUCK_KNOWN_IDS_RESULT", orderIds: response?.orderIds || [] }, "*");
      });
    }
  }, true); // use capture to not conflict with existing listener

  console.log("[Profit Duck] Bridge script active");
})();
