# Data Pipeline

## Overview

All data flows through a 3-step pipeline before reaching the website. Every source — CSV or API — goes through Step 1 first (vendor DB), then Step 2 (unified DB), then Step 3 (aliases). No source writes directly to the unified databases.

```
             STEP 1                    STEP 2                         STEP 3
        Source → Vendor DB        Vendor DB → Unified DB         Apply Aliases
        (raw + cleanup)           (normalize)                    (categories.db → sales.db)

CSV/API ──→ squareup.db     ──→ sales.db (orders + order_items) ──→ order_items.display_name
CSV     ──→ grubhub.db      ──→ sales.db (orders + order_items)     order_items.display_category
CSV     ──→ doordash.db     ──→ sales.db (orders + order_items)
CSV     ──→ ubereats.db     ──→ sales.db (orders + order_items)
CSV     ──→ rocketmoney.db  ──→ bank.db  (rocketmoney)
```

**Key principles:**
- The vendor DBs are the source of truth for raw data
- The unified DBs (sales.db, bank.db) can be rebuilt at any time by re-running Step 2
- Alias rules live in categories.db and vendor-aliases.db (user configuration)
- Step 3 can be re-run independently when alias rules change (no re-import needed)

---

## Step 1: Source → Vendor DB

**Purpose:** Store raw data with basic cleanup. Each data source gets its own SQLite database that preserves all original columns from the CSV or API.

**Files:**
- `src/lib/services/pipeline-step1-ingest.ts` — CSV ingest for all platforms
- `src/lib/services/square-sync.ts` — Square API sync (follows same pipeline: API → squareup.db → sales.db)

### Cleanup operations:

| Operation | Description |
|-----------|-------------|
| **Dedup** | Remove duplicate records within the same source (overlapping CSV exports, re-imports) |
| **Date normalization** | All dates converted to YYYY-MM-DD (Uber Eats M/D/YYYY, ISO datetimes, etc.) |
| **Amount normalization** | Handle $, commas, parentheses for negatives, string→number |
| **Status filtering** | Flag cancelled/unfulfilled orders vs completed |
| **Fill missing data** | Square API orders automatically fetch item-level detail (names, modifiers, quantities) |

### Vendor databases:

| Database | Table | Records | Source | Dedup Key |
|----------|-------|---------|--------|-----------|
| `squareup.db` | `items` | 23,813 | CSV + API | transaction_id + item + qty + date |
| `squareup.db` | `payouts` | 786 | API | payout_id |
| `squareup.db` | `payout_entries` | 13,749 | API | entry_id |
| `grubhub.db` | `orders` | 390 | CSV | transaction_id |
| `doordash.db` | `detailed_transactions` | 86 | CSV | doordash_order_id |
| `doordash.db` | `payouts` | 13 | CSV | payout_id |
| `ubereats.db` | `orders` | 113 | CSV | order_id |
| `rocketmoney.db` | `transactions` | 2,111 | CSV | date + name + amount |

### Entry points:

| Trigger | Route | Step 1 Target |
|---------|-------|---------------|
| CSV Upload (Settings page) | `POST /api/upload` → parser → `step1Ingest()` | vendor DB for detected platform |
| Square API Sync (Settings page) | `POST /api/square/sync` → `syncSquareFees()` | squareup.db |
| Manual script | `npx tsx scripts/reimport-rocketmoney.ts` | rocketmoney.db |

### Square API sync detail:

The Square API sync follows the full pipeline internally:

```
1. Fetch payments from Square API (cursor-paginated)
2. For each payment, resolve real order_id
3. Batch-retrieve order details (line items, modifiers, tax, dining option)
4. STEP 1: Dedup against squareup.db, write items to squareup.db
5. STEP 2: Read new items from squareup.db, aggregate by transaction_id,
           write normalized orders to sales.db
```

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

### Unified databases:

| Database | Table | Purpose | Powers |
|----------|-------|---------|--------|
| `sales.db` | `orders` | All platform orders, normalized | Sales page |
| `sales.db` | `square_items` | Square item-level detail (raw) | Item drilldown |
| `sales.db` | `grubhub_orders` | GrubHub raw (preserved) | Raw data access |
| `sales.db` | `doordash_orders` | DoorDash raw (preserved) | Raw data access |
| `sales.db` | `ubereats_orders` | Uber Eats raw (preserved) | Raw data access |
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
items             TEXT     "Fruitella Crêpe x1 | Coffee x2" (Square only)
item_count        INTEGER  Number of items in order
modifiers         TEXT     "Fruitella Crêpe: No walnuts" (Square only)
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
```

### Column availability by platform:

| Column | Square | GrubHub | DoorDash | Uber Eats |
|--------|--------|---------|----------|-----------|
| date | ✅ | ✅ | ✅ | ✅ |
| time | ✅ | ✅ | ✅ | ❌ |
| items | ✅ per item | ❌ | ❌ | ❌ |
| modifiers | ✅ | ❌ | ❌ | ❌ |
| tip | ✅ | ✅ | ❌ | ❌ |
| dining_option | ✅ For Here/To Go | ✅ Delivery/Pickup | ✅ Delivery/Storefront | ✅ Delivery |
| customer_name | ✅ | ❌ | ❌ | ✅ |
| payment_method | ✅ Visa/MC/Amex | ❌ | ❌ | ❌ |
| commission_fee | ❌ | ✅ | ✅ | ✅ (marketplace_fee) |
| processing_fee | ✅ | ✅ | ✅ | ❌ |
| delivery_fee | ❌ | ✅ | ❌ | ❌ |
| marketing_fee | ❌ | ❌ | ✅ | ❌ |

### Math verification:

```
net_sales = gross_sales + discounts + tax + tip + fees_total + marketing_total
            + refunds_total + adjustments_total + other_total
```

All platforms verified ✅ (4 DoorDash edge cases with $5 marketing credit discrepancy, 1 Uber Eats first-payout threshold — source data issues, not formula errors).

### Unified `order_items` table schema:

```
── Identifiers ──
order_id          TEXT     Links to orders.order_id
platform          TEXT     square / grubhub / doordash / ubereats
date              TEXT     YYYY-MM-DD
time              TEXT     HH:MM:SS

── Raw from source ──
item_name         TEXT     Raw item name from CSV/API
category          TEXT     Raw category from source
qty               REAL     Quantity ordered
unit_price        REAL     Price per unit
gross_sales       REAL     qty × unit_price
discounts         REAL     Item-level discounts
net_sales         REAL     gross - discounts
modifiers         TEXT     "No walnuts, Banana" (Square only)
event_type        TEXT     Payment / Refund
dining_option     TEXT     For Here / To Go / Delivery / Pickup

── After alias (Step 3) ──
display_name      TEXT     After menu item alias applied
display_category  TEXT     After menu category alias applied
```

**Item detail by platform:**

| Platform | Item detail | What order_items contains |
|----------|-------------|--------------------------|
| Square | ✅ Per item | Individual items with names, qty, price, modifiers, category |
| GrubHub | ❌ Order only | 1 row per order: "GrubHub Order" with order total |
| DoorDash | ❌ Order only | 1 row per order: "DoorDash Order" with order total |
| Uber Eats | ❌ Order only | 1 row per order: "Uber Eats Order" with order total |

---

## Step 3: Apply Aliases

**Purpose:** Apply user-configured alias rules from `categories.db` to the `order_items` table in `sales.db`. Populates `display_name` and `display_category` columns.

**File:** `src/lib/services/pipeline-step3-aliases.ts`

### How it works:

1. Reset all `display_name` to `item_name` and `display_category` to `category`
2. Read `menu_item_aliases` from `categories.db`
3. For each alias, UPDATE matching rows in `order_items` (exact, starts_with, or contains)
4. Read `menu_category_aliases` from `categories.db`
5. For each alias, UPDATE matching rows in `order_items`

### When to re-run:

| Trigger | Action |
|---------|--------|
| New CSV import | Runs automatically as part of ingestion pipeline |
| Square API sync | Runs automatically after sync |
| Alias added/changed in Settings | Should re-run Step 3 only (no re-import) |
| Full rebuild | Re-run Step 2 + Step 3 |

### Configuration databases:

| Database | Table | Records | Purpose |
|----------|-------|---------|---------|
| `categories.db` | `menu_item_aliases` | 46 | "Mushroom Crêpe" → "FunGuy Crêpe" |
| `categories.db` | `menu_item_ignores` | 37 | Items excluded from analytics |
| `categories.db` | `menu_category_aliases` | 8 | "Menu - Sweet Crêpes" → "Sweet Crêpes" |
| `categories.db` | `expense_categories` | 16 | Expense category definitions |
| `categories.db` | `categorization_rules` | 82 | Auto-categorization rules |
| `vendor-aliases.db` | `vendor_aliases` | 42 | Bank vendor name mappings |
| `vendor-aliases.db` | `vendor_ignores` | 9 | Vendors excluded from reports |

### Entry points:

| Function | What it does |
|----------|-------------|
| `step2Unify("grubhub")` | Single platform: read grubhub.db → write to sales.db |
| `step2UnifyAll(rebuild: false)` | All platforms: insert new records only (incremental) |
| `step2UnifyAll(rebuild: true)` | All platforms: wipe sales.db + bank.db, rebuild from scratch |
| `step3ApplyAliases()` | Re-apply all item/category aliases to order_items |

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
      - Insert into unified orders table + order_items table
6. ingestion.ts calls step3ApplyAliases()
   └─ pipeline-step3-aliases.ts:
      - Read menu_item_aliases from categories.db
      - Update order_items.display_name for matching items
      - Read menu_category_aliases from categories.db
      - Update order_items.display_category for matching categories
7. ingestion.ts records import in Prisma (dev.db) for history tracking
7. Sales page shows new orders immediately
```

### Running a Square API sync:

```
1. User clicks "Sync" on Settings page
2. POST /api/square/sync → square-sync.ts
3. square-sync.ts (follows full pipeline internally):
   a. Fetch payments from Square API (cursor-paginated)
   b. For each payment, resolve real order_id
   c. Batch-retrieve order details (line items, modifiers, tax, dining option)
   d. Step 1: Dedup against squareup.db → write new items with full detail
   e. Step 2: Read new items from squareup.db → aggregate by transaction_id
              → write normalized orders to sales.db
4. Sales page shows new orders with full item names and modifiers
```

### Rebuilding unified DBs (after changing cleanup rules):

```
1. Call step2UnifyAll(rebuild: true)
2. Clears sales.db orders + order_items tables
3. Clears bank.db rocketmoney table
4. Re-reads ALL vendor DBs (squareup, grubhub, doordash, ubereats, rocketmoney)
5. Re-applies normalization, schema mapping, summary rollups
6. Call step3ApplyAliases()
7. All pages reflect updated rules
8. No data loss — vendor DBs and config DBs are untouched
```

### Re-applying aliases only (after changing alias rules):

```
1. Call step3ApplyAliases()
2. Resets all display_name/display_category to raw values
3. Re-reads ALL alias rules from categories.db
4. Updates order_items with new display names
5. No re-import needed
```

---

## Database Map

```
/databases/
│
│  ── Source databases (Step 1) ──
│
├── squareup.db        (14.4MB)  Source: Square POS
│   ├── items          (23,813)  Item-level sales (CSV + API)
│   ├── payouts          (786)  Deposit records (API)
│   └── payout_entries (13,749)  Order→deposit links (API)
│
├── grubhub.db          (204KB)  Source: GrubHub
│   └── orders            (390)  Order-level (CSV)
│
├── doordash.db          (56KB)  Source: DoorDash
│   ├── detailed_transactions (86)  Order-level (CSV)
│   └── payouts            (13)  Deposit records (CSV)
│
├── ubereats.db          (24KB)  Source: Uber Eats
│   └── orders            (113)  Order-level (CSV)
│
├── rocketmoney.db      (1.3MB)  Source: Rocket Money
│   └── transactions    (2,111)  Bank activity (CSV)
│
│  ── Unified databases (Step 2) ──
│
├── sales.db           (17MB)    Unified: Sales page
│   ├── orders        (14,994)  All platforms, normalized (financials)
│   ├── order_items   (24,402)  Individual items, all platforms (analytics)
│   ├── square_items  (23,813)  Raw Square detail (preserved)
│   ├── grubhub_orders  (390)  Raw GrubHub (preserved)
│   ├── doordash_orders   (86)  Raw DoorDash (preserved)
│   └── ubereats_orders  (113)  Raw Uber Eats (preserved)
│
├── bank.db             (692KB)  Unified: Bank Activity page
│   ├── rocketmoney    (2,111)  All bank transactions
│   └── chase_statements    (0)  Chase PDF imports (TBD)
│
│  ── Config databases (Step 3 + Settings) ──
│
├── categories.db                User configuration: aliases + categories
│   ├── menu_item_aliases   (46)  "Mushroom Crêpe" → "FunGuy Crêpe"
│   ├── menu_item_ignores   (37)  Items excluded from analytics
│   ├── menu_category_aliases (8)  "Menu - Sweet Crêpes" → "Sweet Crêpes"
│   ├── expense_categories  (16)  Expense category definitions
│   └── categorization_rules (82)  Auto-categorization rules
│
├── vendor-aliases.db            User configuration: vendor mappings
│   ├── vendor_aliases      (42)  Bank vendor name mappings
│   └── vendor_ignores       (9)  Vendors excluded from reports
│
│  ── App database ──
│
└── /dev.db             (1.8MB)  Prisma: import history, settings

/old-databases/                  Backups (not used by app)
└── dev-20260317-153514.db (103MB)  Pre-rebuild backup
```
    ├── imports            (4)  Import history/tracking
    ├── platform_orders  (390)  Prisma-side orders (legacy)
    ├── transactions     (333)  Prisma-side transactions (legacy)
    ├── settings           (0)  App settings
    ├── vendor_aliases     (0)  Vendor name mappings
    ├── menu_item_aliases  (0)  Menu item name mappings
    └── ... (19 tables total, mostly empty — being phased out)
```

---

## Key Files

| File | Purpose | Pipeline Role |
|------|---------|---------------|
| `src/lib/services/ingestion.ts` | CSV upload orchestrator | Calls Step 1 → Step 2 sequentially |
| `src/lib/services/pipeline-step1-ingest.ts` | Step 1: CSV rows → Vendor DB | Dedup, date/amount normalization |
| `src/lib/services/pipeline-step2-unify.ts` | Step 2: Vendor DB → Unified DB | Schema mapping, fee rollups, sign normalization |
| `src/lib/services/square-sync.ts` | Square API sync | Full pipeline: API → squareup.db → sales.db |
| `src/lib/services/square-api.ts` | Square API client | Fetch payments, batch retrieve orders |
| `src/lib/parsers/*.ts` | Platform-specific CSV parsers | Detect file type + parse headers |
| `src/lib/services/dedup.ts` | Deduplication utilities | File hash + row-level dedup |
| `src/app/api/upload/route.ts` | File upload API endpoint | Receives files, triggers ingestion |
| `src/app/api/square/sync/route.ts` | Square sync API endpoint | Triggers API sync |
| `src/app/settings/page.tsx` | Settings page UI | Upload, sync, import history |

### Deprecated files (no longer used in pipeline):

| File | Status |
|------|--------|
| `src/lib/services/sales-db-writer.ts` | Deprecated — was legacy dual-write, replaced by Step 1 + Step 2 |

---

## Data Coverage

| Platform | Date Range | Orders | Source |
|----------|-----------|--------|--------|
| Square | Aug 2023 → present | 14,405 | CSV (to Mar 12) + API (Mar 13+) |
| GrubHub | Oct 2023 → Mar 2026 | 390 | CSV (3 exports) |
| DoorDash | Dec 2025 → Mar 2026 | 86 | CSV (1 export) |
| Uber Eats | May 2025 → Mar 2026 | 113 | CSV (1 export) |
| Rocket Money | May 2023 → Mar 2026 | 2,111 | CSV (bank activity) |

### Known gaps:
- **DoorDash**: Only 3 months of data. Older exports needed.
- **GrubHub**: No payout/deposit data in CSV exports.
- **Uber Eats**: No payout/deposit data in CSV exports.
- **Chase statements**: Not yet imported into bank.db.

---

## Financials Summary (All Time)

| Platform | Gross Sales | Fees | Marketing | Net Sales |
|----------|------------|------|-----------|-----------|
| Square | $211,005 | -$7,323 | $0 | $219,383 |
| GrubHub | $7,670 | -$1,945 | -$717 | $5,702 |
| DoorDash | $2,498 | -$595 | -$434 | $1,636 |
| Uber Eats | $3,103 | -$626 | $0 | $2,213 |
| **TOTAL** | **$224,277** | **-$10,489** | **-$1,151** | **$228,933** |
