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

  console.log("[Profit Duck] DoorDash bridge loaded");
})();
