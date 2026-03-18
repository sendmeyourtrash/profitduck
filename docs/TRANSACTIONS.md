# Transaction System Architecture

This document covers the data model, API routes, page architecture, deduplication strategy, and sync logic for RestDash's financial transaction system.

---

## Table of Contents

1. [Data Model Overview](#data-model-overview)
2. [Three-Level Reconciliation Architecture](#three-level-reconciliation-architecture)
3. [Data Sources & Platforms](#data-sources--platforms)
4. [API Routes](#api-routes)
5. [Page Architecture](#page-architecture)
6. [Deduplication Strategy](#deduplication-strategy)
7. [Import & Sync Flows](#import--sync-flows)
8. [Key Design Decisions](#key-design-decisions)

---

## Data Model Overview

### Core Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `transactions` | L1 atomic financial events | `date`, `amount`, `type`, `sourcePlatform`, `category`, `description`, `rawSourceId` |
| `platform_orders` | Order-level detail from POS/delivery platforms | `orderId`, `platform`, `orderDatetime`, fee breakdown (commission, service, delivery, marketing), `items` |
| `payouts` | L2 aggregated platform payouts | `platform`, `payoutDate`, `grossAmount`, `fees`, `netAmount`, `platformPayoutId` |
| `bank_transactions` | L3 bank statement records | `date`, `amount`, `description`, `accountName`, `accountType`, `institutionName`, `taxDeductible` |
| `expenses` | Operating expenses (parsed from bank data) | `vendorId`, `amount`, `date`, `category`, `paymentMethod` |
| `imports` | Audit trail for all data ingestion | `source`, `fileName`, `fileHash`, `rowsProcessed`, `dateRangeStart`, `dateRangeEnd` |
| `audit_logs` | Change tracking on transactions | `entityType`, `field`, `oldValue`, `newValue`, `actor` |

### Transaction Types

The `type` field on `transactions` classifies each record:

- **`income`** — Revenue from sales (each platform order generates one income transaction)
- **`expense`** — Operating costs (parsed from Rocket Money/Chase bank data)
- **`fee`** — Platform fees recorded as standalone transaction rows (rare; most fee data lives in `platform_orders`)
- **`payout`** — Aggregated deposits from platforms into bank accounts (e.g., Square weekly deposit)
- **`adjustment`** — Refunds, chargebacks, or manual corrections

### Platform Orders vs Transactions

These two tables represent the same sales from different angles:

- **`transactions`** — One row per sale. Flat record with `amount`, `type`, `date`. Used for cross-platform reporting.
- **`platform_orders`** — One row per sale. Rich detail: fee breakdown (commission, service, delivery, marketing), item-level data (Square), dining option, card brand, fulfillment type. Used for fee analysis and per-order drill-down.

They are linked by `rawSourceId` (transaction) matching `orderId` (platform_order) within the same platform.

---

## Three-Level Reconciliation Architecture

RestDash implements a 3-level reconciliation chain to verify money flow from sale to bank deposit:

```
L1: Platform Orders/Transactions
    (individual sales, fees, adjustments)
        ↓ linkedPayoutId
L2: Payouts
    (aggregated deposits from platforms — e.g., Square weekly payout)
        ↓ bankTransactionId
L3: Bank Transactions
    (actual deposits appearing in Chase/bank statements)
```

### Links

- **L1 → L2**: `Transaction.linkedPayoutId` and `PlatformOrder.linkedPayoutId` point to `Payout.id`
- **L2 → L3**: `Payout.bankTransactionId` points to `BankTransaction.id`
- **Reconciliation status** on each record: `unreconciled`, `matched`, `partial`, `mismatch`

### Reconciliation Modules

Located in `src/lib/services/reconciliation/`:

| Module | Purpose |
|--------|---------|
| `l1-l2-matcher.ts` | Match individual transactions/orders to their aggregated payout |
| `l2-l3-matcher.ts` | Match payouts to bank deposits |
| `chain-builder.ts` | Build full L1→L2→L3 reconciliation chains |
| `alert-engine.ts` | Generate alerts for mismatches, missing payouts/deposits |

---

## Data Sources & Platforms

### Sales Platforms

| Platform | Source Key | Import Method | Data Provided |
|----------|-----------|---------------|---------------|
| Square | `square` (CSV), `square-api` (API) | CSV upload + API sync | Orders with items, fees, payment method, dining option |
| DoorDash | `doordash` | CSV upload | Orders with commission, service, delivery fees |
| Uber Eats | `ubereats` | CSV upload | Orders with fees, adjustments |
| Grubhub | `grubhub` | CSV upload | Orders with fees, marketing costs |

### Bank Sources

| Source | Source Key | Import Method | Data Provided |
|--------|-----------|---------------|---------------|
| Rocket Money | `rocketmoney` | CSV upload | Bank transactions with account name, category |
| Chase | `chase` (CSV), `chase-plaid` (Plaid) | CSV upload + Plaid sync | Bank transactions, credit card activity |
| Chase PDF | `chase-pdf` | PDF upload | Parsed bank statements |

### Square Dual-Source Architecture

Square data comes from two complementary sources:

- **CSV export** — Historical bulk data. Uses Square's Transaction ID as `orderId`. Includes item-level detail in `rawData`.
- **API sync** — Recent/ongoing data. Uses Square's Payment ID as `orderId`. Enriches orders with processing fees and payout linkage.

These produce different `orderId` values for the same logical format, but in practice cover non-overlapping time ranges (CSV through the export date, API from recent activity forward). The `@@unique([orderId, platform])` constraint on `platform_orders` ensures no ID collision. See [Deduplication Strategy](#deduplication-strategy) for details.

---

## API Routes

### `GET /api/transactions`

**File:** `src/app/api/transactions/route.ts`

Primary API for the **Sales** page. Returns transactions from all platforms with rich order-level detail.

#### Query Parameters

| Param | Type | Description |
|-------|------|-------------|
| `type` / `types` | string / string[] | Filter by transaction type |
| `excludeTypes` | string[] | Exclude specific types (e.g., `payout` for Sales page) |
| `platform` / `platforms` | string / string[] | Filter by source platform |
| `category` / `categories` | string / string[] | Filter by category |
| `startDate` / `endDate` | string (YYYY-MM-DD) | Date range filter (inclusive) |
| `search` | string | Description substring search |
| `sortBy` | string | Sort column: `date`, `amount`, `type`, `sourcePlatform`, `category`, `description` |
| `sortDir` | `asc` \| `desc` | Sort direction (default: `desc`) |
| `limit` / `offset` | number | Pagination (default: 100/0) |

#### Response Shape

```json
{
  "transactions": [...],     // Enriched with orderDetail (fees, items, payment info)
  "total": 14904,            // Total matching records (for pagination)
  "limit": 100,
  "offset": 0,
  "summary": {               // Aggregated by transaction type
    "income": { "count": 14380, "total": 492000 },
    "fee": { "count": 4, "total": 23 }
  },
  "platformSummary": {       // Aggregated from platform_orders table
    "orderCount": 14382,
    "grossSales": 520000,
    "subtotal": 480000,
    "tax": 25000,
    "tip": 15000,
    "totalFees": 12000,
    "commissionFees": 10715,
    "serviceFees": 344,
    "deliveryFees": 0,
    "customerFees": 0,
    "marketingFees": 937,
    "discounts": 500,
    "refunds": 200,
    "adjustments": 100,
    "netPayout": 508000
  }
}
```

#### Key Logic

1. **Platform order enrichment**: For transactions with a `rawSourceId` from a sales platform, looks up the matching `platform_order` to attach fee breakdown, items, card brand, dining option.
2. **Menu item alias resolution**: Batch-resolves item and category names through alias tables for consistent naming.
3. **Platform summary aggregation**: Runs a separate aggregate query on `platform_orders` (not `transactions`) for accurate fee totals, since most fee data lives in the orders table, not as standalone fee-type transactions.

### `GET /api/bank-activity`

**File:** `src/app/api/bank-activity/route.ts`

API for the **Bank Activity** page. Returns bank-source transactions plus platform payout records.

#### Source Selection Logic

Bank activity combines two categories of transactions using a Prisma OR clause:

```typescript
where.OR = [
  { sourcePlatform: { in: ["rocketmoney", "chase"] } },                          // All bank records
  { sourcePlatform: { in: ["square", "doordash", "ubereats", "grubhub"] }, type: "payout" },  // Platform payouts only
];
```

This ensures platform payout deposits (e.g., "Square Weekly Deposit $3,200") appear alongside bank activity, since they represent actual money arriving in bank accounts.

#### Additional Features

- **Account enrichment**: Joins `bank_transactions` table by `importId + date + amount` to attach `accountName`, `accountType`, `institutionName`, `taxDeductible` to each transaction.
- **Account filter**: Post-enrichment filter by account name (e.g., "BUS COMPLETE CHK", "Chase Ink").
- **Available accounts endpoint**: Returns distinct account names for the filter dropdown.

#### Query Parameters

Same as `/api/transactions` plus:

| Param | Type | Description |
|-------|------|-------------|
| `accounts` / `account` | string[] / string | Filter by bank account name |

---

## Page Architecture

### Sales Page (`/sales`)

**File:** `src/app/sales/page.tsx`

Displays platform sales orders from Square, DoorDash, Uber Eats, and Grubhub.

#### Data Flow

1. Uses `useDateRange()` hook from `DateRangeContext` for global date filtering (header DateRangePicker)
2. Fetches from `/api/transactions` with:
   - `platforms`: square, doordash, ubereats, grubhub
   - `excludeTypes`: payout (payouts shown on Bank Activity instead)
   - `startDate` / `endDate`: from global context
3. FilterBar provides platform, type, category, search filters (with `showDateRange={false}` since dates are in the header)

#### Summary Cards

Uses `platformSummary` from the API (aggregated from `platform_orders`, not transaction-level fee records):

| Card | Source Field | Details |
|------|-------------|---------|
| Gross Sales | `platformSummary.grossSales` | subtotal + tax + tip |
| Platform Fees | `platformSummary.totalFees` | Breakdown: commission, service, delivery, marketing |
| Adjustments | `platformSummary.discounts + refunds + adjustments` | Combined deductions |
| Tax Collected | `platformSummary.tax` | Sales tax |
| Net Payout | `platformSummary.netPayout` | After all fees and adjustments |

#### Expanded Row

Clicking a row reveals:
- **Order detail**: card brand, dining option, channel, fulfillment type
- **Financial summary**: subtotal, tax, tip, fee breakdown, net payout
- **Line items** (Square only): item name, category, quantity, price (with alias resolution)
- **Linked payout**: associated platform payout info
- **Audit log**: recent changes
- **Raw data**: collapsible JSON viewer

### Bank Activity Page (`/bank`)

**File:** `src/app/bank/page.tsx`

Displays bank transactions from Rocket Money and Chase, plus platform payout records.

#### Data Flow

1. Uses `useDateRange()` hook for global date filtering
2. Fetches from `/api/bank-activity`
3. FilterBar with `allowedPlatforms` including all 6 platforms (bank + sales platforms for payout filtering)
4. Account dropdown filter populated from API's `availableAccounts`

#### Summary Cards

| Card | Source |
|------|--------|
| Deposits | `summary.income.total` (positive bank transactions) |
| Expenses | `summary.expense.total` |
| Transfers/Payouts | `summary.payout.total + summary.transfer.total` |
| Net | Sum of all types |

#### Columns

| Column | Description |
|--------|-------------|
| Date | Transaction date |
| Description | Bank description |
| Account | Bank account name (e.g., "Business Checking") |
| Category | Transaction category |
| Type | income, expense, payout, transfer |
| Amount | Positive for deposits, negative for withdrawals |

---

## Deduplication Strategy

Deduplication operates at multiple levels to prevent duplicate records during import and sync.

**File:** `src/lib/services/dedup.ts`

### Level 1: File-Level Dedup

```
SHA256(file contents) → check imports.fileHash
```

Prevents re-importing the exact same file. If a file hash matches a completed import, the upload is rejected immediately.

### Level 2: Row-Level Dedup (Transactions)

```
rawSourceId + sourcePlatform → unique check
```

Each transaction carries a `rawSourceId` (the platform's native ID) and `sourcePlatform`. Before inserting, the system checks for an existing record with the same combination. This is the primary dedup mechanism for platform sales.

**Fallback**: If no `rawSourceId`, falls back to `date + amount + description + sourcePlatform`.

### Level 3: Database Constraints

```sql
@@unique([orderId, platform])  -- on platform_orders
```

The `platform_orders` table has a unique constraint on `(orderId, platform)`. This is the last line of defense against duplicate orders.

### Level 4: Bank Transaction Dedup

Two-phase approach handling cross-source duplicates:

1. **Exact match**: `date + amount + description` — catches same-source re-imports
2. **Cross-source match**: `date (±1 day) + amount + accountName` — catches Chase vs Rocket Money duplicates where descriptions differ but the underlying transaction is the same

### Level 5: Payout Dedup

1. **Primary**: `platformPayoutId + platform + netAmount` — exact match on platform's payout ID
2. **Fallback**: `platform + payoutDate + netAmount` — catches payouts without a platform ID

### Level 6: Expense Dedup

`date (±1 day) + amount + vendorName` — uses a ±1 day window to handle timezone differences between sources.

### Level 7: Overlapping Import Detection

Before processing, checks if any completed import from the same source has an overlapping date range. Warns the user but does not block (row-level dedup handles the actual prevention).

### Square CSV vs API Dedup

Square CSV and API use different ID formats for the same order concept:
- **CSV**: Uses Square Transaction ID (e.g., `7xKy...`)
- **API**: Uses Square Payment ID (e.g., `bB05...`)

Because `platform_orders.@@unique([orderId, platform])` uses these different IDs, a theoretical duplicate could exist if both sources captured the same order. In practice:
- CSV covers historical data through the export date
- API covers recent data from sync onward
- Verified: 9 API orders in the CSV date range were checked and all 9 are genuinely distinct sales (different timestamps and amounts) — zero actual duplicates

---

## Import & Sync Flows

### CSV/File Import

**File:** `src/lib/services/ingestion.ts`

```
Upload → detectSource() → parse() → dedup() → store()
```

1. **Detect source**: Identifies platform from CSV column headers
2. **Parse**: Platform-specific parser extracts structured data
3. **Dedup**: File hash check → overlapping import check → row-level dedup
4. **Store**: Transactional insert of transactions + platform_orders + bank_transactions + expenses
5. **Import record**: Created with status tracking, row counts, date range

### Square API Sync

**File:** `src/lib/services/square-sync.ts`

Two separate sync operations:

#### `syncSquareFees()`
- Fetches payments from Square API
- For each payment, checks if a matching `platform_order` exists (by `orderId`)
- If exists: updates with processing fee data
- If not: creates new `platform_order` + `transaction` (handles orders not in CSV)

#### `syncSquarePayouts()`
- Fetches payout batches from Square API
- For each payout, fetches payout entries (the individual orders in that payout)
- Links `platform_orders` to payouts via `platformPayoutId`
- Creates/updates `payout` records

### Plaid Bank Sync

**File:** `src/lib/services/plaid-sync.ts`

- Cursor-based incremental sync
- Handles added, modified, and removed transactions
- Creates both `bank_transaction` and `transaction` records
- Maintains sync cursor in `settings` table

### Parser Registry

**Directory:** `src/lib/parsers/`

| Parser | File | Key Column Detection |
|--------|------|---------------------|
| Square | `square.ts` | Looks for "Transaction ID", "Net Sales" columns |
| DoorDash | `doordash.ts` | Looks for DoorDash-specific columns |
| Uber Eats | `ubereats.ts` | Looks for Uber Eats columns |
| Grubhub | `grubhub.ts` | Looks for Grubhub columns |
| Rocket Money | `rocketmoney.ts` | Looks for Rocket Money export format |
| Chase | `chase.ts` | Looks for Chase CSV format |
| Chase PDF | `chase-pdf.ts` | Parses Chase PDF bank statements |

---

## Key Design Decisions

### Why payouts are on Bank Activity, not Sales

Platform payouts (e.g., "Square deposits $3,200 into your bank") are fundamentally bank events — they represent money arriving in the business checking account. Showing them on Sales would double-count revenue (the individual orders already represent the income). On Bank Activity, they appear alongside other deposits and can be reconciled against actual bank statements.

The Sales page uses `excludeTypes=payout` to filter them out. The Bank Activity API uses an OR clause to include `type='payout'` records from sales platforms alongside native bank records.

### Why fee data comes from platform_orders, not transactions

The `transactions` table has only 4 records with `type='fee'` (~$23 total). The real fee data (~$12K) lives in `platform_orders` as per-order breakdowns (commission, service, delivery, marketing fees). The Sales page summary cards aggregate from `platform_orders` via the `platformSummary` response field, not from fee-type transactions.

### Why the date picker is in the header

All data pages (Dashboard, Health Report, Sales, Bank Activity) share a global `DateRangeContext`. The date picker in the header (`DateRangePicker` component) controls this context. Individual pages consume dates via `useDateRange()` and pass `showDateRange={false}` to their FilterBar to avoid duplicate date controls.

### Why accounts are filtered post-enrichment in Bank Activity

Account name data lives in `bank_transactions`, not `transactions`. The bank-activity API enriches transactions by joining on `importId + date + amount`, then applies the account filter on the enriched results. This is necessary because platform payout transactions don't have a corresponding `bank_transaction` record — they're linked via the reconciliation chain instead.
