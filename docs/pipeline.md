<!-- Last updated: 2026-04-02 — bank.db now uses unified transactions table (replaces rocketmoney/chase_statements); Step 2 flow and database map updated -->

# Data Pipeline

## Overview

All data flows through a 3-step pipeline before reaching the website. Every source — CSV, API, or Chrome extension — goes through Step 1 first (vendor DB), then Step 2 (unified DB), then Step 3 (aliases + categories). No source writes directly to the unified databases.

```
             STEP 1                    STEP 2                         STEP 3
        Source → Vendor DB        Vendor DB → Unified DB         Apply Aliases + Categories
        (raw + cleanup)           (normalize)                    (categories.db → sales.db)

API     ──→ squareup.db     ──→ sales.db (orders + order_items) ──→ order_items.display_name
CSV     ──→ grubhub.db      ──→ sales.db (orders + order_items)     order_items.display_category
EXT     ──→ grubhub.db      ──→ sales.db (orders + order_items)  (with real item rows)
CSV     ──→ doordash.db     ──→ sales.db (orders + order_items)
EXT     ──→ doordash.db     ──→ sales.db (orders + order_items)  (with real item rows)
CSV     ──→ ubereats.db     ──→ sales.db (orders + order_items)
EXT     ──→ ubereats.db     ──→ sales.db (orders + order_items)  (with real item rows + modifiers_json)
CSV     ──→ rocketmoney.db  ──→ bank.db  (rocketmoney)
```

**Key principles:**
- The vendor DBs are the source of truth for raw data
- The unified DBs (sales.db, bank.db) can be rebuilt at any time by re-running Step 2
- Alias and category rules live in categories.db (user configuration)
- Step 3 can be re-run independently when alias or category rules change (no re-import needed)
- Quick category updates bypass the full pipeline by directly updating matching `order_items` rows

---

## Step 1: Source → Vendor DB

**Purpose:** Store raw data with basic cleanup. Each data source gets its own SQLite database that preserves all original columns from the CSV, API, or extension.

**Files:**
- `src/lib/services/pipeline-step1-ingest.ts` — CSV and extension data ingest for GrubHub, DoorDash, Uber Eats, Rocket Money
- `src/lib/services/square-sync.ts` — Square API sync (API → squareup.db → sales.db)

### Entry points:

| Trigger | Route | Step 1 Target |
|---------|-------|---------------|
| CSV Upload (Settings page) | `POST /api/upload` → parser → `step1Ingest()` | vendor DB for detected platform (not Square) |
| Chrome Extension (Uber Eats) | `POST /api/ingest/extension` → `ingestUberEatsOrders()` | ubereats.db (orders + items tables) |
| Chrome Extension (DoorDash) | `POST /api/ingest/extension` → `ingestDoordashOrders()` | doordash.db (detailed_transactions table) |
| Chrome Extension (GrubHub) | `POST /api/ingest/extension` → `ingestGrubhubOrders()` | grubhub.db (orders table) |
| Square API Sync (Settings page) | `POST /api/square/sync` → `syncSquareFees()` | squareup.db |
| Manual script | `npx tsx scripts/reimport-rocketmoney.ts` | rocketmoney.db |
| Pipeline rebuild | `npx tsx scripts/rebuild-pipeline.ts` | Rebuild sales.db + bank.db from all vendor DBs |

### Cleanup operations:

| Operation | Description |
|-----------|-------------|
| **Dedup** | Remove duplicate records within the same source (overlapping CSV exports, re-imports, extension re-syncs) |
| **Date normalization** | All dates converted to YYYY-MM-DD (Uber Eats M/D/YYYY, ISO datetimes, etc.) |
| **Amount normalization** | Handle $, commas, parentheses for negatives, string→number |
| **Status filtering** | Flag cancelled/unfulfilled orders vs completed |
| **Fill missing data** | Square API orders include item-level detail; extension data includes items + structured modifiers |

### Vendor databases:

| Database | Table | Source | Dedup Key |
|----------|-------|--------|-----------|
| `squareup.db` | `items` | API | transaction_id + item + qty |
| `squareup.db` | `payouts` | API | payout_id |
| `squareup.db` | `payout_entries` | API | entry_id |
| `grubhub.db` | `orders` | CSV or Extension | transaction_id |
| `doordash.db` | `detailed_transactions` | CSV or Extension | doordash_order_id |
| `doordash.db` | `payouts` | CSV | payout_id |
| `ubereats.db` | `orders` | CSV or Extension | order_id |
| `ubereats.db` | `items` | Extension only | order_id (FK) |
| `rocketmoney.db` | `transactions` | CSV | date + name + amount |

### doordash.db additional columns (extension data only):

The extension writes to the existing `detailed_transactions` table. These columns are added via `ALTER TABLE IF NOT EXISTS` and default to empty/null for CSV rows:

```
tip               TEXT   Tip amount (dollars)
customer_name     TEXT   Customer display name
commission_rate   TEXT   Commission rate (decimal string, e.g. "0.15")
items_json        TEXT   JSON array: [{"name":"...","quantity":N,"price":0.00,"category":"...","extras":[...]}]
raw_json          TEXT   Full raw API response for debugging
source            TEXT   "csv" or "extension"
```

### grubhub.db additional columns (extension data only):

The extension writes to the existing `orders` table. These columns are added via `ALTER TABLE IF NOT EXISTS` and default to null for CSV rows:

```
items_json             TEXT   JSON array of items with modifiers
special_instructions   TEXT   Order-level special instructions
order_status           TEXT   Order status from GrubHub API
customer_name          TEXT   Customer display name
source                 TEXT   "csv" or "extension"
order_uuid             TEXT   GrubHub internal order UUID
channel_brand          TEXT   Brand channel (e.g. "GRUBHUB")
order_source           TEXT   Order source identifier
placed_at_time         TEXT   ISO timestamp of when order was placed
```

### ubereats.db items table schema (extension data only):
```
order_id            TEXT   FK → orders.order_id
item_uuid           TEXT   UUID from Uber Eats GraphQL
item_name           TEXT   Menu item name
quantity            INTEGER
price               REAL   Line total (price × quantity)
modifiers           TEXT   Flat string: "Group: Option1 (price), Option2"
modifiers_json      TEXT   JSON array: [{"group":"...","name":"...","price":0.00}]
special_instructions TEXT
```

### Extension ingest detail (DoorDash):

The Chrome extension scrapes DoorDash's merchant portal and POSTs to `/api/ingest/extension`. The route runs the full 3-step pipeline:

```
content-doordash.js (MAIN world) captures order list via XHR (crawlFetch → get_orders API)
content-doordash-bridge.js (ISOLATED world) relays messages to background service worker
   ↓
For each order: load merchant portal order detail page in hidden iframe (3 parallel iframes)
Parse block-structured text from iframe for items, fees, tip, customer name
   ↓
POST /api/ingest/extension { platform: "doordash", orders: [...] }
   ↓
Step 1: ingestDoordashOrders() — upsert to doordash.db detailed_transactions (tip, customer_name,
        commission_rate, items_json, raw_json, source populated; amounts in dollars)
   ↓
Step 2: unifyDoorDash() — read from doordash.db, map to unified orders + order_items
   ↓
Step 3: step3ApplyAliases() — apply aliases and category mappings
```

Smart-sync dedup: before crawling, the extension fetches `GET /api/ingest/extension?action=known_ids&platform=doordash` which returns all known `doordash_order_id` values so already-imported orders are skipped.

### Extension ingest detail (GrubHub):

The Chrome extension intercepts GrubHub's merchant API and POSTs to `/api/ingest/extension`. The route runs the full 3-step pipeline:

```
content-grubhub.js (MAIN world) intercepts fetch to capture Bearer token (read-only, no monkey-patching)
content-grubhub-bridge.js (ISOLATED world) relays messages to background service worker
   ↓
background.js calls GrubHub transactions API (api-order-processing-gtm.grubhub.com) with weekly pagination
For recent orders (~4-month retention window): fetch order detail API for items, modifiers, special instructions
Amounts returned by GrubHub API in cents — converted to dollars before storage
   ↓
POST /api/ingest/extension { platform: "grubhub", orders: [...] }
   ↓
Step 1: ingestGrubhubOrders() — upsert to grubhub.db orders (items_json, order_uuid, channel_brand,
        order_source, placed_at_time, customer_name populated)
   ↓
Step 2: unifyGrubhub() — read from grubhub.db; filter out DISTRIBUTION (weekly payouts) and
        "Account Adjustment" rows; map to unified orders + order_items
   ↓
Step 3: step3ApplyAliases() — apply aliases and category mappings
```

Smart-sync dedup: before crawling, the extension fetches `GET /api/ingest/extension?action=known_ids&platform=grubhub` which returns all known `transaction_id` values so already-imported orders are skipped.

### Extension ingest detail (Uber Eats):

The Chrome extension intercepts GraphQL `OrderDetails` responses from `merchants.ubereats.com`, extracts order and item data, and POSTs to `/api/ingest/extension`. The route runs the full 3-step pipeline:

```
Extension captures GraphQL response
   ↓
background.js normalizes + deduplicates
   ↓
POST /api/ingest/extension { platform: "ubereats", orders: [...] }
   ↓
Step 1: ingestUberEatsOrders() — write to ubereats.db orders + items tables
   ↓
Step 2: unifyUberEats() — read real items from ubereats.db items table
   ↓
Step 3: step3ApplyAliases() — apply aliases and category mappings
```

Smart-sync dedup: before crawling, the extension fetches known order IDs via `GET /api/ingest/extension?action=known_ids&platform=ubereats` to skip already-imported orders.

### Square API sync detail:

All Square data comes exclusively from the API (no CSV imports). The sync follows the full 3-step pipeline:

```
1. Fetch payments from Square API (cursor-paginated)
2. For each payment, resolve real order_id
3. Batch-retrieve order details (line items, modifiers with prices, tax, dining option)
4. STEP 1: Dedup against squareup.db by payment_id, write items to squareup.db
5. STEP 2: Call shared unifySquare() — aggregate items by transaction_id,
           write to sales.db orders + order_items (with modifiers_json from API)
6. STEP 3: Call shared step3ApplyAliases() — apply menu/category aliases
```

Payment method is determined from the API `source_type` field:
- `CASH` → "Cash"
- `WALLET` → "Digital Wallet"
- `CARD` → Card brand (Visa, MasterCard, American Express, etc.)
- `EXTERNAL` → "External"
- Multi-tender transactions → "Split Payment"

The `getLastSyncDate()` function reads from `squareup.db` (Step 1 source of truth), not from `sales.db`.

---

## Step 2: Vendor DB → Unified DB

**Purpose:** Read clean data from vendor DBs and write normalized records to unified databases that power the website pages.

**File:** `src/lib/services/pipeline-step2-unify.ts`

### Normalization operations:

| Operation | Description |
|-----------|-------------|
| **Schema mapping** | Each platform's columns mapped to unified `orders` table |
| **Summary rollups** | Calculate `fees_total`, `marketing_total`, `refunds_total`, `adjustments_total`, `other_total` |
| **Sign normalization** | All fees/deductions stored as negative values |
| **Cross-source dedup** | Dedup by `order_id + platform` |
| **Aggregation** | Square items grouped by `transaction_id` into order-level records |
| **Real item rows** | Uber Eats extension data: real items from `ubereats.db items` table used; CSV fallback uses synthetic "Uber Eats Order" row |

### Unified databases:

| Database | Table | Purpose | Powers |
|----------|-------|---------|--------|
| `sales.db` | `orders` | All platform orders, normalized | Sales page |
| `sales.db` | `order_items` | Individual items, all platforms | Item analytics, drilldowns, menu performance |
| `bank.db` | `rocketmoney` | All bank transactions | Bank Activity page |
| `bank.db` | `chase_statements` | Chase PDF imports | Bank Activity page |

### Unified `orders` table schema:

```
── Raw columns (preserved from source) ──
date              TEXT     YYYY-MM-DD
time              TEXT     HH:MM:SS
platform          TEXT     square / grubhub / doordash / ubereats
order_id          TEXT     Platform's unique order/transaction ID
gross_sales       REAL     Subtotal before fees/discounts
tax               REAL     Sales tax collected
total_fees        REAL     Sum of all deductions (negative)
net_sales         REAL     What you actually receive
order_status      TEXT     completed / cancelled / refund / adjustment / other
items             TEXT     "Fruitella Crêpe x1 | Coffee x2" (Square + Uber Eats extension)
item_count        INTEGER  Number of items in order
modifiers         TEXT     "Item: Modifier1, Modifier2 | ..." (Square + Uber Eats extension)
tip               REAL     Tip amount
discounts         REAL     Discount amount (negative)
dining_option     TEXT     For Here / To Go / Delivery / Pickup / Storefront
customer_name     TEXT     Customer name (Square + Uber Eats)
payment_method    TEXT     Visa / MasterCard / etc. (Square only)
commission_fee    REAL     Platform commission (negative)
processing_fee    REAL     Payment processing fee (negative)
delivery_fee      REAL     Delivery commission (negative)
marketing_fee     REAL     Marketing/promo fees (negative)

── Summary rollups (calculated) ──
fees_total        REAL     commission + processing + delivery (negative)
marketing_total   REAL     Promos, loyalty, marketing fees (negative)
refunds_total     REAL     Refunds only (negative)
adjustments_total REAL     Error charges, order charges, adjustments
other_total       REAL     Anything that doesn't fit above
display_categories TEXT    Denormalized: comma-joined display_categories from order_items
```

### Column availability by platform:

| Column | Square | GrubHub (CSV) | GrubHub (Ext) | DoorDash (CSV) | DoorDash (Ext) | Uber Eats (Ext) | Uber Eats (CSV) |
|--------|--------|---------------|---------------|----------------|----------------|-----------------|-----------------|
| date | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| time | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| items (order-level summary) | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| modifiers (order-level summary) | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| item rows in order_items | ✅ per item | ❌ order only | ✅ per item | ❌ order only | ✅ per item | ✅ per item | ❌ order only |
| modifiers_json in order_items | ✅ JSON | ❌ | ✅ JSON | ❌ | ❌ | ✅ JSON | ❌ |
| tip | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| dining_option | ✅ For Here/To Go | ✅ Delivery/Pickup | ✅ Delivery/Pickup | ✅ Delivery/Storefront | ✅ Delivery/Storefront | ✅ Delivery/Pickup | ✅ Delivery |
| customer_name | ✅ | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ |
| payment_method | ✅ Visa/MC/Amex | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| commission_fee | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| processing_fee | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| delivery_fee | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| marketing_fee | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |

### Unified `order_items` table schema:

```
── Identifiers ──
order_id          TEXT     Links to orders.order_id
platform          TEXT     square / grubhub / doordash / ubereats
date              TEXT     YYYY-MM-DD
time              TEXT     HH:MM:SS

── Raw from source ──
item_name         TEXT     Raw item name from CSV/API/extension
category          TEXT     Raw category from source (mostly empty for third-party platforms)
qty               REAL     Quantity ordered
unit_price        REAL     Price per unit
gross_sales       REAL     qty × unit_price (or line total for Uber Eats)
discounts         REAL     Item-level discounts
net_sales         REAL     gross - discounts
modifiers         TEXT     JSON array for Square/UE extension; flat string for legacy CSV Square
event_type        TEXT     Payment / Refund
dining_option     TEXT     For Here / To Go / Delivery / Pickup

── After alias (Step 3) ──
display_name      TEXT     After menu item alias applied
display_category  TEXT     After menu category mapping applied (or "Uncategorized")
```

**Item detail by platform:**

| Platform | Item detail | What order_items contains |
|----------|-------------|--------------------------|
| Square | ✅ Per item | Individual items with names, qty, price, modifiers_json, category |
| GrubHub (CSV) | ❌ Order only | 1 row per order: "GrubHub Order" with order total |
| GrubHub (Extension) | ✅ Per item | Individual items with names, qty, price, modifiers_json (recent orders only; ~4-month API retention) |
| DoorDash (CSV) | ❌ Order only | 1 row per order: "DoorDash Order" with order total |
| DoorDash (Extension) | ✅ Per item | Individual items with names, qty, price (no modifiers_json) |
| Uber Eats (Extension) | ✅ Per item | Individual items with names, qty, price, modifiers_json |
| Uber Eats (CSV) | ❌ Order only | 1 row per order: "Uber Eats Order" with order total |

### Math verification:

```
net_sales = gross_sales + discounts + tax + tip + fees_total + marketing_total
            + refunds_total + adjustments_total + other_total
```

All platforms verified. 4 DoorDash edge cases with $5 marketing credit discrepancy and 1 Uber Eats first-payout threshold are source data issues, not formula errors.

---

## Step 3: Apply Aliases + Category Mappings

**Purpose:** Apply user-configured alias rules and category mappings from `categories.db` to the `order_items` table in `sales.db`. Populates `display_name` and `display_category` columns. Also denormalizes `display_categories` onto the `orders` table for fast filtering.

**File:** `src/lib/services/pipeline-step3-aliases.ts`

### How it works:

1. Reset all `display_name` to `item_name` and `display_category` to `category`
2. Apply `menu_item_aliases` from categories.db (pattern match on item_name → display_name)
3. Apply category mapping (two modes, see below)
4. Denormalize: update `orders.display_categories` = comma-joined distinct display_categories from matching order_items

### Category mapping modes (Step 3):

**New system (menu_item_category_map has rows):**
1. Set all `display_category` to "Uncategorized"
2. JOIN `menu_item_category_map` + `menu_categories` to get display_name → category_name pairs
3. UPDATE `order_items.display_category` for each mapped item

**Legacy fallback (menu_item_category_map is empty):**
- Apply `menu_category_aliases` pattern matching (same exact/starts_with/contains logic as item aliases)

### When to re-run:

| Trigger | Action |
|---------|--------|
| New CSV import | Runs automatically as part of ingestion pipeline |
| Extension data import | Runs automatically after extension ingest |
| Square API sync | Runs automatically after sync |
| Alias added/changed in Settings | Should re-run Step 3 only (no re-import) |
| Category assigned in Menu page | Fast path: update only affected rows directly (no full Step 3) |
| Full rebuild | Re-run Step 2 + Step 3 |

**Performance note:** Never call `step3ApplyAliases()` for single-item category changes. Use the direct UPDATE path in `/api/menu-categories` (`quickCategoryUpdate()`).

---

## Side Process: Square Catalog Sync

The Square catalog sync is NOT part of the 3-step pipeline. It runs independently as a way to bootstrap the menu categories system.

**File:** `src/lib/services/square-catalog-sync.ts`
**Endpoint:** `POST /api/square/catalog`

```
Square Catalog API
   ↓
fetchCatalog() — fetch all CatalogCategories + CatalogItems
   ↓
Filter to real menu categories (type=MENU_CATEGORY or isTopLevel=true)
   ↓
Create menu_categories records (skips existing, links by square_catalog_id)
   ↓
Match catalog items to display_names in order_items
   ↓
Populate menu_item_category_map (skips already-mapped items)
   ↓
Next Step 3 run will use new mappings
```

This is a one-time or occasional operation. After catalog sync, Step 3 automatically uses the new mappings. It does not overwrite manually assigned categories.

---

## Modifier Backfill Scripts

When the structured modifiers format was introduced, existing data in squareup.db lacked `modifiers_json`. Two backfill scripts exist for this:

- `scripts/backfill-square-modifiers.ts` — Original Square backfill
- `scripts/backfill-square-modifiers-v2.ts` — Updated version with improved parsing
- `scripts/backfill-modifiers.js` — General modifier backfill utility

These re-fetch modifier data from the Square API and update squareup.db, then a pipeline rebuild re-runs Step 2 to populate order_items.modifiers with the JSON format.

---

## Full Flow Examples

### Importing a new GrubHub CSV:

```
1. User uploads CSV via Settings page
2. POST /api/upload receives file
3. ingestion.ts detects "grubhub" from CSV headers
4. ingestion.ts calls step1Ingest("grubhub", rows)
   └─ pipeline-step1-ingest.ts:
      - Dedup by transaction_id (skip if already exists in grubhub.db)
      - Normalize dates to YYYY-MM-DD
      - Write raw CSV columns to grubhub.db
5. ingestion.ts calls step2Unify("grubhub")
   └─ pipeline-step2-unify.ts:
      - Read all orders from grubhub.db
      - Map: subtotal → gross_sales
      - Calculate: fees_total = -(commission + delivery + processing)
      - Calculate: marketing_total = -(promos + loyalty)
      - Map: fulfillment_type → dining_option (Delivery/Pickup)
      - Map: transaction_type → order_status
      - Dedup by order_id + platform in sales.db
      - Insert into unified orders table + order_items table (1 row: "GrubHub Order")
6. ingestion.ts calls step3ApplyAliases()
   └─ pipeline-step3-aliases.ts:
      - Read menu_item_aliases from categories.db
      - Update order_items.display_name for matching items
      - Apply category mappings (menu_item_category_map or menu_category_aliases)
      - Update order_items.display_category
      - Denormalize display_categories onto orders table
7. ingestion.ts records import in categories.db for history tracking
8. Sales page shows new orders immediately
```

### Syncing Uber Eats via Chrome extension:

```
1. User opens extension popup, clicks "Smart Sync"
2. Extension fetches known order IDs from GET /api/ingest/extension?action=known_ids&platform=ubereats
3. Extension crawls merchants.ubereats.com — content-main.js intercepts GraphQL OrderDetails
4. For each new order, background.js normalizes data (normalize.js)
5. background.js POSTs to POST /api/ingest/extension
6. Route calls ingestUberEatsOrders(orders)
   └─ Writes to ubereats.db orders table (financials)
   └─ Writes to ubereats.db items table (item_name, quantity, price, modifiers_json)
7. Route calls unifyUberEats()
   └─ For each order: check ubereats.db items table
   └─ If items exist: insert real item rows to sales.db order_items (one per item)
   └─ If no items: insert synthetic "Uber Eats Order" row (CSV fallback)
8. Route calls step3ApplyAliases()
9. Sales page shows new orders with real item names and modifier data
```

### Running a Square API sync:

```
1. User clicks "Sync" on Settings page
2. POST /api/square/sync → square-sync.ts
3. square-sync.ts (follows full 3-step pipeline):
   a. Fetch payments from Square API (cursor-paginated)
   b. For each payment, resolve real order_id
   c. Batch-retrieve order details (line items, modifiers with prices, tax, dining option)
   d. Step 1: Dedup by payment_id → write new items to squareup.db (with modifiers_json)
   e. Step 2: Call shared unifySquare() → aggregate items by transaction_id
              → write to sales.db orders + order_items (modifiers_json preserved)
   f. Step 3: Call shared step3ApplyAliases() → apply menu/category aliases
4. Sales page shows new orders with full item names, modifiers, and payment method
```

### Rebuilding unified DBs (after changing cleanup rules):

```
1. Call step2UnifyAll(rebuild: true)
2. Clears sales.db orders + order_items tables
3. Clears bank.db rocketmoney table
4. Re-reads ALL vendor DBs (squareup, grubhub, doordash, ubereats, rocketmoney)
5. Re-applies normalization, schema mapping, summary rollups
6. For ubereats: uses real items from ubereats.db items table if available
7. Call step3ApplyAliases()
8. All pages reflect updated rules
9. No data loss — vendor DBs and config DBs are untouched
```

### Re-applying aliases only (after changing alias rules):

```
1. Call step3ApplyAliases()
2. Resets all display_name/display_category to raw values
3. Re-reads ALL alias rules from categories.db
4. Applies menu_item_aliases (pattern match → display_name)
5. Applies menu_item_category_map OR menu_category_aliases (depending on which is populated)
6. Updates orders.display_categories (denormalized)
7. No re-import needed
```

---

## Database Map

```
/databases/
│
│  ── Source databases (Step 1) ──
│
├── squareup.db        Source: Square POS (API only)
│   ├── items          Item-level sales with modifiers_json
│   ├── payouts        Deposit records
│   └── payout_entries Order→deposit links
│
├── grubhub.db         Source: GrubHub
│   └── orders         Order-level (CSV)
│
├── doordash.db        Source: DoorDash
│   ├── detailed_transactions  Order-level (CSV)
│   └── payouts        Deposit records (CSV)
│
├── ubereats.db        Source: Uber Eats
│   ├── orders         Order-level financials (CSV or Extension)
│   └── items          Item-level detail with modifiers_json (Extension only)
│
├── rocketmoney.db     Source: Rocket Money
│   └── transactions   Bank activity (CSV)
│
│  ── Unified databases (Step 2) ──
│
├── sales.db           Unified: Sales page + Menu Performance
│   ├── orders         All platforms, normalized (financials)
│   └── order_items    Individual items, all platforms (analytics)
│
├── bank.db            Unified: Bank Activity page
│   ├── rocketmoney    All bank transactions
│   └── chase_statements  Chase PDF imports
│
│  ── Config databases (Step 3 + Settings) ──
│
├── categories.db      User configuration: aliases + categories + settings
│   ├── menu_item_aliases       Item name display mappings
│   ├── menu_item_ignores       Items excluded from analytics
│   ├── menu_category_aliases   Category name mappings (legacy)
│   ├── menu_categories         User-defined category groups
│   ├── menu_item_category_map  Item → category assignments
│   ├── menu_modifier_aliases   Modifier name mappings
│   ├── menu_modifier_ignores   Modifiers excluded from analytics
│   ├── expense_categories      Expense category definitions
│   ├── categorization_rules    Auto-categorization rules
│   ├── category_ignores        Categories excluded from reports
│   ├── closed_days             Days the restaurant was closed
│   ├── imports                 Import history with file hashes
│   ├── settings                Key-value store (tokens, config)
│   ├── reconciliation_matches  Sales-to-bank deposit pairings
│   └── reconciliation_alerts   Reconciliation discrepancy alerts
│
├── vendor-aliases.db  User configuration: vendor mappings
│   ├── vendor_aliases  Bank vendor name mappings
│   └── vendor_ignores  Vendors excluded from reports
```

---

## Key Files

| File | Purpose | Pipeline Role |
|------|---------|---------------|
| `src/lib/services/ingestion.ts` | CSV upload orchestrator | Calls Step 1 → Step 2 → Step 3 sequentially |
| `src/app/api/ingest/extension/route.ts` | Extension ingest endpoint | Calls Step 1 → Step 2 → Step 3 for extension data |
| `src/lib/services/pipeline-step1-ingest.ts` | Step 1: CSV/extension rows → Vendor DB | Dedup, date/amount normalization, items table |
| `src/lib/services/pipeline-step2-unify.ts` | Step 2: Vendor DB → Unified DB | Schema mapping, fee rollups, real item rows |
| `src/lib/services/pipeline-step3-aliases.ts` | Step 3: Apply aliases + categories | menu/category aliases + category mappings → order_items |
| `src/lib/services/square-sync.ts` | Square API sync | Full pipeline: API → squareup.db → sales.db |
| `src/lib/services/square-catalog-sync.ts` | Square catalog sync | Side process: catalog → menu_categories + menu_item_category_map |
| `scripts/rebuild-pipeline.ts` | Full pipeline rebuild | Step 2 + Step 3 from scratch |
| `src/lib/services/square-api.ts` | Square API client | Fetch payments, orders, catalog |
| `src/lib/parsers/*.ts` | Platform-specific CSV parsers | Detect file type + parse headers |
| `src/lib/services/dedup.ts` | Deduplication utilities | File hash + row-level dedup |
| `extension/content-main.js` | Uber Eats extension (MAIN world) | Intercepts GraphQL OrderDetails responses |
| `extension/content-bridge.js` | Uber Eats extension (ISOLATED world) | Relays messages to background service worker |
| `extension/content-doordash.js` | DoorDash extension (MAIN world) | XHR order list (crawlFetch) + iframe order detail scraping |
| `extension/content-doordash-bridge.js` | DoorDash extension (ISOLATED world) | Relays messages to background service worker |
| `extension/content-grubhub.js` | GrubHub extension (MAIN world) | Captures Bearer token via read-only fetch interceptor |
| `extension/content-grubhub-bridge.js` | GrubHub extension (ISOLATED world) | Relays messages to background service worker |
| `extension/background.js` | Extension service worker | Orchestrates all platforms: sync logic, smart-sync dedup, POST to /api/ingest/extension |
