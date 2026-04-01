<!-- Last updated: 2026-04-01 — Added ExpandedOrderRow/PlatformDetailTab components, DoorDash/GrubHub/UberEats vendor DB new columns, analytics ubereatsHasTime, platform API order_items, RevenueChart forecast suppression -->

# Architecture

## Database Layer

### Unified Databases (what the app reads from)

**sales.db** — All platform sales data normalized to a common schema.
- `orders` table: date, time, platform, order_id, gross_sales, tax, fees_total, net_sales, tip, discounts, dining_option, customer_name, payment_method, commission_fee, processing_fee, delivery_fee, marketing_fee, fees_total, marketing_total, refunds_total, adjustments_total, other_total, items, item_count, modifiers, order_status, display_categories
- `order_items` table: order_id, platform, date, time, item_name, category, qty, unit_price, gross_sales, discounts, net_sales, modifiers, display_name, display_category, event_type, dining_option
- Populated by Step 2 of the pipeline from vendor databases

Note: `modifiers` in `order_items` stores structured JSON for Square and Uber Eats extension data (`[{"group":"...","name":"...","price":0.00}]`). Flat string fallback for legacy Square CSV imports.

**bank.db** — Bank transactions from Rocket Money exports and Chase PDF imports.
- `rocketmoney` table: date, original_date, account_type, account_name, account_number, institution_name, name, custom_name, amount, description, category, note, ignored_from, tax_deductible, transaction_tags, source
- `chase_statements` table: reserved for Chase PDF imports

**categories.db** — All user configuration and settings.
- `settings` — Key-value store (API tokens, sync timestamps, business config)
- `menu_item_aliases` — Sales item name mappings (pattern, match_type, display_name)
- `menu_item_ignores` — Items excluded from analytics
- `menu_category_aliases` — Category name mappings (legacy fallback when menu_categories is empty)
- `menu_categories` — User-defined menu category groups (id, name, color, sort_order, square_catalog_id)
- `menu_item_category_map` — Maps display_name → category_id + optional square_item_id
- `menu_modifier_aliases` — Modifier name display mappings (pattern, match_type, display_name)
- `menu_modifier_ignores` — Modifiers excluded from analytics
- `expense_categories` — Expense category definitions
- `categorization_rules` — Auto-assign vendors to expense categories
- `category_ignores` — Categories excluded from reports
- `closed_days` — Days the restaurant was closed
- `imports` — Import history with file hashes for dedup
- `reconciliation_matches` — Sales-to-bank deposit pairings
- `reconciliation_alerts` — Reconciliation discrepancy alerts

**vendor-aliases.db** — Bank vendor name normalization.
- `vendor_aliases` — Pattern-based name mappings (e.g., "AMZN*" -> "Amazon")
- `vendor_ignores` — Vendors excluded from reports

### Vendor Databases (raw data, Step 1 output)

| Database | Source | Key Table(s) |
|----------|--------|--------------|
| squareup.db | Square API | items, payouts, payout_entries |
| grubhub.db | CSV or Chrome extension | orders |
| doordash.db | CSV or Chrome extension | detailed_transactions, payouts |
| ubereats.db | CSV or Chrome extension | orders, items |
| rocketmoney.db | CSV | transactions |

**ubereats.db detail**: When data comes from the Chrome extension (not CSV), `ubereats.db` has a real `items` table with item-level detail (item_name, quantity, price, modifiers, modifiers_json). The `orders` table also gains extension-only columns: `tip`, `delivery_fee`, `promotions`, `adjustment_amount`, `checkout_info_json`. CSV imports only populate the base `orders` columns.

**doordash.db detail** (extension data adds columns): `tip`, `customer_name`, `commission_rate`, `items_json`, `raw_json`, `source`. The `source` column distinguishes `'csv'` from `'extension'` rows.

**grubhub.db detail** (extension data adds columns): `items_json`, `special_instructions`, `order_status`, `customer_name`, `source`, `order_uuid`, `channel_brand`, `order_source`, `placed_at_time`. The `source` column distinguishes `'csv'` from `'extension'` rows.

---

## DB Access Modules (src/lib/db/)

### sales-db.ts
Read-only access to sales.db. Key exports:
- `querySales(params)` — Filtered, paginated order queries
- `queryPlatformBreakdown(params)` — Platform summary aggregation

### bank-db.ts
Read/write access to bank.db with vendor alias resolution. Key exports:
- `queryBank(params)` — Filtered bank transactions with alias resolution
- `resolveVendorFromRecord(name, customName, description)` — Multi-field vendor lookup (custom_name -> name -> description, each checked against aliases)
- `resolveVendorCategory(displayName)` — Map resolved vendor name to expense category via categorization rules
- `updateTransactionCustomName(id, customName)` — Rename individual transaction
- `bulkUpdateTransactionCustomName(ids, customName)` — Bulk rename

### config-db.ts
CRUD for all configuration tables in categories.db and vendor-aliases.db. Exports functions for every config entity (aliases, categories, rules, settings, imports, reconciliation, menu categories, modifier aliases).

Key exports for the menu categories system:
- `getAllMenuCategories()` — List all user-defined categories
- `createMenuCategory(id, name, color?, sortOrder?)` — Create category
- `assignItemToCategory(id, displayName, categoryId)` — Map item to category
- `bulkAssignItems(items)` — Atomic bulk assignment
- `getItemCategoryMappings()` — All display_name → category mappings
- `getCategoryBySquareCatalogId(squareCatalogId)` — Lookup for catalog sync
- `assignItemToCategoryFromCatalog(id, displayName, categoryId, squareItemId?)` — Used by catalog sync

---

## API Routes

### Dashboard & Reporting

| Method | Route | Source DBs | Purpose |
|--------|-------|-----------|---------|
| GET | /api/dashboard/overview | sales.db, bank.db | Main dashboard (revenue, expenses, profit, trends, top items) |
| GET | /api/dashboard/revenue | sales.db | Revenue chart data, platform breakdown |
| GET | /api/dashboard/expenses | bank.db, sales.db | Expense breakdown with prior period comparison, cost split, top transactions, monthly budget |
| GET | /api/dashboard/expenses/category/[cat] | bank.db | Category detail with stats, frequency, monthly trend |
| GET | /api/dashboard/expenses/vendor/[vendor] | bank.db | Vendor detail with stats, frequency, monthly trend |
| GET | /api/dashboard/platforms | sales.db | Platform comparison |
| GET | /api/dashboard/platforms/[platform] | sales.db | Single platform drilldown — returns full order fields (commission_fee, processing_fee, delivery_fee, marketing_fee, customer_name, dining_option, order_status, etc.) plus batch-fetched `order_items` array per order |
| GET | /api/dashboard/menu | sales.db, categories.db | Menu performance: items, categories, modifiers, cross-platform |
| GET | /api/dashboard/tax | sales.db | Tax summary |
| GET | /api/health-report | sales.db, bank.db | KPIs, projections, seasonality, menu performance, insights |

### Sales & Analytics

| Method | Route | Source DBs | Purpose |
|--------|-------|-----------|---------|
| GET | /api/transactions | sales.db | Paginated sales with filtering |
| GET | /api/analytics | sales.db | Item-level analytics; `revenue_by_hour` response includes `ubereatsHasTime` boolean (data-driven — true when UberEats orders have non-null time values) |
| GET | /api/data-range | sales.db, bank.db | Date range of available data |

### Bank Activity

| Method | Route | Source DBs | Purpose |
|--------|-------|-----------|---------|
| GET | /api/bank-activity | bank.db | Transactions with vendor resolution |
| PATCH | /api/bank-activity | bank.db | Rename transaction(s) |

### Data Import & Sync

| Method | Route | Purpose |
|--------|-------|---------|
| POST | /api/upload | CSV upload (triggers full pipeline) |
| POST | /api/ingest/extension | Receive data from Chrome extension (runs full pipeline) |
| GET | /api/ingest/extension | Health check; `?action=known_ids&platform=ubereats` returns known order IDs for smart-sync dedup |
| POST | /api/square/sync | Square API sync (3-step pipeline) |
| GET | /api/square/sync | Last sync timestamp |
| GET | /api/square/status | Square API connection status |
| POST | /api/square/status | Update Square API token |
| GET | /api/square/catalog | Preview Square catalog sync (dry run) |
| POST | /api/square/catalog | Run Square catalog sync (async, returns operationId) |
| GET | /api/imports | Import history |
| GET | /api/progress/[id] | SSE stream for async operation progress |

### Menu Configuration

| Method | Route | Purpose |
|--------|-------|---------|
| GET/POST/PATCH/DELETE | /api/menu-categories | User-defined menu category CRUD, item assignment, bulk assign, suggestions, seed, reset |
| GET/POST/PATCH | /api/menu-item-aliases | Sales item name mappings |
| GET/POST/PATCH | /api/menu-modifiers | Modifier alias and ignore management |

### Configuration

| Method | Route | Purpose |
|--------|-------|---------|
| GET/POST/DELETE | /api/settings | Key-value settings CRUD |
| GET/POST/PATCH | /api/vendor-aliases | Bank vendor name mappings |
| GET/POST/PATCH | /api/expense-categories | Expense category definitions |
| GET/POST/PATCH | /api/categorization-rules | Auto-categorization rules |
| GET/POST/DELETE | /api/closed-days | Closed day management |

### Reconciliation

| Method | Route | Purpose |
|--------|-------|---------|
| GET | /api/reconciliation | Summary, matches, alerts |
| GET | /api/reconciliation/chains | Match chains with platform filter |
| POST | /api/reconciliation/run | Run matcher algorithm |
| POST/DELETE | /api/reconciliation/match | Create/remove match |
| PATCH | /api/reconciliation/alerts | Resolve alert |

### Plaid (Bank Connection)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | /api/plaid/status | Connection status |
| POST | /api/plaid/create-link-token | Create Plaid Link token |
| POST | /api/plaid/exchange-token | Exchange public token |
| POST | /api/plaid/sync | Sync bank transactions |
| POST | /api/plaid/disconnect | Disconnect account |

---

## Services (src/lib/services/)

| Service | Purpose |
|---------|---------|
| square-sync.ts | Square API sync orchestrator (fetches payments, runs 3-step pipeline) |
| square-api.ts | Square API client (payments, orders, catalog, batch retrieval) |
| square-catalog-sync.ts | Syncs Square catalog categories and items → menu_categories + menu_item_category_map |
| pipeline-step1-ingest.ts | CSV/extension data → vendor DB (parsing, cleanup, dedup) |
| pipeline-step2-unify.ts | Vendor DB → unified DB (schema normalization, fee rollups, real item rows) |
| pipeline-step3-aliases.ts | Apply menu item aliases + category mappings to order_items |
| ingestion.ts | CSV upload orchestrator (hash dedup, platform detection, full pipeline) |
| settings.ts | Settings CRUD wrapper with convenience helpers |
| progress.ts | In-memory operation progress tracking for async operations (SSE via /api/progress/[id]) |
| plaid-api.ts | Plaid API client |
| plaid-sync.ts | Plaid bank data sync |

---

## Shared UI Components

### ExpandedOrderRow (`src/components/orders/ExpandedOrderRow.tsx`)

A shared expandable order detail card used by both the Sales page and the Platform detail tab. Renders in a compact 2-column layout: items and modifiers on the left, a fee breakdown receipt on the right.

Exports the `ExpandableOrder` interface — the canonical shape expected wherever expandable order rows appear:

```ts
interface ExpandableOrder {
  id, platform, order_id, order_status, time,
  gross_sales, tax, tip, net_sales, discounts,
  dining_option, customer_name, payment_method,
  commission_fee, processing_fee, delivery_fee, marketing_fee,
  fees_total, marketing_total, refunds_total, adjustments_total, other_total,
  order_items?: OrderItem[]
}
```

`order_items` is optional — the row renders without item detail if the array is absent.

### PlatformDetailTab (`src/components/platforms/PlatformDetailTab.tsx`)

A self-contained client component that drives the Platform detail view. It:
1. Accepts `selectedPlatforms`, `startDate`, and `endDate` as props
2. Fetches from `/api/dashboard/platforms/[platform]` for each selected platform in parallel
3. Merges multi-platform data client-side (aggregates stats, concatenates order lists)
4. Renders stat cards, a revenue chart, a sortable orders table with expandable rows, and a payment-type breakdown

This component owns all data fetching for the platform detail view — the parent page only passes date range and platform selection.

### Removed: PlatformNav (`src/components/layout/PlatformNav.tsx`)

Deleted. The platform section no longer has sub-navigation; the full detail view is handled by `PlatformDetailTab` within the main platforms page.

### RevenueChart forecast suppression (`src/components/charts/RevenueChart.tsx`)

When the chart's data ends before today (i.e., the selected date range is entirely historical), forecast projection is suppressed — `forecastDaysTotal` is set to 0 regardless of user controls. This is data-driven: the check compares the last data point's date against today at midnight. Forecast projections only appear when the date range extends to or includes the current date.

---

## Chrome Extension (extension/)

A Manifest V3 Chrome extension for capturing order data from Uber Eats, DoorDash, and GrubHub merchant portals.

**Architecture:**
- `content-main.js` — MAIN world content script (Uber Eats). Patches `window.fetch` to intercept GraphQL responses. Extracts order UUIDs from React fiber state. Manages crawl modes.
- `content-bridge.js` — ISOLATED world bridge (Uber Eats). Relays messages from MAIN world to `background.js` via `chrome.runtime.sendMessage`.
- `content-doordash.js` — MAIN world content script (DoorDash). Captures auth headers from page requests, then fetches order list and per-order detail from DoorDash merchant API. Normalizes to flat csvRow format.
- `content-doordash-bridge.js` — ISOLATED world bridge (DoorDash). Relays to `background.js`.
- `content-grubhub.js` — MAIN world content script (GrubHub). Intercepts Bearer token from page's own API calls, then fetches transactions and per-order detail from GrubHub accounting API.
- `content-grubhub-bridge.js` — ISOLATED world bridge (GrubHub). Relays to `background.js`.
- `background.js` — Service worker. Receives captured data from all three platforms, normalizes per-platform, deduplicates, and POSTs to `/api/ingest/extension`.
- `popup.js` / `popup.html` — Extension popup UI for triggering sync modes.
- `lib/normalize.js` — Normalizes GraphQL response shape to Profit Duck's flat order format (Uber Eats).
- `lib/api-client.js` — Handles communication with the local Profit Duck server.
- `lib/dedup.js` — Client-side dedup using order IDs fetched from `/api/ingest/extension?action=known_ids`.

**Data flows:**
- Uber Eats: merchant portal → GraphQL intercept (MAIN world) → postMessage → bridge → background.js → normalize → POST /api/ingest/extension → 3-step pipeline → sales.db
- DoorDash: merchant portal → auth header capture → REST API fetch (orders + detail) → postMessage → bridge → background.js → POST /api/ingest/extension → 3-step pipeline → sales.db
- GrubHub: merchant portal → Bearer token capture → accounting API fetch (transactions + details) → postMessage → bridge → background.js → POST /api/ingest/extension → 3-step pipeline → sales.db

**Sync modes:**
- `smart-sync` (default): Fetches new orders until encountering known order IDs
- `full-sync`: Re-fetches all orders regardless of what is already in the database
- `date-range`: Fetches orders within a specified date range

**Current platform support:** Uber Eats, DoorDash, and GrubHub.

---

## Menu Categories System

Users define their own menu category groupings (not derived from POS raw categories). Categories live in `categories.db` and are applied to `order_items` via Step 3 of the pipeline.

**Two-table design in categories.db:**
1. `menu_categories` — The category definitions (name, color, sort_order, optional square_catalog_id for catalog-sourced categories)
2. `menu_item_category_map` — Maps `display_name` (post-alias item name) → `category_id` with optional `square_item_id`

**Step 3 behavior with categories:**
- If `menu_item_category_map` has rows → direct lookup (new system): sets all uncategorized items to "Uncategorized", then overwrites from mappings
- If `menu_item_category_map` is empty → falls back to `menu_category_aliases` pattern matching (legacy)

**Square Catalog Sync** (`/api/square/catalog`, `square-catalog-sync.ts`):
- Fetches all catalog categories and items from the Square API
- Creates `menu_categories` records for each real catalog category (skips MENU_ITEM_OPTION categories)
- Maps catalog items to categories by matching item names against `display_name` in `order_items`
- Does NOT overwrite manually assigned categories
- Async operation — returns `operationId`, progress via `/api/progress/[id]`

**Quick category updates** (used by `/api/menu-categories`): When assigning or reassigning a single item, only that item's `order_items` rows are updated directly (no full pipeline re-run).

---

## Structured Modifiers Pipeline

Square and Uber Eats extension data provides structured modifier information stored as JSON.

**Format stored in `order_items.modifiers`:**
```json
[{"group": "Sauce", "name": "Hot Sauce", "price": 0.50}, {"group": "Size", "name": "Large", "price": 0}]
```

**Sources:**
- Square API: `modifiers` from the Orders batch-retrieve API, `total_price_money` used for prices
- Uber Eats extension: `customizations` from GraphQL `OrderDetails` response

**Analytics** (`/api/dashboard/menu`): Modifier analytics parse the JSON to compute attach rates, paid vs free modifier counts, modifier revenue, and per-item modifier breakdowns.

---

## Vendor Alias Resolution Chain

When displaying a bank transaction, the system resolves the vendor name through this chain:

```
1. custom_name (user override via inline rename)
   ↓ if empty
2. name (Rocket Money cleaned name)
   ↓ if empty
3. description (raw bank description)

For each non-empty field, check vendor_aliases table:
  - Exact match: "costco" === "costco"
  - Starts with: "amzn mktp" starts with "amzn"
  - Contains: "COSTCO WHSE #1062" contains "costco"

First match wins → return display_name (e.g., "Amazon", "Costco")
No match → return the raw field value
```

## Expense Category Resolution

After resolving the vendor name, the category is determined:

```
Resolved vendor name (e.g., "Costco")
   ↓
Check categorization_rules in categories.db:
  - type: "vendor_match", pattern: "Costco", category_id: "groceries"
   ↓
Return category name: "Groceries & Ingredients"

If no rule matches → use the raw Rocket Money category field
```

---

## Settings Reference

| Key | Purpose | Sensitive |
|-----|---------|-----------|
| square_api_token | Square POS API access token | Yes |
| auto_sync_enabled | Enable automatic Square sync | No |
| last_sync_at | ISO timestamp of last sync | No |
| restaurant_open_date | Business opening date (for projections) | No |
| plaid_access_token | Plaid bank API token | Yes |
| plaid_item_id | Plaid connected institution ID | No |
| plaid_cursor | Plaid sync pagination cursor | No |
| plaid_institution_name | Connected bank display name | No |
| plaid_account_name | Connected account display name | No |
| plaid_last_sync_at | Last Plaid sync timestamp | No |

---

## Reconciliation System

The reconciliation matcher (src/lib/services/reconciliation/matcher.ts) directly matches sales orders to bank deposits without an intermediate payout layer:

```
sales.db orders (grouped by week + platform)
   ↓ match by amount (±$5 tolerance) and date (±7 days)
bank.db rocketmoney deposits (negative amounts from platform-specific patterns)
   ↓
Store matches in categories.db reconciliation_matches table
Generate alerts for discrepancies in reconciliation_alerts table
```

Platform detection in bank transactions uses name patterns:
- Square: "SQ *", "Square", "GOSQ"
- GrubHub: "GRUBHUB", "GH *"
- DoorDash: "DOORDASH", "DD *"
- Uber Eats: "UBER EATS", "UBEREATS"
