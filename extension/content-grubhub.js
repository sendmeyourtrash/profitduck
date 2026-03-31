/**
 * MAIN world content script — Profit Duck GrubHub data capture.
 *
 * Fetches transaction data from GrubHub merchant accounting API,
 * normalizes to csvRow format matching grubhub.db schema,
 * and sends to server via bridge → background.
 *
 * Data flow: transactions API → normalize → postMessage → bridge → background → server
 */
(function () {
  "use strict";

  const CRAWL_STATUS_TAG = "PROFITDUCK_CRAWL_STATUS";
  const API_BASE = "https://api-order-processing-gtm.grubhub.com";
  const WEEK_MS = 7 * 86400000;

  let crawlActive = false;
  let crawlAbort = false;

  function postCrawlStatus(status) {
    window.postMessage({ type: CRAWL_STATUS_TAG, ...status }, "*");
  }

  // ---- Extract store ID from page URL ----

  function extractStoreId() {
    // URL patterns: /dashboard/6729328, /financials/transactions/6729328, etc.
    const match = window.location.pathname.match(/\/(\d{5,})/);
    if (match) return match[1];
    // Fallback: check for store ID in page links
    const links = document.querySelectorAll("a[href*='/dashboard/'], a[href*='/financials/']");
    for (const link of links) {
      const m = link.href.match(/\/(\d{5,})/);
      if (m) return m[1];
    }
    // Fallback: check for store ID in script tags or page content
    try {
      const scripts = document.querySelectorAll("script");
      for (const s of scripts) {
        const m = s.textContent.match(/restaurantId["\s:=]+["']?(\d{5,})/);
        if (m) return m[1];
      }
    } catch {}
    return null;
  }

  // ---- Fetch transactions via XHR (avoids service worker issues) ----

  function fetchTransactions(storeId, startDate, endDate) {
    return new Promise((resolve, reject) => {
      const url = `${API_BASE}/merchant/accounting/v1/${storeId}/transactions?timeZone=America/Chicago&channelGroup=&startDate=${startDate}&endDate=${endDate}`;
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.withCredentials = true;
      xhr.timeout = 30000;
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch { resolve([]); }
        } else {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.ontimeout = () => reject(new Error("Timeout"));
      xhr.send();
    });
  }

  // ---- Normalize API transaction to csvRow matching grubhub.db schema ----

  function parseDollar(val) {
    if (!val || val === "—" || val === "-") return "0.00";
    const cleaned = String(val).replace(/[$,\s]/g, "");
    const num = parseFloat(cleaned);
    return isNaN(num) ? "0.00" : num.toFixed(2);
  }

  function normalizeDate(dateStr) {
    // "3/31/26" → "2026-03-31"
    if (!dateStr) return "";
    const parts = dateStr.split("/");
    if (parts.length === 3) {
      const month = parts[0].padStart(2, "0");
      const day = parts[1].padStart(2, "0");
      let year = parts[2];
      if (year.length === 2) year = "20" + year;
      return `${year}-${month}-${day}`;
    }
    return dateStr;
  }

  function normalizeTime(timeStr) {
    // "1:16 PM" → "13:16:00"
    if (!timeStr) return "";
    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (match) {
      let hours = parseInt(match[1]);
      const minutes = match[2];
      const period = match[3].toUpperCase();
      if (period === "PM" && hours !== 12) hours += 12;
      if (period === "AM" && hours === 12) hours = 0;
      return `${String(hours).padStart(2, "0")}:${minutes}:00`;
    }
    return timeStr;
  }

  function normalizeTransactionToCsvRow(txn) {
    // txn can be from API JSON or from page scraping
    // API may use camelCase or snake_case — try both
    const orderId = (txn.transaction_id || txn.transactionId || txn.id || txn.ID || "").replace(/^O-/, "");
    if (!orderId) {
      console.warn("[Profit Duck] Skipping transaction with no ID. Keys:", Object.keys(txn).slice(0, 10).join(", "));
      return null;
    }

    const row = {
      "order_channel": txn.order_channel || txn.orderChannel || "",
      "order_number": orderId,
      "order_date": normalizeDate(txn.order_date || txn.date || ""),
      "order_time_local": normalizeTime(txn.order_time_local || txn.time || ""),
      "transaction_date": normalizeDate(txn.transaction_date || txn.date || ""),
      "transaction_time_local": normalizeTime(txn.transaction_time_local || txn.time || ""),
      "transaction_type": txn.transaction_type || txn.type || "",
      "transaction_id": orderId,
      "grubhub_store_id": extractStoreId() || "",
      "store_name": txn.store_name || "",
      "fulfillment_type": txn.fulfillment_type || txn.fulfillmentType || "",
      "subtotal": parseDollar(txn.subtotal),
      "subtotal_sales_tax": parseDollar(txn.subtotal_sales_tax || txn.tax),
      "self_delivery_charge": parseDollar(txn.self_delivery_charge || txn.deliveryFee),
      "merchant_service_fee": parseDollar(txn.merchant_service_fee || txn.serviceFee),
      "tip": parseDollar(txn.tip),
      "merchant_total": parseDollar(txn.merchant_total || txn.restaurantTotal),
      "commission": parseDollar(txn.commission),
      "delivery_commission": parseDollar(txn.delivery_commission || txn.deliveryCommission),
      "processing_fee": parseDollar(txn.processing_fee || txn.processingFee),
      "withheld_tax": parseDollar(txn.withheld_tax || txn.withheldTax),
      "merchant_funded_promotion": parseDollar(txn.merchant_funded_promotion || txn.targetedPromotion),
      "merchant_funded_loyalty": parseDollar(txn.merchant_funded_loyalty || txn.rewards),
      "merchant_net_total": parseDollar(txn.merchant_net_total || txn.netTotal),
      "gh_plus_customer": txn.gh_plus_customer || "",
      "source": "extension",
    };

    // Warn if all financial fields are zero — likely a field name mapping mismatch
    if (row.subtotal === "0.00" && row.merchant_net_total === "0.00" && row.merchant_total === "0.00") {
      console.warn(`[Profit Duck] Transaction ${orderId} has all-zero financials. Raw keys:`, Object.keys(txn).join(", "));
    }

    return row;
  }

  // ---- Scrape transactions from the rendered page grid ----

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

        transactions.push({
          order_channel: txn["Order Channel"] || "",
          transaction_id: (txn["ID"] || "").replace(/^O-/, ""),
          fulfillment_type: txn["Fulfillment Type"] || "",
          transaction_type: txn["Type"] || "",
          date: txn["Date"] || "",
          time: txn["Time"] || "",
          subtotal: txn["Subtotal"],
          deliveryFee: txn["Delivery Fee"],
          serviceFee: txn["Service Fee"],
          tax: txn["Tax"],
          tip: txn["Tip"],
          restaurantTotal: txn["Restaurant Total"],
          commission: txn["Commission"],
          deliveryCommission: txn["Delivery Commission"],
          processingFee: txn["Processing Fee"],
          withheldTax: txn["Withheld Tax"],
          targetedPromotion: txn["Targeted Promotion"],
          rewards: txn["Rewards"],
          netTotal: txn["Net Total"],
        });
      }
    }
    return transactions;
  }

  // ---- Format date for API params ----

  function formatDate(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
      if (!storeId) {
        throw new Error("Store ID not found. Navigate to a GrubHub page with a store ID in the URL.");
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
        // full-sync: no fixed start, walk back until empty
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
        const wStart = isFullSync
          ? windowEnd - WEEK_MS
          : Math.max(windowEnd - WEEK_MS, windowStart);

        postCrawlStatus({
          state: "scanning",
          message: `Scanning week of ${new Date(wStart).toLocaleDateString()}...`,
        });

        try {
          const startStr = formatDate(new Date(wStart));
          const endStr = formatDate(new Date(windowEnd));
          const response = await fetchTransactions(storeId, startStr, endStr);

          // Log first response for field name debugging
          if (allTransactions.length === 0) {
            console.log("[Profit Duck] GrubHub API response keys:", Object.keys(response).join(", "));
            const sample = Array.isArray(response) ? response[0] : response.transactions?.[0];
            if (sample) console.log("[Profit Duck] Sample transaction keys:", Object.keys(sample).join(", "));
          }

          // Response could be JSON array or object with transactions key
          let txns = [];
          if (Array.isArray(response)) {
            txns = response;
          } else if (response.transactions && Array.isArray(response.transactions)) {
            txns = response.transactions;
          } else if (response.length === 0 || Object.keys(response).length === 0) {
            txns = [];
          }

          allTransactions = allTransactions.concat(txns);
          console.log(`[Profit Duck] Week ${new Date(wStart).toLocaleDateString()}: ${txns.length} transactions`);

          if (isFullSync) {
            emptyWeeks = txns.length === 0 ? emptyWeeks + 1 : 0;
          }
        } catch (err) {
          console.warn(`[Profit Duck] Failed to fetch week:`, err.message);
          // If API fails (401, etc.), try scraping from page as fallback
          if (allTransactions.length === 0) {
            console.log("[Profit Duck] Trying page scrape fallback...");
            allTransactions = scrapeTransactionsFromPage();
            if (allTransactions.length > 0) {
              console.log(`[Profit Duck] Scraped ${allTransactions.length} transactions from page`);
            }
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

      // Normalize and filter
      const csvRows = [];
      let skippedCount = 0;
      for (const txn of allTransactions) {
        const row = normalizeTransactionToCsvRow(txn);
        if (!row) continue;
        if (knownIds.size > 0 && knownIds.has(row.transaction_id)) {
          skippedCount++;
          continue;
        }
        csvRows.push(row);
      }

      console.log(`[Profit Duck] After filter: ${csvRows.length} new, ${skippedCount} skipped`);

      if (csvRows.length === 0) {
        postCrawlStatus({ state: "done", message: `All ${allTransactions.length} transactions already synced.` });
        return;
      }

      // Send to server via bridge
      postCrawlStatus({ state: "syncing", message: `Syncing ${csvRows.length} transactions to server...` });
      window.postMessage({
        type: "PROFITDUCK_SEND_ORDERS",
        platform: "grubhub",
        csvRows: csvRows,
      }, "*");

      await new Promise(r => setTimeout(r, 5000));

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
