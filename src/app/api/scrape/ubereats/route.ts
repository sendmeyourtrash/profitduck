/**
 * POST /api/scrape/ubereats — Launch Uber Eats scraper
 *
 * Spawns a Puppeteer browser for the user to log in, then scrapes
 * order data and feeds it through the existing pipeline.
 *
 * Body: { startDate?: string, endDate?: string }
 *
 * Returns SSE stream with progress updates.
 *
 * DELETE /api/scrape/ubereats — Abort active scraper
 */

import { NextRequest, NextResponse } from "next/server";
import { UberEatsScraper, scrapedOrdersToCSVRows, ScrapeProgress } from "@/lib/services/ubereats-scraper";
import { ingestUberEatsOrders } from "@/lib/services/pipeline-step1-ingest";
import { unifyUberEats } from "@/lib/services/pipeline-step2-unify";
import { step3ApplyAliases } from "@/lib/services/pipeline-step3-aliases";

// Global scraper instance (only one can run at a time)
let activeScraper: UberEatsScraper | null = null;
let scrapeStatus: ScrapeProgress = { stage: "done", message: "Ready" };

export async function POST(request: NextRequest) {
  if (activeScraper) {
    return NextResponse.json(
      { error: "A scraper is already running. Stop it first." },
      { status: 409 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const { startDate, endDate } = body as { startDate?: string; endDate?: string };

  const scraper = new UberEatsScraper();
  activeScraper = scraper;

  // Track progress
  scraper.on("progress", (progress: ScrapeProgress) => {
    scrapeStatus = progress;
  });

  // Run scraper in background — don't await (SSE will track progress)
  const scrapePromise = (async () => {
    try {
      const orders = await scraper.scrape(startDate, endDate);

      if (orders.length === 0) {
        scrapeStatus = {
          stage: "done",
          message: "No orders found. Try adjusting the date range or check the portal manually.",
          ordersScraped: 0,
        };
        return;
      }

      // Feed through pipeline
      scrapeStatus = {
        stage: "processing",
        message: `Processing ${orders.length} orders through pipeline...`,
        ordersScraped: orders.length,
      };

      // Step 1: Write to ubereats.db
      const csvRows = scrapedOrdersToCSVRows(orders);
      const ingestResult = ingestUberEatsOrders(csvRows);

      // Step 2: Unify to sales.db
      unifyUberEats();

      // Step 3: Apply aliases
      step3ApplyAliases();

      scrapeStatus = {
        stage: "done",
        message: `Done! Imported ${ingestResult.inserted} new orders (${ingestResult.skipped} duplicates skipped).`,
        ordersScraped: orders.length,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      scrapeStatus = { stage: "error", message: msg, error: msg };
    } finally {
      await scraper.closeBrowser();
      activeScraper = null;
    }
  })();

  // Return immediately with acknowledgement
  return NextResponse.json({
    status: "started",
    message: "Scraper launched. A Chrome window should open — please log in to Uber Eats.",
  });
}

export async function GET() {
  // Return current scraper status
  return NextResponse.json({
    active: activeScraper !== null,
    ...scrapeStatus,
  });
}

export async function DELETE() {
  if (!activeScraper) {
    return NextResponse.json({ status: "no_scraper_running" });
  }

  await activeScraper.abort();
  activeScraper = null;
  scrapeStatus = { stage: "done", message: "Scraper aborted by user." };

  return NextResponse.json({ status: "aborted" });
}
