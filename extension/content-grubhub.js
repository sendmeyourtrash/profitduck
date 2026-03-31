/**
 * MAIN world content script — Profit Duck GrubHub data capture.
 *
 * Captures Bearer token from page's own API calls, then fetches:
 *   1. Transaction list from accounting API (financial data)
 *   2. Order details for each transaction (items, modifiers, special instructions)
 *
 * Data flow: intercept token → fetch transactions → fetch details → normalize → bridge → server
 */
(function () {
  "use strict";

  const CRAWL_STATUS_TAG = "PROFITDUCK_CRAWL_STATUS";
  const API_BASE = "https://api-order-processing-gtm.grubhub.com";
  const WEEK_MS = 7 * 86400000;

  let crawlActive = false;
  let crawlAbort = false;
  let bearerToken = null;

  function postCrawlStatus(status) {
    window.postMessage({ type: CRAWL_STATUS_TAG, ...status }, "*");
  }

  // ---- Capture Bearer token from page's own API calls ----

  const nativeFetch = window.fetch;
  window.fetch = function (...args) {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
    if (url.includes("grubhub.com") && args[1]?.headers) {
      const h = args[1].headers;
      const auth = h instanceof Headers ? h.get("Authorization") : h.Authorization || h.authorization;
      if (auth && auth.startsWith("Bearer ")) {
        bearerToken = auth;
      }
    }
    return nativeFetch.apply(this, args);
  };

  // ---- Extract store ID from page URL ----

  function extractStoreId() {
    const match = window.location.pathname.match(/\/(\d{5,})/);
    if (match) return match[1];
    const links = document.querySelectorAll("a[href*='/dashboard/'], a[href*='/financials/']");
    for (const link of links) {
      const m = link.href.match(/\/(\d{5,})/);
      if (m) return m[1];
    }
    return null;
  }

  // ---- API fetch with Bearer token ----

  async function apiFetch(url) {
    if (!bearerToken) throw new Error("No auth token captured. Navigate around the portal to capture it.");
    const response = await nativeFetch.call(window, url, {
      headers: { "Accept": "application/json", "Content-Type": "application/json", "Authorization": bearerToken },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function fetchTransactions(storeId, startDate, endDate) {
    return apiFetch(`${API_BASE}/merchant/accounting/v1/${storeId}/transactions?timeZone=America/Chicago&channelGroup=&startDate=${startDate}&endDate=${endDate}`);
  }

  function fetchOrderDetail(storeId, transactionId) {
    return apiFetch(`${API_BASE}/merchant/accounting/v1/${storeId}/orders/transactions/${transactionId}`);
  }

  // ---- Normalize ----

  function cents(val) { return typeof val === "number" ? (val / 100).toFixed(2) : "0.00"; }

  function formatDate(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function normalizeTransaction(txn, detail) {
    const orderId = txn.transaction_id || "";
    if (!orderId) return null;

    const orderDate = txn.transaction_time ? new Date(txn.transaction_time) : new Date();
    const placedAt = txn.placed_at_time ? new Date(txn.placed_at_time) : null;
    const pad = (n) => String(n).padStart(2, "0");
    const dateStr = `${orderDate.getFullYear()}-${pad(orderDate.getMonth() + 1)}-${pad(orderDate.getDate())}`;
    const timeStr = `${pad(orderDate.getHours())}:${pad(orderDate.getMinutes())}:${pad(orderDate.getSeconds())}`;
    const placedTimeStr = placedAt ? `${pad(placedAt.getHours())}:${pad(placedAt.getMinutes())}:${pad(placedAt.getSeconds())}` : "";

    // Extract items from detail response
    const items = [];
    if (detail?.order_details) {
      for (const line of detail.order_details) {
        const modifiers = (line.line_options || []).map(opt => ({
          name: opt.name || "",
          price: (opt.price || 0) / 100,
          quantity: opt.quantity || 1,
        })).filter(m => m.name);

        items.push({
          name: line.name || "",
          quantity: line.quantity || 1,
          price: (line.price || 0) / 100,
          lineTotal: (line.line_total || 0) / 100,
          category: line.category_name || "",
          specialInstructions: line.special_instructions || "",
          modifiers,
        });
      }
    }

    return {
      "order_channel": txn.channel || txn.channel_group || "",
      "order_number": txn.order_number || "",
      "order_date": dateStr,
      "order_time_local": timeStr,
      "transaction_date": dateStr,
      "transaction_time_local": timeStr,
      "transaction_type": txn.transaction_type_description || txn.transaction_type || "",
      "transaction_id": orderId,
      "grubhub_store_id": txn.restaurant_id || extractStoreId() || "",
      "fulfillment_type": txn.delivery_type || "",
      "gh_plus_customer": txn.gh_plus_fee && txn.gh_plus_fee !== 0 ? "GH+" : "",
      // Financial fields — API returns cents, convert to dollars
      "subtotal": cents(txn.subtotal),
      "subtotal_sales_tax": cents(txn.restaurant_sales_tax),
      "self_delivery_charge": cents(txn.restaurant_delivery_charge),
      "merchant_service_fee": cents(txn.restaurant_service_fee),
      "tip": cents(txn.restaurant_tip),
      "merchant_total": cents(txn.restaurant_total),
      "commission": cents(txn.advertising_fee),
      "delivery_commission": cents(txn.grubhub_delivery_fee),
      "gh_plus_commission": cents(txn.gh_plus_fee),
      "processing_fee": cents(txn.processing_fee),
      "withheld_tax": cents(txn.withheld_sales_tax),
      "merchant_funded_promotion": cents(txn.restaurant_funded_promo),
      "merchant_funded_loyalty": cents(txn.restaurant_funded_reward),
      "merchant_net_total": cents(txn.net_amount),
      // Enriched data from API
      "order_uuid": txn.order_uuid || "",
      "group_order_uuid": txn.group_order_uuid || "",
      "channel_brand": txn.channel_brand || "",
      "order_source": txn.source || "",
      "prepaid_amount": cents(txn.prepaid_amount),
      "placed_at_time": placedTimeStr,
      "items_json": items.length > 0 ? JSON.stringify(items) : "",
      "special_instructions": detail?.dining_supplies === "EXCLUDE" ? "No utensils/plates" : "",
      "order_status": detail?.order_status || "completed",
      "source": "extension",
    };
  }

  // ---- Scrape from page (fallback when API fails) ----

  function scrapeTransactionsFromPage() {
    const grids = document.querySelectorAll('[role="grid"]');
    const transactions = [];
    for (const grid of grids) {
      const headers = [...grid.querySelectorAll('[role="columnheader"]')].map(h => h.textContent.trim());
      if (!headers.includes("ID") || !headers.includes("Subtotal")) continue;
      const rows = grid.querySelectorAll('[role="row"]');
      for (let i = 1; i < rows.length; i++) {
        const cells = [...rows[i].querySelectorAll('[role="gridcell"]')].map(c => c.textContent.trim());
        if (cells.length < headers.length) continue;
        const txn = {};
        headers.forEach((h, idx) => { txn[h] = cells[idx]; });
        // Build a fake API-like object for the normalizer
        const parseDollar = (v) => Math.round(parseFloat(String(v || "0").replace(/[$,]/g, "")) * 100) || 0;
        // Parse date from table (format: "3/31/26")
        const dateStr = txn["Date"] || "";
        const dateParts = dateStr.split("/");
        let isoDate = new Date().toISOString();
        if (dateParts.length === 3) {
          const year = dateParts[2].length === 2 ? "20" + dateParts[2] : dateParts[2];
          isoDate = `${year}-${dateParts[0].padStart(2, "0")}-${dateParts[1].padStart(2, "0")}T12:00:00Z`;
        }
        // Parse time (format: "1:16 PM")
        const timeStr = txn["Time"] || "";
        const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (timeMatch) {
          let h = parseInt(timeMatch[1]);
          if (timeMatch[3].toUpperCase() === "PM" && h !== 12) h += 12;
          if (timeMatch[3].toUpperCase() === "AM" && h === 12) h = 0;
          isoDate = isoDate.replace("T12:00:00Z", `T${String(h).padStart(2, "0")}:${timeMatch[2]}:00Z`);
        }
        transactions.push({
          transaction_id: (txn["ID"] || "").replace(/^O-/, ""),
          order_number: (txn["ID"] || "").replace(/^O-/, ""),
          channel: txn["Order Channel"] || "",
          delivery_type: txn["Fulfillment Type"] || "",
          transaction_type_description: txn["Type"] || "",
          transaction_time: isoDate,
          subtotal: parseDollar(txn["Subtotal"]),
          restaurant_sales_tax: parseDollar(txn["Tax"]),
          restaurant_tip: parseDollar(txn["Tip"]),
          restaurant_total: parseDollar(txn["Restaurant Total"]),
          advertising_fee: parseDollar(txn["Commission"]),
          grubhub_delivery_fee: parseDollar(txn["Delivery Commission"]),
          processing_fee: parseDollar(txn["Processing Fee"]),
          withheld_sales_tax: parseDollar(txn["Withheld Tax"]),
          restaurant_funded_promo: parseDollar(txn["Targeted Promotion"]),
          restaurant_funded_reward: parseDollar(txn["Rewards"]),
          net_amount: parseDollar(txn["Net Total"]),
        });
      }
    }
    return transactions;
  }

  // ---- Main sync ----

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
      const storeId = extractStoreId();
      if (!storeId) throw new Error("Store ID not found in URL.");

      if (!bearerToken) {
        postCrawlStatus({ state: "scanning", message: "Waiting for auth token... navigate to any page first." });
        // Wait up to 10s for token to be captured from page activity
        for (let i = 0; i < 20 && !bearerToken; i++) await new Promise(r => setTimeout(r, 500));
        if (!bearerToken) throw new Error("No auth token. Load the Transactions page first so the token is captured.");
      }

      postCrawlStatus({ state: "scanning", message: "Fetching GrubHub transactions..." });

      // Determine date range
      let rangeStart, rangeEnd;
      if (command === "date-range-sync" && event.data.startDate) {
        rangeStart = new Date(event.data.startDate + "T00:00:00");
        rangeEnd = event.data.endDate ? new Date(event.data.endDate + "T23:59:59") : new Date();
      } else if (command === "smart-sync") {
        rangeStart = new Date(Date.now() - 30 * 86400000);
        rangeEnd = new Date();
      } else {
        // full-sync: walk back until 3 empty weeks (no fixed start)
        rangeStart = null;
        rangeEnd = new Date();
      }

      const isFullSync = command === "full-sync";

      // Paginate in weekly windows
      let allTransactions = [];
      let windowEnd = rangeEnd.getTime();
      const windowStart = rangeStart ? rangeStart.getTime() : 0;
      let emptyWeeks = 0;

      while (isFullSync ? (emptyWeeks < 3) : (windowEnd > windowStart)) {
        if (crawlAbort) break;
        const wStart = isFullSync ? windowEnd - WEEK_MS : Math.max(windowEnd - WEEK_MS, windowStart);

        postCrawlStatus({ state: "scanning", message: `Scanning week of ${new Date(wStart).toLocaleDateString()}...` });

        try {
          const response = await fetchTransactions(storeId, formatDate(new Date(wStart)), formatDate(new Date(windowEnd)));
          const txns = Array.isArray(response) ? response : Object.values(response);
          allTransactions = allTransactions.concat(txns);
          console.log(`[Profit Duck] Week ${new Date(wStart).toLocaleDateString()}: ${txns.length} transactions`);

          if (isFullSync) {
            emptyWeeks = txns.length === 0 ? emptyWeeks + 1 : 0;
          }
        } catch (err) {
          console.warn(`[Profit Duck] Failed to fetch week:`, err.message);
          if (allTransactions.length === 0) {
            console.log("[Profit Duck] Trying page scrape fallback...");
            allTransactions = scrapeTransactionsFromPage();
            if (allTransactions.length > 0) console.log(`[Profit Duck] Scraped ${allTransactions.length} from page`);
            break;
          }
        }

        windowEnd = wStart;
        await new Promise(r => setTimeout(r, 500));
      }

      console.log(`[Profit Duck] Scan complete: ${allTransactions.length} total transactions`);

      if (allTransactions.length === 0) {
        postCrawlStatus({ state: "done", message: "No transactions found." });
        return;
      }

      // Load known IDs for dedup
      let knownIds = new Set();
      if (command === "smart-sync") {
        try {
          knownIds = await new Promise((resolve) => {
            window.postMessage({ type: "PROFITDUCK_GET_KNOWN_IDS", platform: "grubhub" }, "*");
            const handler = (ev) => {
              if (ev.data?.type === "PROFITDUCK_KNOWN_IDS_RESULT") {
                window.removeEventListener("message", handler);
                resolve(new Set(ev.data.orderIds || []));
              }
            };
            window.addEventListener("message", handler);
            setTimeout(() => { window.removeEventListener("message", handler); resolve(new Set()); }, 5000);
          });
          console.log(`[Profit Duck] ${knownIds.size} GrubHub transactions already in database`);
        } catch (e) {
          console.warn("[Profit Duck] Could not load known IDs:", e.message);
        }
      }

      // Filter out known transactions
      const newTransactions = [];
      let skippedCount = 0;
      for (const txn of allTransactions) {
        const id = txn.transaction_id || "";
        if (!id) continue;
        if (knownIds.size > 0 && knownIds.has(id)) { skippedCount++; continue; }
        newTransactions.push(txn);
      }

      console.log(`[Profit Duck] After filter: ${newTransactions.length} new, ${skippedCount} skipped`);

      if (newTransactions.length === 0) {
        postCrawlStatus({ state: "done", message: `All ${allTransactions.length} transactions already synced.` });
        return;
      }

      // Fetch order details for each new transaction (items, modifiers, instructions)
      const csvRows = [];
      for (let i = 0; i < newTransactions.length; i++) {
        if (crawlAbort) break;
        const txn = newTransactions[i];

        postCrawlStatus({
          state: "fetching",
          message: `Fetching details ${i + 1}/${newTransactions.length}...`,
          total: newTransactions.length,
          current: i + 1,
        });

        let detail = null;
        try {
          detail = await fetchOrderDetail(storeId, txn.transaction_id);
        } catch (err) {
          // Detail fetch failed — still include the transaction with financial data only
          console.warn(`[Profit Duck] Detail fetch failed for ${txn.order_number}:`, err.message);
        }

        const row = normalizeTransaction(txn, detail);
        if (row) csvRows.push(row);

        // Rate limit
        await new Promise(r => setTimeout(r, 300));
      }

      console.log(`[Profit Duck] Normalized ${csvRows.length} transactions with details`);

      // Send to server via bridge
      if (csvRows.length > 0) {
        postCrawlStatus({ state: "syncing", message: `Syncing ${csvRows.length} transactions to server...` });
        window.postMessage({ type: "PROFITDUCK_SEND_ORDERS", platform: "grubhub", csvRows }, "*");
        await new Promise(r => setTimeout(r, 5000));
      }

      postCrawlStatus({
        state: "done",
        message: `Done! ${csvRows.length} new, ${skippedCount} already synced.`,
      });
    } catch (err) {
      postCrawlStatus({ state: "error", message: err.message || "GrubHub sync failed" });
    } finally {
      crawlActive = false;
      crawlAbort = false;
    }
  });

  console.log("[Profit Duck] GrubHub content script loaded");
})();
