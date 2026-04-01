---
name: Page-scrape fallback uses current timestamp for all scraped transactions
description: GrubHub content script page scraper sets transaction_time to new Date().toISOString() for all rows — actual date is lost
type: feedback
---

In `content-grubhub.js` `scrapeTransactionsFromPage()`, all scraped transactions get `transaction_time: new Date().toISOString()` because the scraper doesn't extract the date column from the page table. This flows through `normalizeTransaction` into `order_date` and `transaction_date`, so every scraped row is stored with today's date.

**Why:** Dedup by transaction_id prevents duplicates if the API later succeeds, but any reporting on the scraped rows will show wrong dates until overwritten. Found 2026-03-31 reviewing content-grubhub.js.

**How to apply:** Any page-scrape fallback must extract and parse the date from the rendered table. Never fall back to `new Date()` for financial record timestamps.
