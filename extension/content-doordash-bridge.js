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

    if (event.data?.type === "PROFITDUCK_SEND_ORDERS" && event.data.platform === "doordash") {
      // Send directly to server from bridge (ISOLATED world can reach localhost)
      // Don't go through background — order data is too large for chrome.runtime messages
      (async () => {
        try {
          const { serverUrl, apiKey } = await chrome.storage.local.get(["serverUrl", "apiKey"]);
          const url = (serverUrl || "http://localhost:3000") + "/api/ingest/extension";
          const headers = { "Content-Type": "application/json" };
          if (apiKey) headers["x-api-key"] = apiKey;
          const resp = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({
              platform: "doordash",
              orders: event.data.csvRows || [],
              source: "extension",
              extensionVersion: chrome.runtime.getManifest().version,
            }),
          });
          if (resp.ok) {
            const result = await resp.json();
            console.log(`[Profit Duck] Bridge sent ${event.data.csvRows?.length || 0} DoorDash orders: ${result.inserted} new, ${result.skipped} skipped`);
            // Notify background of sync result
            chrome.runtime.sendMessage({ action: "sync_complete", platform: "doordash", inserted: result.inserted, skipped: result.skipped });
          } else {
            console.error(`[Profit Duck] Bridge send failed: HTTP ${resp.status}`);
          }
        } catch (e) {
          console.error(`[Profit Duck] Bridge send error:`, e.message);
        }
      })();
    }

    if (event.data?.type === "PROFITDUCK_CAPTURED" && event.data.platform === "doordash") {
      chrome.runtime.sendMessage({
        action: "order_captured",
        platform: "doordash",
        orderId: event.data.orderId,
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
        platform: "doordash",
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
      if (req.platform && req.platform !== "doordash" && req.platform !== "all") return;
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
