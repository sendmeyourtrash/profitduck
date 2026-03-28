<!-- Last updated: 2026-03-25 — Rewritten for multi-database architecture (no Prisma) -->

# Transaction System Architecture

This document covers the data model, deduplication strategy, reconciliation, and import/sync flows for Profit Duck's financial transaction system.

---

## Table of Contents

1. [Data Model Overview](#data-model-overview)
2. [Three-Level Reconciliation Architecture](#three-level-reconciliation-architecture)
3. [Data Sources & Platforms](#data-sources--platforms)
4. [Deduplication Strategy](#deduplication-strategy)
5. [Import & Sync Flows](#import--sync-flows)
6. [Key Design Decisions](#key-design-decisions)

---

## Data Model Overview

### Multi-Database Architecture

Profit Duck uses separate SQLite databases (better-sqlite3, no ORM) instead of a single database:

| Database | Key Tables | Purpose |
|----------|------------|---------|
| `sales.db` | `orders`, `order_items` | Unified sales from all platforms |
| `bank.db` | `rocketmoney`, `chase_statements` | Bank transactions |
| `categories.db` | settings, imports, aliases, rules, reconciliation | Configuration and tracking |
| `vendor-aliases.db` | `vendor_aliases`, `vendor_ignores` | Vendor name mappings |
| Vendor source DBs | Platform-specific tables | Raw imported data (Step 1 output) |

**Critical constraint**: You cannot JOIN across databases. Cross-DB queries require separate queries joined in application code.

### Core Tables

#### sales.db — `orders`
Individual platform orders (the atomic sales unit). Key fields:
- Identifiers: `date`, `time`, `platform`, `order_id`
- Financials: `gross_sales`, `tax`, `net_sales`, `tip`, `discounts`
- Fees: `commission_fee`, `processing_fee`, `delivery_fee`, `marketing_fee`, `fees_total`, `marketing_total`
- Summary: `refunds_total`, `adjustments_total`, `other_total`
- Detail: `items`, `modifiers`, `item_count`, `dining_option`, `customer_name`, `payment_method`
- Status: `order_status` (completed, cancelled, refund, adjustment, other)

#### sales.db — `order_items`
Item-level detail linked to orders. Key fields:
- `order_id`, `platform`, `date`, `time`
- `item_name`, `display_name` (after alias), `category`, `display_category` (after alias)
- `qty`, `unit_price`, `gross_sales`, `discounts`, `net_sales`
- `modifiers`, `event_type`, `dining_option`

Note: Only Square has real item-level detail. DoorDash/GrubHub/Uber Eats get one synthetic row per order.

#### bank.db — `rocketmoney`
Bank transactions from Rocket Money CSV exports:
- `date`, `name`, `custom_name`, `description`, `category`, `amount`, `account_name`, `note`

#### categories.db — Configuration tables
- `settings` — Key-value store (API tokens, sync timestamps)
- `imports` — Import history with file hashes for dedup
- `menu_item_aliases`, `menu_category_aliases` — Name mappings
- `menu_item_ignores` — Items excluded from analytics
- `categorization_rules` — Auto-assign vendors to expense categories
- `closed_days` — Days excluded from analytics
- `reconciliation_matches` — Sales-to-bank deposit pairings
- `reconciliation_alerts` — Discrepancy alerts

---

## Three-Level Reconciliation Architecture

Profit Duck reconciles money flow from sale to bank deposit:

```
L1: Orders (sales.db)
    Individual sales from each platform
        ↓ matched by amount (±$5) and date (±7 days)
L2: Payouts (vendor source DBs)
    Aggregated platform deposits (e.g., DoorDash weekly payout)
        ↓
L3: Bank Deposits (bank.db)
    Actual deposits in bank statements
```

### Reconciliation Matcher

Located in `src/lib/services/reconciliation/matcher.ts`. Directly matches grouped sales orders to bank deposits:

1. Groups `sales.db` orders by week + platform
2. Matches against `bank.db` deposits using:
   - Amount tolerance: ±$5
   - Date window: ±7 days
   - Platform detection from bank transaction names (e.g., "SQ *" → Square, "DOORDASH" → DoorDash)
3. Stores matches in `categories.db` → `reconciliation_matches`
4. Generates alerts for discrepancies in `categories.db` → `reconciliation_alerts`

### Alert Types

- **Payout mismatch** — Expected deposit amount doesn't match bank deposit
- **Missing deposit** — Platform payout with no corresponding bank deposit
- **Amount discrepancy** — Match found but variance exceeds threshold
- **Suspected duplicate** — Same transaction may have been imported twice

---

## Data Sources & Platforms

### Sales Platforms

| Platform | Source Key | Import Method | Data Provided |
|----------|-----------|---------------|---------------|
| Square | `square` | API sync (automatic) | Orders with items, fees, payment method, dining option |
| DoorDash | `doordash` | CSV upload | Orders with commission, service, delivery fees |
| Uber Eats | `uber-eats` | CSV upload | Orders with fees, adjustments |
| Grubhub | `grubhub` | CSV upload | Orders with fees, marketing costs |

### Bank Sources

| Source | Source Key | Import Method | Data Provided |
|--------|-----------|---------------|---------------|
| Rocket Money | `rocket-money` | CSV upload | Bank transactions with account, category |
| Chase CSV | `chase` | CSV upload | Bank statement transactions |
| Chase PDF | `chase` | PDF upload | Parsed bank statements |
| Plaid | N/A | Direct API sync | Bank transactions (incremental) |

### 7 Parsers

Located in `src/lib/parsers/`:

| Parser | File | Detection Method |
|--------|------|-----------------|
| Square | `square.ts` | "Transaction ID", "Net Sales" columns |
| DoorDash | `doordash.ts` | DoorDash-specific columns |
| Uber Eats | `ubereats.ts` | Uber Eats columns |
| Grubhub | `grubhub.ts` | Grubhub columns |
| Rocket Money | `rocketmoney.ts` | Rocket Money export format |
| Chase CSV | `chase.ts` | Chase CSV format |
| Chase PDF | `chase-pdf.ts` | PDF parsing via pdf-parse |

---

## Deduplication Strategy

Deduplication operates at multiple levels. Defined in `src/lib/services/dedup.ts`.

### Level 1: File-Level Dedup

```
SHA256(file contents) → check imports table in categories.db
```
Prevents re-importing the exact same file. Matched files are rejected unless force-imported.

### Level 2: Row-Level Dedup (Pipeline Step 1)

Each vendor source DB uses platform-specific unique keys:
- Square: `payment_id` / `transaction_id`
- DoorDash: `doordash_order_id`
- GrubHub: `transaction_id`
- Uber Eats: `order_id`
- Rocket Money: `date + name + amount`

Duplicate rows are skipped during Step 1 ingestion.

### Level 3: Unified DB Dedup (Pipeline Step 2)

```
order_id + platform → unique check in sales.db
```
Prevents duplicate orders in the unified database when Step 2 runs.

### Level 4: Overlapping Import Detection

Before processing, checks if any completed import from the same source has an overlapping date range. Warns the user but does not block (row-level dedup handles prevention).

---

## Import & Sync Flows

### CSV Upload Flow

```
1. User uploads CSV via Settings page
2. POST /api/upload receives file
3. ingestion.ts:
   a. File-level dedup (SHA256 hash check)
   b. Platform detection via parser registry (auto-detect from headers)
   c. Step 1: Parse + write to vendor source DB (e.g., grubhub.db)
   d. Step 2: Normalize + write to unified DB (sales.db or bank.db)
   e. Step 3: Apply menu/category aliases to order_items
   f. Record import in categories.db
4. Sales/Bank Activity pages show new data immediately
```

### Square API Sync Flow

```
1. User clicks "Sync" on Settings page (or scheduler triggers)
2. POST /api/square/sync → square-sync.ts:
   a. Fetch payments from Square API (cursor-paginated)
   b. For each payment, resolve real order_id
   c. Batch-retrieve order details (line items, modifiers, tax)
   d. Step 1: Dedup by payment_id → write to squareup.db
   e. Step 2: Aggregate items by transaction_id → write to sales.db
   f. Step 3: Apply aliases to order_items
3. Sales page shows new orders with full item detail
```

### Plaid Bank Sync Flow

```
1. POST /api/plaid/sync → plaid-sync.ts:
   a. Cursor-based incremental sync
   b. Handles added, modified, and removed transactions
   c. Writes to bank.db
   d. Maintains sync cursor in categories.db settings
```

### Pipeline Rebuild Flow

```
1. npx tsx scripts/rebuild-pipeline.ts
2. Clears sales.db orders + order_items, bank.db rocketmoney
3. Re-reads ALL vendor source DBs
4. Re-runs Step 2 (normalize) + Step 3 (aliases)
5. No data loss — vendor DBs and config DBs are untouched
```

---

## Key Design Decisions

### Why separate databases?

Each database has a different lifecycle:
- **Vendor source DBs** are append-only raw data (never modified after import)
- **Unified DBs** (sales.db, bank.db) are derived and can be rebuilt anytime
- **Config DBs** (categories.db, vendor-aliases.db) contain user configuration that must never be lost

Separating them means you can rebuild derived data without risking user config.

### Why no ORM?

better-sqlite3 provides synchronous, zero-overhead access to SQLite. For a single-user local app with multiple database files, an ORM adds complexity without benefit. Raw SQL with parameterized queries is simpler and more transparent.

### Why payouts appear on Bank Activity, not Sales?

Platform payouts (e.g., "Square deposits $3,200") are bank events — money arriving in the checking account. Showing them on Sales would double-count revenue since individual orders already represent income.

### Why the date picker is in the header?

All data pages share a global `DateRangeContext`. The header date picker controls this context, and individual pages consume it via `useDateRange()`. This ensures consistent date filtering across all views.

### Why only Square has item-level detail?

Square data comes from the API with full line-item detail. DoorDash, GrubHub, and Uber Eats CSV exports only provide order-level totals. For those platforms, `order_items` gets one synthetic row per order with the order total.
