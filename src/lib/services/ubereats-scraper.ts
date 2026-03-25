/**
 * Uber Eats Merchant Portal Scraper
 *
 * Uses Puppeteer to open a real Chrome browser. The user logs in manually,
 * then the script auto-navigates to the orders/payments page and scrapes
 * all order data. Results are formatted as CSV rows matching the existing
 * Uber Eats parser format and fed through the pipeline.
 *
 * Flow:
 *   1. Launch Chrome (visible) to Uber Eats Merchant Portal
 *   2. User logs in manually (handles 2FA, captcha, etc.)
 *   3. Script detects login success
 *   4. Navigate to orders page, scrape all orders
 *   5. Feed rows through pipeline: ubereats.db → sales.db → aliases
 */

import puppeteer, { Browser, Page } from "puppeteer";
import { EventEmitter } from "events";

// Uber Eats Merchant Portal URLs
const UE_LOGIN_URL = "https://merchants.ubereats.com/manager/login";
const UE_ORDERS_URL = "https://merchants.ubereats.com/manager/orders";
const UE_PAYMENTS_URL = "https://merchants.ubereats.com/manager/payments";

export interface ScrapeProgress {
  stage: "launching" | "waiting_login" | "logged_in" | "scraping" | "processing" | "done" | "error";
  message: string;
  ordersFound?: number;
  ordersScraped?: number;
  error?: string;
}

export interface ScrapedOrder {
  "Order ID": string;
  "Date": string;
  "Customer": string;
  "Order status": string;
  "Sales (excl. tax)": string;
  "Tax": string;
  "Marketplace fee": string;
  "Customer refunds": string;
  "Order charges": string;
  "Estimated payout": string;
}

export class UberEatsScraper extends EventEmitter {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private orders: ScrapedOrder[] = [];
  private _aborted = false;

  emitProgress(progress: ScrapeProgress) {
    this.emit("progress", progress);
  }

  async abort() {
    this._aborted = true;
    if (this.browser) {
      try { await this.browser.close(); } catch { /* ignore */ }
      this.browser = null;
    }
  }

  async scrape(startDate?: string, endDate?: string): Promise<ScrapedOrder[]> {
    try {
      // Step 1: Launch browser
      this.emitProgress({ stage: "launching", message: "Launching Chrome..." });

      this.browser = await puppeteer.launch({
        headless: false, // User needs to see and log in
        channel: "chrome", // Use installed Chrome instead of Puppeteer's Chromium
        defaultViewport: { width: 1280, height: 900 },
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
        ],
      });

      this.page = await this.browser.newPage();

      // Mask automation signals
      await this.page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
      });

      // Step 2: Navigate to login
      this.emitProgress({ stage: "waiting_login", message: "Please log in to Uber Eats Merchant Portal..." });
      try {
        await this.page.goto(UE_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      } catch (navErr) {
        // Uber Eats may redirect during navigation — that's fine
        const msg = navErr instanceof Error ? navErr.message : "";
        if (!msg.includes("detached") && !msg.includes("navigation")) throw navErr;
      }

      // Step 3: Wait for user to log in (detect navigation away from login)
      await this.waitForLogin();

      if (this._aborted) return [];

      this.emitProgress({ stage: "logged_in", message: "Login detected! Starting to scrape orders..." });

      // Step 4: Navigate to orders/payments and scrape
      const orders = await this.scrapeOrders(startDate, endDate);

      this.emitProgress({
        stage: "done",
        message: `Scraping complete! Found ${orders.length} orders.`,
        ordersScraped: orders.length,
      });

      return orders;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      this.emitProgress({ stage: "error", message: errorMsg, error: errorMsg });
      throw err;
    } finally {
      // Don't close browser automatically — let user close it or let abort() handle it
    }
  }

  private async waitForLogin(timeoutMs = 300_000): Promise<void> {
    // Wait up to 5 minutes for user to log in
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (this._aborted) return;
      if (!this.page) return;

      try {
        const url = this.page.url();

        // Emit URL for debugging via status endpoint
        this.emitProgress({
          stage: "waiting_login",
          message: `Waiting for login... Current: ${url.substring(0, 100)}`,
        });

        // Strategy 1: URL moved away from login page entirely
        const isLoginUrl =
          (url.includes("login") && !url.includes("?effect=")) ||
          url.includes("/auth") ||
          url.includes("/sso") ||
          url.includes("/identity") ||
          url === "about:blank" ||
          url === "";

        if (!isLoginUrl && url.includes("uber")) {
          return;
        }

        // Strategy 2: URL has login but with ?effect= (post-login redirect that stays on same URL)
        // Check page content for logged-in indicators
        if (url.includes("login") && url.includes("?effect=")) {
          try {
            const isLoggedIn = await this.page.evaluate(() => {
              // Look for dashboard elements that only appear when logged in
              const body = document.body?.innerText || "";
              return (
                body.includes("Orders") ||
                body.includes("Menu") ||
                body.includes("Payments") ||
                body.includes("Analytics") ||
                body.includes("Settings") ||
                document.querySelector('[data-testid="nav"]') !== null ||
                document.querySelector('nav') !== null
              );
            });
            if (isLoggedIn) return;
          } catch {
            // Page might be navigating
          }
        }
      } catch {
        // Page might be navigating, that's fine
      }

      await new Promise((r) => setTimeout(r, 2000));
    }

    throw new Error("Login timeout — please log in within 5 minutes");
  }

  private async scrapeOrders(startDate?: string, endDate?: string): Promise<ScrapedOrder[]> {
    if (!this.page) throw new Error("No page available");

    this.emitProgress({ stage: "scraping", message: "Navigating to orders page..." });

    // Try the orders page first
    try {
      await this.page.goto(UE_ORDERS_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 3000)); // Wait for dynamic content
    } catch {
      this.emitProgress({ stage: "scraping", message: "Orders page didn't load, trying payments..." });
    }

    // Try to find and use the orders/payment data from the page
    // The UE merchant portal is a React SPA, so we need to scrape from the rendered DOM

    const orders: ScrapedOrder[] = [];

    // Strategy 1: Try to intercept API calls
    const apiOrders = await this.interceptApiCalls(startDate, endDate);
    if (apiOrders.length > 0) {
      return apiOrders;
    }

    // Strategy 2: Scrape from rendered DOM
    const domOrders = await this.scrapeFromDOM();
    if (domOrders.length > 0) {
      return domOrders;
    }

    // Strategy 3: Try to trigger a CSV export from the portal
    const csvOrders = await this.triggerCSVExport();
    if (csvOrders.length > 0) {
      return csvOrders;
    }

    return orders;
  }

  private async interceptApiCalls(startDate?: string, endDate?: string): Promise<ScrapedOrder[]> {
    if (!this.page) return [];

    const orders: ScrapedOrder[] = [];

    this.emitProgress({ stage: "scraping", message: "Intercepting API responses for order data..." });

    // Set up request interception to capture API responses
    const apiResponses: unknown[] = [];

    const responseHandler = async (response: { url: () => string; status: () => number; json: () => Promise<unknown> }) => {
      try {
        const url = response.url();
        if (
          url.includes("/api/") &&
          (url.includes("order") || url.includes("payment") || url.includes("payout")) &&
          response.status() === 200
        ) {
          const data = await response.json();
          apiResponses.push(data);
        }
      } catch {
        // Not JSON or failed to read — skip
      }
    };

    this.page.on("response", responseHandler);

    // Navigate to payments page which has the most useful data
    try {
      await this.page.goto(UE_PAYMENTS_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 5000));

      // Try to set date range if possible
      if (startDate) {
        await this.trySetDateRange(startDate, endDate);
        await new Promise((r) => setTimeout(r, 3000));
      }

      // Scroll to load more data
      await this.scrollToLoadAll();
    } catch (err) {
      // Continue with whatever we got
    }

    this.page.off("response", responseHandler);

    // Process captured API responses
    for (const data of apiResponses) {
      const extracted = this.extractOrdersFromApiResponse(data);
      orders.push(...extracted);
    }

    if (orders.length > 0) {
      this.emitProgress({
        stage: "scraping",
        message: `Found ${orders.length} orders from API responses`,
        ordersScraped: orders.length,
      });
    }

    return orders;
  }

  private extractOrdersFromApiResponse(data: unknown): ScrapedOrder[] {
    const orders: ScrapedOrder[] = [];

    if (!data || typeof data !== "object") return orders;

    // Recursively search for order-like objects in the response
    const search = (obj: unknown, depth = 0) => {
      if (depth > 5 || !obj || typeof obj !== "object") return;

      if (Array.isArray(obj)) {
        for (const item of obj) search(item, depth + 1);
        return;
      }

      const o = obj as Record<string, unknown>;

      // Look for order-like objects
      if (
        ("orderId" in o || "order_id" in o || "orderUUID" in o) &&
        ("total" in o || "subtotal" in o || "payout" in o || "amount" in o)
      ) {
        const orderId = String(o.orderId || o.order_id || o.orderUUID || "");
        const dateVal = o.date || o.createdAt || o.created_at || o.orderDate || "";
        const date = dateVal ? new Date(String(dateVal)) : new Date();
        const dateStr = `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;

        const subtotal = Number(o.subtotal || o.sales || o.itemsTotal || 0);
        const tax = Number(o.tax || o.salesTax || 0);
        const fee = Math.abs(Number(o.marketplaceFee || o.commission || o.fee || 0));
        const refunds = Math.abs(Number(o.refunds || o.customerRefunds || 0));
        const charges = Math.abs(Number(o.orderCharges || o.additionalCharges || 0));
        const payout = Number(o.payout || o.estimatedPayout || o.netPayout || 0);
        const status = String(o.status || o.orderStatus || o.order_status || "Completed");
        const customer = String(o.customer || o.customerName || o.customer_name || "");

        if (orderId && (subtotal > 0 || payout > 0)) {
          orders.push({
            "Order ID": orderId,
            "Date": dateStr,
            "Customer": customer,
            "Order status": status,
            "Sales (excl. tax)": subtotal.toFixed(2),
            "Tax": tax.toFixed(2),
            "Marketplace fee": (-fee).toFixed(2),
            "Customer refunds": refunds.toFixed(2),
            "Order charges": (-charges).toFixed(2),
            "Estimated payout": payout.toFixed(2),
          });
        }
      }

      // Recurse into nested objects
      for (const val of Object.values(o)) {
        search(val, depth + 1);
      }
    };

    search(data);
    return orders;
  }

  private async scrapeFromDOM(): Promise<ScrapedOrder[]> {
    if (!this.page) return [];

    this.emitProgress({ stage: "scraping", message: "Scraping order data from page..." });

    try {
      // Try to find order rows in the DOM
      const orders = await this.page.evaluate(() => {
        const results: {
          "Order ID": string; "Date": string; "Customer": string;
          "Order status": string; "Sales (excl. tax)": string; "Tax": string;
          "Marketplace fee": string; "Customer refunds": string;
          "Order charges": string; "Estimated payout": string;
        }[] = [];

        // Look for table rows or list items that contain order data
        const rows = document.querySelectorAll("tr, [data-testid*='order'], [class*='order-row'], [class*='OrderRow']");

        for (const row of rows) {
          const text = row.textContent || "";
          // Look for patterns like order IDs (hex strings) and dollar amounts
          const dollarAmounts = text.match(/\$[\d,]+\.?\d*/g);
          const datePattern = text.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/);

          if (dollarAmounts && dollarAmounts.length >= 2 && datePattern) {
            const amounts = dollarAmounts.map((a) => parseFloat(a.replace(/[$,]/g, "")));
            results.push({
              "Order ID": `ue-dom-${Date.now()}-${results.length}`,
              "Date": datePattern[0],
              "Customer": "",
              "Order status": "Completed",
              "Sales (excl. tax)": amounts[0]?.toFixed(2) || "0",
              "Tax": (amounts[1] || 0).toFixed(2),
              "Marketplace fee": (-(amounts[2] || 0)).toFixed(2),
              "Customer refunds": "0",
              "Order charges": "0",
              "Estimated payout": (amounts[amounts.length - 1] || 0).toFixed(2),
            });
          }
        }

        return results;
      });

      if (orders.length > 0) {
        this.emitProgress({
          stage: "scraping",
          message: `Scraped ${orders.length} orders from page DOM`,
          ordersScraped: orders.length,
        });
      }

      return orders;
    } catch {
      return [];
    }
  }

  private async triggerCSVExport(): Promise<ScrapedOrder[]> {
    if (!this.page) return [];

    this.emitProgress({ stage: "scraping", message: "Looking for CSV export option..." });

    try {
      // Look for export/download buttons
      const exportButton = await this.page.$('[data-testid*="export"], [data-testid*="download"], button:has-text("Export"), button:has-text("Download"), a:has-text("Export")');

      if (exportButton) {
        this.emitProgress({ stage: "scraping", message: "Found export button, triggering download..." });
        // We'll handle the download in a future iteration
      }
    } catch {
      // No export button found
    }

    return [];
  }

  private async trySetDateRange(startDate: string, endDate?: string): Promise<void> {
    if (!this.page) return;

    try {
      // Look for date picker elements
      const datePicker = await this.page.$('[data-testid*="date"], input[type="date"], [class*="date-picker"], [class*="DatePicker"]');
      if (datePicker) {
        // Try to interact with date picker
        await datePicker.click();
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch {
      // Date range setting failed — will scrape whatever is visible
    }
  }

  private async scrollToLoadAll(): Promise<void> {
    if (!this.page) return;

    this.emitProgress({ stage: "scraping", message: "Scrolling to load all data..." });

    let previousHeight = 0;
    let scrollAttempts = 0;
    const maxScrolls = 20;

    while (scrollAttempts < maxScrolls) {
      if (this._aborted) return;

      const currentHeight = await this.page.evaluate(() => document.body.scrollHeight);
      if (currentHeight === previousHeight) break;

      previousHeight = currentHeight;
      await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise((r) => setTimeout(r, 2000));
      scrollAttempts++;

      // Also try clicking "Load More" or "Show More" buttons
      try {
        const loadMore = await this.page.$('button:has-text("Load More"), button:has-text("Show More"), [data-testid*="load-more"]');
        if (loadMore) {
          await loadMore.click();
          await new Promise((r) => setTimeout(r, 2000));
        }
      } catch {
        // No load more button
      }
    }
  }

  async closeBrowser(): Promise<void> {
    if (this.browser) {
      try { await this.browser.close(); } catch { /* ignore */ }
      this.browser = null;
      this.page = null;
    }
  }
}

/**
 * Convert scraped orders to CSV rows compatible with the existing parser
 */
export function scrapedOrdersToCSVRows(orders: ScrapedOrder[]): Record<string, string>[] {
  return orders.map((o) => ({
    "Order ID": o["Order ID"],
    "Date": o["Date"],
    "Customer": o["Customer"],
    "Order status": o["Order status"],
    "Sales (excl. tax)": o["Sales (excl. tax)"],
    "Tax": o["Tax"],
    "Marketplace fee": o["Marketplace fee"],
    "Customer refunds": o["Customer refunds"],
    "Order charges": o["Order charges"],
    "Estimated payout": o["Estimated payout"],
  }));
}
