/**
 * MAIN world content script — Profit Duck DoorDash data capture.
 *
 * Intercepts API calls from the DoorDash merchant portal and
 * extracts order data for sync to Profit Duck.
 *
 * TODO: Complete after researching DoorDash portal API patterns.
 */
(function () {
  "use strict";

  const INTERCEPT_TAG = "PROFITDUCK_INTERCEPTED";
  const CRAWL_STATUS_TAG = "PROFITDUCK_CRAWL_STATUS";

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

  // ---- Patch fetch to capture API responses ----

  const nativeFetch = window.fetch;
  window.fetch = function (...args) {
    if (skipIntercept) return nativeFetch.apply(this, args);

    const request = args[0];
    const url = typeof request === "string" ? request
      : request instanceof Request ? request.url : String(request);

    const fetchPromise = nativeFetch.apply(this, args);

    // Intercept DoorDash API calls that contain order data
    // TODO: Refine URL patterns after DevTools research
    if (/\/api\/|graphql|\/orders/i.test(url) && !/\.js|\.css|\.png|\.svg/.test(url)) {
      fetchPromise.then((response) => {
        const clone = response.clone();
        clone.json().then((json) => {
          // Only post data that looks like it contains order information
          if (json && (json.orders || json.data || json.order_details || json.items)) {
            postIntercepted(url, json);
          }
        }).catch(() => {});
        return response;
      }).catch(() => {});
    }

    return fetchPromise;
  };

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
      postCrawlStatus({ state: "starting", message: "Starting DoorDash sync..." });

      // TODO: Implement DoorDash-specific crawl logic after API research
      // - Navigate to orders page if not already there
      // - Scroll/paginate to load orders
      // - Extract order data from API responses or DOM
      // - Fetch individual order details if needed

      postCrawlStatus({ state: "done", message: "DoorDash sync not yet implemented — use CSV import for now." });
    } catch (err) {
      postCrawlStatus({ state: "error", message: err.message || "DoorDash sync failed" });
    } finally {
      crawlActive = false;
      crawlAbort = false;
    }
  });

  console.log("[Profit Duck] DoorDash content script loaded — intercepting API calls");
})();
