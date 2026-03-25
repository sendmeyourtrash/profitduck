# Architecture

## Database Layer

### Unified Databases (what the app reads from)

**sales.db** — All platform sales data normalized to a common schema.
- `orders` table: date, time, platform, order_id, gross_sales, tax, fees_total, net_sales, tip, discounts, dining_option, customer_name, payment_method, commission_fee, processing_fee, delivery_fee, marketing_fee, fees_total, marketing_total, refunds_total
- `order_items` table: order_id, platform, item_name, display_name, category, display_category, qty, gross_sales, event_type
- Populated by Step 2 of the pipeline from vendor databases

**bank.db** — Bank transactions from Rocket Money exports.
- `rocketmoney` table: date, name, custom_name, description, category, amount, account_name, note
- `chase_statements` table: reserved for Chase PDF imports

**categories.db** — All user configuration and settings.
- `settings` — Key-value store (API tokens, sync timestamps, business config)
- `menu_item_aliases` — Sales item name mappings (pattern, match_type, display_name)
- `menu_item_ignores` — Items excluded from analytics
- `menu_category_aliases` — Category name mappings
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
| grubhub.db | CSV | orders |
| doordash.db | CSV | detailed_transactions, payouts |
| ubereats.db | CSV | orders |
| rocketmoney.db | CSV | transactions |

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
CRUD for all configuration tables in categories.db and vendor-aliases.db. Exports functions for every config entity (aliases, categories, rules, settings, imports, reconciliation).

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
| GET | /api/dashboard/platforms/[platform] | sales.db | Single platform drilldown |
| GET | /api/health-report | sales.db, bank.db | KPIs, projections, seasonality, menu performance, insights |

### Sales & Analytics

| Method | Route | Source DBs | Purpose |
|--------|-------|-----------|---------|
| GET | /api/transactions | sales.db | Paginated sales with filtering |
| GET | /api/analytics | sales.db | Item-level analytics |
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
| POST | /api/square/sync | Square API sync (3-step pipeline) |
| GET | /api/square/sync | Last sync timestamp |
| GET | /api/square/status | Square API connection status |
| POST | /api/square/status | Update Square API token |
| GET | /api/imports | Import history |

### Configuration

| Method | Route | Purpose |
|--------|-------|---------|
| GET/POST/DELETE | /api/settings | Key-value settings CRUD |
| GET/POST/PATCH | /api/vendor-aliases | Bank vendor name mappings |
| GET/POST/PATCH | /api/menu-item-aliases | Sales item name mappings |
| GET/POST/PATCH | /api/menu-category-aliases | Category name mappings |
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
| square-api.ts | Square API client (payments, orders, batch retrieval) |
| pipeline-step1-ingest.ts | CSV -> vendor DB (parsing, cleanup, dedup) |
| pipeline-step2-unify.ts | Vendor DB -> unified DB (schema normalization, fee rollups) |
| pipeline-step3-aliases.ts | Apply menu item + category aliases to order_items |
| ingestion.ts | CSV upload orchestrator (hash dedup, platform detection, full pipeline) |
| settings.ts | Settings CRUD wrapper with convenience helpers |
| progress.ts | In-memory operation progress tracking for async operations |
| plaid-api.ts | Plaid API client |
| plaid-sync.ts | Plaid bank data sync |

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
