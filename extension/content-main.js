/**
 * MAIN world content script — Profit Duck Uber Eats data capture.
 *
 * Modes:
 *   - idle: Extension loaded, waiting for user to enable sync
 *   - smart-sync: Fetch new orders until hitting known order IDs (default after first sync)
 *   - full-sync: Re-fetch all orders regardless of what's in DB
 *   - date-range: Fetch orders within a specific date range
 */
(function () {
  "use strict";

  const INTERCEPT_TAG = "PROFITDUCK_INTERCEPTED";
  const CRAWL_STATUS_TAG = "PROFITDUCK_CRAWL_STATUS";

  let skipIntercept = false;
  let crawlActive = false;
  let crawlAbort = false;

  // Known order IDs (populated from server before smart-sync)
  let knownOrderIds = new Set();

  // ---- Messaging helpers ----

  function postIntercepted(url, data) {
    try {
      window.postMessage({ type: INTERCEPT_TAG, platform: "ubereats", url, data, timestamp: Date.now() }, "*");
    } catch (e) {}
  }

  function postCrawlStatus(status) {
    window.postMessage({ type: CRAWL_STATUS_TAG, ...status }, "*");
  }

  // ---- Patch fetch to capture GraphQL responses ----

  const nativeFetch = window.fetch;
  window.fetch = function (...args) {
    if (skipIntercept) return nativeFetch.apply(this, args);

    const request = args[0];
    const url = typeof request === "string" ? request
      : request instanceof Request ? request.url : String(request);

    const fetchPromise = nativeFetch.apply(this, args);

    if (/graphql/i.test(url)) {
      fetchPromise.then((response) => {
        const clone = response.clone();
        clone.json().then((json) => postIntercepted(url, json)).catch(() => {});
        return response;
      }).catch(() => {});
    }

    return fetchPromise;
  };

  // ---- Extract order UUIDs from React fiber state ----

  function extractOrderLinks() {
    const links = [];
    const seen = new Set();
    const rows = document.querySelectorAll('tr[data-testid="ordersRevamped-row"]');

    for (const row of rows) {
      const reactKey = Object.keys(row).find(k => k.startsWith('__reactFiber$'));
      if (!reactKey) continue;
      let fiber = row[reactKey];
      while (fiber) {
        if (fiber.memoizedProps?.orders && Array.isArray(fiber.memoizedProps.orders)) {
          for (const order of fiber.memoizedProps.orders) {
            const uuid = order.workflowUuid || order.workflowUUID || order.uuid || order.id;
            if (uuid && !seen.has(uuid)) {
              seen.add(uuid);
              links.push({ workflowUUID: uuid, orderId: order.orderId || "" });
            }
          }
          break;
        }
        fiber = fiber.return;
      }
      if (links.length > 0) break; // All orders are in the same fiber node
    }
    return links;
  }

  function getRestaurantUUID() {
    const urlMatch = window.location.search.match(/restaurantUUID=([0-9a-f-]{36})/i);
    if (urlMatch) return urlMatch[1];
    const cookieMatch = document.cookie.match(/selectedRestaurant=([0-9a-f-]{36})/i);
    return cookieMatch ? cookieMatch[1] : null;
  }

  // ---- Scroll to load all orders (infinite scroll) ----

  async function scrollToLoadAll() {
    console.log("[Profit Duck] Scrolling to load all orders...");
    postCrawlStatus({ state: "scanning", message: "Loading all orders..." });

    let lastCount = 0;
    let stableRounds = 0;

    while (stableRounds < 3) {
      if (crawlAbort) return 0;
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 1500));

      const currentCount = document.querySelectorAll('tr[data-testid="ordersRevamped-row"]').length;
      console.log(`[Profit Duck] Scrolled — ${currentCount} rows visible`);

      if (currentCount === lastCount) {
        stableRounds++;
      } else {
        stableRounds = 0;
        lastCount = currentCount;
      }
    }

    window.scrollTo(0, 0);
    console.log(`[Profit Duck] All orders loaded: ${lastCount} rows`);
    return lastCount;
  }

  // ---- Fetch a single order's details via GraphQL ----

  const ORDER_DETAILS_QUERY = "query OrderDetails($workflowUUID:ID!,$metadata:Orders_OrderDetailsMetadataInput,$shouldEnableChargebackComms:Boolean,$detailsRequestedByRestaurantUUID:ID){orderDetails(workflowUUID:$workflowUUID,metadata:$metadata,shouldEnableChargebackComms:$shouldEnableChargebackComms,detailsRequestedByRestaurantUUID:$detailsRequestedByRestaurantUUID){requestedAt orderId orderUUID completedAtTimestamp checkoutInfo{key amount __typename}marketplaceFeeRate netPayout items{name price quantity specialInstructions customizations{name options{name quantity price __typename}__typename}__typename}fulfillmentType eater{name numOrders uuid __typename}issueSummary{orderJobState adjustmentAmount customerRefund __typename}__typename}}";

  async function fetchOrderDetail(workflowUUID, restaurantUUID) {
    skipIntercept = true;
    try {
      const response = await window.fetch("https://merchants.ubereats.com/manager/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": "x" },
        credentials: "include",
        body: JSON.stringify({
          operationName: "OrderDetails",
          variables: {
            workflowUUID,
            metadata: { isEatsPassSubscriber: false },
            shouldEnableChargebackComms: true,
            detailsRequestedByRestaurantUUID: restaurantUUID,
          },
          query: ORDER_DETAILS_QUERY,
        }),
      });
      skipIntercept = false;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      if (json.errors) throw new Error(json.errors[0]?.message || "GQL error");
      return json;
    } catch (err) {
      skipIntercept = false;
      throw err;
    }
  }

  // ---- Load known order IDs from server for smart-sync ----

  async function loadKnownOrderIds() {
    try {
      const response = await fetch("http://localhost:3000/api/ingest/extension?action=known_ids&platform=ubereats");
      if (!response.ok) return new Set();
      const data = await response.json();
      return new Set(data.orderIds || []);
    } catch {
      return new Set();
    }
  }

  // ---- Main sync function ----

  async function startSync(mode = "smart", options = {}) {
    if (crawlActive) return;
    crawlActive = true;
    crawlAbort = false;

    console.log(`[Profit Duck] Starting ${mode} sync...`);
    postCrawlStatus({ state: "scanning", message: `${mode === "full" ? "Full" : "Smart"} sync — loading orders...` });

    // Step 1: Scroll to load all visible orders
    await scrollToLoadAll();
    if (crawlAbort) { crawlActive = false; return; }

    // Step 2: Extract all order links from React state
    const allLinks = extractOrderLinks();
    if (allLinks.length === 0) {
      postCrawlStatus({ state: "error", message: "No orders found. Make sure you're on Orders > History." });
      crawlActive = false;
      return;
    }

    const restaurantUUID = getRestaurantUUID();
    if (!restaurantUUID) {
      postCrawlStatus({ state: "error", message: "No restaurant UUID found in URL." });
      crawlActive = false;
      return;
    }

    // Step 3: For smart-sync, load known IDs to know when to stop
    let consecutiveKnown = 0;
    const KNOWN_THRESHOLD = 3; // Stop after 3 consecutive known orders

    if (mode === "smart") {
      postCrawlStatus({ state: "scanning", message: "Checking for new orders..." });
      knownOrderIds = await loadKnownOrderIds();
      console.log(`[Profit Duck] ${knownOrderIds.size} orders already in database`);

      if (knownOrderIds.size === 0) {
        // First run — switch to full sync
        console.log("[Profit Duck] No existing orders — switching to full sync");
        mode = "full";
      }
    }

    // Step 4: Filter links based on mode
    let linksToFetch = allLinks;

    if (mode === "date-range" && options.startDate && options.endDate) {
      // Date filtering happens after fetch since we need the order date from GraphQL
      console.log(`[Profit Duck] Date range: ${options.startDate} to ${options.endDate}`);
    }

    console.log(`[Profit Duck] ${linksToFetch.length} orders to process, restaurant ${restaurantUUID}`);
    postCrawlStatus({ state: "fetching", total: linksToFetch.length, current: 0, message: `Fetching 0/${linksToFetch.length}...` });

    // Step 5: Fetch each order
    let fetched = 0;
    let skipped = 0;
    let errors = 0;
    let newOrders = 0;

    for (const link of linksToFetch) {
      if (crawlAbort) {
        postCrawlStatus({ state: "aborted", message: `Stopped. ${newOrders} new, ${skipped} known, ${errors} errors.` });
        crawlActive = false;
        return;
      }

      // Smart-sync: skip if already known (but still count for threshold)
      if (mode === "smart" && knownOrderIds.has(link.orderId)) {
        consecutiveKnown++;
        skipped++;
        fetched++;
        console.log(`[Profit Duck] Known: ${link.orderId} (${consecutiveKnown} consecutive)`);
        postCrawlStatus({
          state: "fetching", total: linksToFetch.length, current: fetched,
          message: `${fetched}/${linksToFetch.length} — ${link.orderId} (known)`
        });

        if (consecutiveKnown >= KNOWN_THRESHOLD) {
          console.log(`[Profit Duck] Hit ${KNOWN_THRESHOLD} consecutive known orders — stopping`);
          break;
        }
        continue;
      }

      // Reset consecutive counter on new order
      consecutiveKnown = 0;

      try {
        const json = await fetchOrderDetail(link.workflowUUID, restaurantUUID);

        // Date range filtering
        if (mode === "date-range" && options.startDate && options.endDate) {
          const od = json.data?.orderDetails;
          const ts = od?.requestedAt ? new Date(od.requestedAt * 1000) : null;
          if (ts) {
            const dateStr = ts.toISOString().split("T")[0];
            if (dateStr < options.startDate || dateStr > options.endDate) {
              skipped++;
              fetched++;
              continue;
            }
          }
        }

        // Send to pipeline
        postIntercepted("https://merchants.ubereats.com/manager/graphql", json);
        newOrders++;
        fetched++;

        console.log(`[Profit Duck] OK ${link.orderId} (${fetched}/${linksToFetch.length})`);
        postCrawlStatus({
          state: "fetching", total: linksToFetch.length, current: fetched,
          message: `${fetched}/${linksToFetch.length} — ${link.orderId} (new)`
        });

        // Rate limit: 400ms between requests
        await new Promise(r => setTimeout(r, 400));
      } catch (err) {
        errors++;
        fetched++;
        console.warn(`[Profit Duck] FAIL ${link.orderId}: ${err.message}`);

        if (err.message.includes("429")) {
          postCrawlStatus({ state: "throttled", message: "Rate limited — waiting 10s..." });
          await new Promise(r => setTimeout(r, 10000));
        }
      }
    }

    // Step 6: Auto-sync to server
    postCrawlStatus({
      state: "syncing",
      message: `Syncing ${newOrders} new orders to Profit Duck...`
    });

    // Wait a moment for all postIntercepted messages to be processed
    await new Promise(r => setTimeout(r, 1000));

    // Trigger auto-flush
    window.postMessage({ type: "PROFITDUCK_AUTO_FLUSH" }, "*");

    postCrawlStatus({
      state: "done",
      message: `Done! ${newOrders} new, ${skipped} known${errors ? `, ${errors} errors` : ""}.`,
      fetched: newOrders, skipped, errors,
    });
    crawlActive = false;
  }

  // ---- Listen for commands ----

  window.addEventListener("message", (event) => {
    if (!event.data) return;

    if (event.data.type === "PROFITDUCK_CRAWL") {
      const cmd = event.data.command;
      if (cmd === "stop") {
        crawlAbort = true;
      } else if (cmd === "smart-sync") {
        crawlActive = false; // Reset in case stuck
        startSync("smart");
      } else if (cmd === "full-sync") {
        crawlActive = false;
        startSync("full");
      } else if (cmd === "date-range-sync") {
        crawlActive = false;
        startSync("date-range", { startDate: event.data.startDate, endDate: event.data.endDate });
      } else if (cmd === "start") {
        // Legacy: treat as smart-sync
        crawlActive = false;
        startSync("smart");
      }
    }
  });

  // ---- Idle by default: do NOT auto-start ----
  // The user must click a button or enable sync from the popup.
  // This replaces the old auto-start behavior.

  console.log("[Profit Duck] Extension ready (idle). Waiting for sync command.");
})();
