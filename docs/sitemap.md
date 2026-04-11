<!-- Last updated: 2026-04-11 — Added /tools/mortgage calculator with 7 sub-pages (overview, income, location, transportation, rent-vs-buy, scenarios, amortization). Fully client-side, localStorage-persisted, no API. -->
<!-- Previous: 2026-04-01 — Unified platforms page (6 tabs), removed analytics sub-page, [platform] route is now a redirect, updated shared components -->

> **Auto-maintained**: This file must be updated whenever a new page, route, or API endpoint is added. The documentation-keeper agent is responsible for keeping it current.

# Profit Duck — Site Map

## Pages

### `/` — Root redirect
- **Behavior**: Immediately redirects to `/dashboard`. No content rendered.

---

### `/dashboard` — Dashboard Overview
- **Title**: Dashboard Overview
- **Description**: High-level business summary for the selected date range.
- **Sections**:
  - Stat cards: period revenue (with fee subtotal), net profit, all-time profit margin, average order value
  - Revenue trend chart (daily, via `RevenueChart`)
  - Top sellers: ranked menu items with progress bars and units sold
  - Busiest days: day-of-week revenue bars
  - Top expenses: top 6 expense categories with progress bars
  - Cash flow panel: deposits in, cash out, net cash flow, expense ratio
  - Platform revenue: horizontal bars with order counts and share %
  - Quick snapshot: today, this week, avg daily, total revenue, total expenses, all-time profit
- **API**: `GET /api/dashboard/overview`, `GET /api/dashboard/revenue`
- **Date picker**: Yes

---

### `/dashboard/revenue` — Revenue Analytics
- **Title**: Revenue Analytics
- **Description**: Detailed revenue breakdown by platform and over time.
- **Sections**:
  - Stat cards: total revenue, total orders, average order value
  - Daily revenue line chart
  - Platform pie chart (revenue share)
  - Average order value by platform (bar chart)
  - Revenue by platform table: revenue, orders, avg order, share %
- **API**: `GET /api/dashboard/revenue`
- **Date picker**: Yes

---

### `/dashboard/expenses` — Expense Analytics
- **Title**: Expense Analytics
- **Description**: Expense tracking and analysis with prior-period comparison.
- **Sections**:
  - Biggest movers callout: categories with the largest % change vs prior period (clickable, links to category detail)
  - Stat cards: total expenses, platform fees, combined costs — each with prior-period comparison
  - Monthly pace tracker: spend vs monthly average with projected month-end
  - Fixed vs variable cost split: stacked bar with dollar totals and percentages
  - Largest transactions: top 5 single expense transactions
  - Expenses by vendor bar chart (top 10, clickable — links to vendor detail)
  - Expenses by category bar chart (clickable — links to category detail)
  - Expenses by payment method table
  - Expense trend chart (monthly aggregation)
  - Platform fees breakdown table: commission, service, marketing per platform
  - Top vendors by spending table (clickable rows — links to vendor detail)
- **API**: `GET /api/dashboard/expenses`
- **Date picker**: Yes

---

### `/dashboard/expenses/category/[category]` — Category Expense Detail
- **Title**: `{Category} — Expenses` (dynamic)
- **Description**: Drill-down view for a single expense category.
- **Sections**:
  - Stat cards: total spent, number of transactions, average transaction
  - Stats block: min, max, median
  - Spending frequency label (e.g., "Weekly")
  - Monthly trend chart
  - Vendor breakdown within this category (bar chart)
  - Paginated transaction list: date, vendor, amount, notes, payment method
- **API**: `GET /api/dashboard/expenses/category/[category]`
- **Date picker**: Yes

---

### `/dashboard/expenses/vendor/[vendorName]` — Vendor Expense Detail
- **Title**: `{Vendor} — Expenses` (dynamic)
- **Description**: Drill-down view for a single expense vendor.
- **Sections**:
  - Stat cards: total spent, number of transactions, average transaction
  - Stats block: min, max, median
  - Spending frequency label
  - Monthly trend chart
  - Category breakdown for this vendor (bar chart)
  - Paginated transaction list: date, category, amount, notes, payment method
- **API**: `GET /api/dashboard/expenses/vendor/[vendorName]`
- **Date picker**: Yes

---

### `/dashboard/platforms` — Platform Performance
- **Title**: Platform Performance
- **Description**: Unified platform analytics page combining overview, time-of-day, day-of-week, fee, daily trend, and per-platform detail into a single tabbed view.
- **Shared filter**: Platform filter chips (Square, DoorDash, Uber Eats, Grubhub) — applies across all tabs.
- **Tabs**:
  - **Overview**: Stat cards (most revenue platform, lowest commission platform, total orders); net payout by platform bar chart (with % toggle); commission fees by platform bar chart (with % toggle); platform comparison table (orders, gross revenue, fees, net payout, commission %, avg order, tips)
  - **By Hour**: Stacked bar chart of orders by platform per 15-minute slot; moving average overlay
  - **By Day of Week**: Day-of-week revenue and order count by platform
  - **Fee Analysis**: Fee breakdown by platform (commission, processing, delivery, marketing)
  - **Daily Trend**: Daily revenue trend with linear regression overlay
  - **Platform Detail**: Per-platform deep-dive (stat cards; revenue chart; fee breakdown; order type breakdown; dining options; categories; top items; modifiers; paginated orders table with expandable rows). Platform is selected via the shared platform filter or by navigating from `/dashboard/platforms/[platform]`.
- **Component**: `PlatformDetailTab` (`src/components/platforms/PlatformDetailTab.tsx`) — self-contained component for the Platform Detail tab.
- **Shared component**: Expandable order rows use `ExpandedOrderRow` (`src/components/orders/ExpandedOrderRow.tsx`), also used by the sales page.
- **API**: `GET /api/dashboard/platforms`, `GET /api/dashboard/platforms/[platform]`, `GET /api/analytics`
- **Date picker**: Yes

---

### `/dashboard/platforms/[platform]` — Platform Detail Redirect
- **Valid values**: `square`, `doordash`, `ubereats`, `grubhub`
- **Behavior**: Redirects to `/dashboard/platforms?platform={platform}`. This opens the unified platforms page with the Platform Detail tab active and the specified platform pre-selected.
- **No page content is rendered at this path.**

---

### `/dashboard/menu` — Menu Performance
- **Title**: Menu Performance
- **Description**: Item-level analytics: what sells, in what quantity, and how modifiers contribute.
- **Sections**:
  - Summary stat cards: unique items, total qty sold, total revenue, avg price, modifier revenue
  - Category performance: pie/bar breakdown by menu category
  - Items table: name, category, qty, revenue, avg price, platforms sold on — sortable, expandable rows showing modifier breakdown
  - Modifiers analytics table: modifier name, group, count, paid/free split, avg price, attach rate, top items
  - Cross-platform comparison: items sold on multiple platforms with per-platform qty and revenue
- **Filters**: Category filter, platform filter
- **API**: `GET /api/dashboard/menu`
- **Date picker**: Yes

---

### `/health-report` — Business Health Report
- **Title**: Business Health Report
- **Description**: Executive-level health snapshot with revenue projections, platform performance, menu analytics, and expense breakdown.
- **Sections**:
  - Period label and data-through date
  - Compare mode toggle: Prior Period vs Year-over-Year
  - Key insights panel: auto-generated text bullets
  - Stat cards: revenue, net profit, profit margin, operating cost ratio — each with prior-period change
  - Revenue vs expenses chart with configurable forecast horizon (1m/3m/6m/1y/2y)
  - Income projection panel: trend direction, projected revenue (worst/expected/best scenarios), forecast confidence (R²)
  - Platform performance table: orders, gross revenue, fees, fee rate, net payout, avg net per order
  - Menu performance table: qty, revenue, change vs prior period
  - Expense breakdown table: category, amount, % of revenue, change
- **API**: `GET /api/health-report`
- **Date picker**: Yes (uses `DateRangeContext`)

---

### `/tax` — Tax Center
- **Title**: Tax Center
- **Description**: Sales tax, estimated tax payments, and Schedule C summary for a selected year.
- **Sections**:
  - Year selector
  - Stat cards: total sales tax collected, annual gross revenue, total estimated tax, balance due
  - Upcoming tax deadlines banner
  - Sales tax by quarter table: collected, gross sales, effective rate, due date
  - Sales tax by platform table
  - Monthly tax heatmap
  - Schedule C deductions: line-by-line mapped to expense categories
  - Estimated quarterly tax payments: amount per quarter, due date, status
  - Tax payments made (from bank activity)
- **API**: `GET /api/dashboard/tax`
- **Date picker**: No (uses year selector instead)

---

### `/tools/mortgage` — Mortgage Calculator Overview
- **Title**: Mortgage Calculator
- **Description**: Interactive, fully client-side mortgage + lifestyle cost tool. State persists in localStorage (`profitduck:mortgage-tool:v1`). No database or API involvement — completely isolated from Profit Duck's financial data.
- **Sections**:
  - Headline stat tiles: monthly payment (PITI), loan amount, total interest, total paid
  - Basic inputs card: home price, down payment (dollars + %), loan term, interest rate — values update everything live
  - Monthly payment breakdown card: principal, interest, taxes, insurance, PMI, HOA, upfront cash, tax savings
  - Amortization mini-chart (loan balance vs cumulative interest)
  - Rollup cards for every sub-page with status badges and quick stats
  - Estimated total annual lifestyle cost card (only when income/location/transport are configured)
- **Sub-pages**: Income, Location, Transportation, Rent vs Buy, Scenarios, Amortization
- **Shared state**: `MortgageToolContext` (`src/contexts/MortgageToolContext.tsx`) wraps the layout at `src/app/tools/mortgage/layout.tsx` and persists to localStorage.
- **Shared components**: `FormField`, `SectionCard`, `StatTile`, `SubNav`, `SummaryRow` in `src/components/mortgage/`
- **Math utilities**: `src/lib/utils/mortgage-math.ts`, `src/lib/utils/lifestyle-math.ts`, `src/lib/data/us-states-tax.ts`
- **API**: None (fully client-side)

---

### `/tools/mortgage/income` — Income & Tax
- **Description**: Household income, filing status, federal/state marginal tax rate, itemized deductions, and self-employment extras (home office, business mileage).
- **Sections**: Income form, tax savings result (deductible interest/SALT/other, total itemized vs standard, fed + state savings, SALT cap warning), 28% affordability check, self-employment deductions.

---

### `/tools/mortgage/location` — Location & Property
- **Description**: State preset picker + custom location inputs (property tax, state income tax, sales tax, cost-of-living index, walkability, baseline spending).
- **Sections**: State preset, custom inputs, location impact stats, SALT cap warning (conditional), walkability meter.

---

### `/tools/mortgage/transportation` — Transportation
- **Description**: Transportation mode picker (Own a Car / Public Transit / Rideshare Only / Mixed / Walk or Bike) with mode-specific inputs. Shows monthly + annual cost, per-mile cost, hours-per-year commuting, and optional time-is-money dollarization.
- **Sections**: Mode fieldset (radio cards), commute details, mode inputs, cost breakdown, time cost card with QTFB pre-tax savings.

---

### `/tools/mortgage/rent-vs-buy` — Rent vs Buy
- **Description**: Year-by-year cumulative net cost comparison (buying vs renting) with a break-even line and verdict.
- **Sections**: Assumptions form (rent, inflation, appreciation, investment return, maintenance, selling costs), verdict stat tiles, comparison line chart with break-even reference, year-by-year table, plain-English verdict.

---

### `/tools/mortgage/scenarios` — Scenario Comparison
- **Description**: Build up to 3 named scenarios (each with housing / transportation / taxes / living costs) and compare side-by-side. Includes presets for Rent in City / Buy in City / Buy in Suburb.
- **Sections**: Scenario cards (editable), stacked bar chart comparison, verdict stat tiles (cheapest/most expensive/spread), detail table.

---

### `/tools/mortgage/amortization` — Amortization Schedule
- **Description**: Full year-by-year or month-by-month amortization schedule with extra-principal and biweekly payment controls. Highlights PMI drop-off and interest saved by extras.
- **Sections**: Summary stat tiles (payoff time, total interest, interest saved, PMI drop-off), extras form, scrollable schedule table (year/month toggle).

---

### `/sales` — Sales
- **Title**: Sales
- **Description**: Full paginated order ledger from all platforms.
- **Sections**:
  - Platform summary tabs: per-platform stat cards (orders, gross, tax, tip, net, fees, refunds)
  - Filter bar: platform, date range, search, status, order type, payment method
  - Sortable order table: date, platform, order ID, status, gross sales, tax, tip, net, fees total — expandable rows show order items with modifiers
  - Pagination
- **Shared component**: Expandable order rows use `ExpandedOrderRow` (`src/components/orders/ExpandedOrderRow.tsx`), also used by the Platform Detail tab on `/dashboard/platforms`.
- **API**: `GET /api/transactions`
- **Date picker**: Yes

---

### `/bank` — Bank Activity
- **Title**: Bank Activity
- **Description**: Bank transaction ledger from Rocket Money and Chase imports.
- **Sections**:
  - Summary stat cards: total deposits, total expenses, net
  - Account filter chips
  - Filter bar: accounts, categories, vendors, date range, search
  - Sortable transaction table: date, description, amount, category, account, source — expandable rows with full metadata
  - Pagination
- **API**: `GET /api/bank-activity`
- **Date picker**: Yes

---

### `/menu-aliases` — Menu Aliases
- **Title**: Menu Aliases
- **Description**: Manage how menu item names, categories, and modifiers are mapped and displayed in analytics.
- **Tabs**:
  - **Menu Items**: Map raw/old item names to canonical display names. Includes fuzzy-match suggestions, ignore list.
  - **Categories**: Define menu categories and assign items for analytics grouping. Create/rename/delete categories, bulk-assign items.
  - **Modifiers**: View modifier usage (add-ons). Map modifier names to display names, add to ignore list.
- **API**: `GET/POST/PUT/DELETE /api/menu-item-aliases`, `GET/POST/PUT/DELETE /api/menu-categories`, `GET/POST/PUT/DELETE /api/menu-modifiers`

---

### `/settings` — Import & Settings
- **Title**: Import & Settings
- **Description**: Central settings hub — file import, sync, reconciliation, manual entry, and configuration tabs.
- **Tabs**:
  - **Settings**: Square API token, Square auto-sync toggle, Plaid bank connection (link/disconnect), general app settings, timezone
  - **History**: Paginated import history table — file name, source, date, rows processed/failed/skipped, status
  - **Reconciliation**: Run reconciliation, view reconciliation summary stats and match list, manually link payout groups to bank deposits
  - **Manual Entry**: Form to manually add a bank transaction (date, amount, type, category, description)
  - **Categories**: Expense category management — create/rename/delete categories, categorization rules (keyword → category mapping), ignore list
  - **Vendor Aliases**: Map raw vendor names to clean display names; ignore list for filtering noise vendors
  - **Closed Days**: Mark specific dates as closed (excluded from per-day averages); auto-detect zero-income days
- **API**: `GET/POST /api/settings`, `POST /api/upload`, `GET /api/imports`, `GET /api/sync`, `POST /api/square/sync`, `POST /api/plaid/sync`, `GET /api/reconciliation`, `POST /api/reconciliation/run`, `GET/POST/DELETE /api/expense-categories`, `GET/POST/PUT/DELETE /api/vendor-aliases`, `GET/POST/DELETE /api/categorization-rules`, `GET/POST/DELETE /api/closed-days`, `POST /api/manual-entry`

---

## API Routes

All routes are under `/api/`. Auth: if the `API_KEY` environment variable is set, all routes require the `x-api-key` header. If unset (local dev), routes are open.

### Dashboard & Analytics

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/dashboard/overview` | High-level summary: revenue, fees, expenses, profit, platform breakdown, top items, day-of-week, cash flow. Query: `startDate`, `endDate` |
| `GET` | `/api/dashboard/revenue` | Daily revenue series, platform breakdown, avg order by platform. Query: `startDate`, `endDate` |
| `GET` | `/api/dashboard/expenses` | Full expense analytics: summary, movers, by vendor/category/payment method, fees by platform, cost split, monthly budget pace, top transactions. Query: `startDate`, `endDate` |
| `GET` | `/api/dashboard/expenses/category/[category]` | Single expense category drill-down: stats, trend, vendor breakdown, paginated transactions. Query: `startDate`, `endDate`, `page`, `limit` |
| `GET` | `/api/dashboard/expenses/vendor/[vendorName]` | Single vendor drill-down: stats, trend, category breakdown, paginated transactions. Query: `startDate`, `endDate`, `page`, `limit` |
| `GET` | `/api/dashboard/platforms` | Platform comparison: per-platform stats (orders, revenue, fees, net, commission rate, avg order, tips), daily orders by platform. Query: `startDate`, `endDate` |
| `GET` | `/api/dashboard/platforms/[platform]` | Per-platform detail: stats, fee breakdown, daily revenue, order list with items. Query: `startDate`, `endDate`, `page`, `limit`. Valid platforms: `square`, `doordash`, `ubereats`, `grubhub` |
| `GET` | `/api/dashboard/menu` | Menu performance: summary stats, categories, items with modifiers, modifier analytics, cross-platform comparison. Query: `startDate`, `endDate`, `category`, `platform` |
| `GET` | `/api/dashboard/tax` | Tax center data: sales tax (annual/quarterly/monthly/by platform), Schedule C lines, estimated tax, deadlines, payments made. Query: `year` |
| `GET` | `/api/analytics` | Advanced analytics: hourly order distribution, day-of-week breakdown, fee analysis, daily trend. Query: `startDate`, `endDate`, `platforms[]` |
| `GET` | `/api/health-report` | Business health report with KPIs, revenue projection (linear regression + seasonal indices), platform performance, menu, labor, expenses, insights. Query: `startDate`, `endDate`, `period`, `compare` (`prior`\|`yoy`) |

### Transactions & Bank

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/transactions` | Paginated order ledger from `sales.db`. Query: `platforms[]`, `platform`, `types[]`, `statuses[]`, `categories[]`, `startDate`, `endDate`, `search`, `sortBy`, `sortDir`, `limit`, `offset` |
| `GET` | `/api/bank-activity` | Paginated bank transaction ledger from `bank.db`. Query: `accounts[]`, `categories[]`, `vendors[]`, `startDate`, `endDate`, `search`, `sortBy`, `sortDir`, `limit`, `offset` |
| `PATCH` | `/api/bank-activity` | Update custom name or note on a bank transaction. Body: `{ id, customName?, note? }` |
| `POST` | `/api/manual-entry` | Create a manual bank transaction entry. Body: `{ date, amount, type, category, description }` |

### Import & Upload

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/upload` | Upload a CSV/TSV/XLSX/XLS/PDF file and run the full 3-step pipeline. Form fields: `file`, `platform` (source platform slug), `forceImport` (`"true"` to skip duplicate detection). Returns `{ operationId }` for SSE progress tracking. |
| `GET` | `/api/imports` | Paginated import history from `categories.db`. Query: `limit`, `offset`, `source` |
| `GET` | `/api/data-range` | Min/max dates across all data, available platforms and categories (for filter dropdowns). Reads `sales.db` and `bank.db`. |

### Reconciliation

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/reconciliation` | Reconciliation summary stats, match list, and alerts. |
| `POST` | `/api/reconciliation/run` | Trigger reconciliation engine in background. Returns `{ operationId }` for SSE progress. |
| `POST` | `/api/reconciliation/match` | Manually link a payout match to a bank transaction. Body: `{ matchId, bankTxId, bankDate, bankAmount }` |
| `GET` | `/api/reconciliation/chains` | Get reconciliation chains (grouped payout sequences). |
| `GET` | `/api/reconciliation/alerts` | Get unresolved reconciliation alerts. |

### Settings & Configuration

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/settings` | All app settings (masked — secrets shown as `***`). |
| `POST` | `/api/settings` | Save/update a setting. Body: `{ key, value }`. Handles Square token validation, Plaid credential init, and scheduler start/stop. |
| `DELETE` | `/api/settings` | Delete a setting. Body: `{ key }`. |
| `GET` | `/api/expense-categories` | List all expense categories with transaction counts. Query: `?action=suggest` returns uncategorized vendors with suggestions. |
| `POST` | `/api/expense-categories` | Create a new expense category. |
| `PUT` | `/api/expense-categories` | Update a category name. |
| `DELETE` | `/api/expense-categories` | Delete a category. |
| `GET` | `/api/categorization-rules` | List categorization rules. Query: `?action=suggest` to get uncategorized vendor suggestions. |
| `POST` | `/api/categorization-rules` | Create a rule. Body: `{ pattern, categoryId, matchType }` |
| `PUT` | `/api/categorization-rules` | Update a rule. |
| `DELETE` | `/api/categorization-rules` | Delete a rule. |
| `GET` | `/api/vendor-aliases` | List all vendor aliases and ignore list. |
| `POST` | `/api/vendor-aliases` | Create a vendor alias or add to ignore list. |
| `PUT` | `/api/vendor-aliases` | Update a vendor alias. |
| `DELETE` | `/api/vendor-aliases` | Delete a vendor alias or remove from ignore list. |
| `GET` | `/api/closed-days` | List confirmed closed days. Query: `?detect=true` also returns auto-detected zero-income dates. |
| `POST` | `/api/closed-days` | Add a closed day. Body: `{ date }` |
| `DELETE` | `/api/closed-days` | Remove a closed day. Body: `{ date }` |

### Menu Alias Management

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/menu-item-aliases` | List menu item aliases and ignore list. Query: `?action=suggest` returns fuzzy-match suggestions. |
| `POST` | `/api/menu-item-aliases` | Create an alias or add to ignore list. |
| `PUT` | `/api/menu-item-aliases` | Update an alias. Triggers Step 3 re-apply for affected rows. |
| `DELETE` | `/api/menu-item-aliases` | Delete an alias. |
| `GET` | `/api/menu-categories` | List menu categories with item assignments. Query: `?action=suggest` returns fuzzy-match category suggestions for unassigned items. |
| `POST` | `/api/menu-categories` | Create a category, assign items, or bulk-assign. |
| `PUT` | `/api/menu-categories` | Update a category or item assignment. |
| `DELETE` | `/api/menu-categories` | Delete a category or unassign an item. |
| `GET` | `/api/menu-modifiers` | List modifier usage stats and modifier aliases. Query: `?action=suggest` returns alias suggestions. |
| `POST` | `/api/menu-modifiers` | Create a modifier alias or add to ignore list. |
| `PUT` | `/api/menu-modifiers` | Update a modifier alias. |
| `DELETE` | `/api/menu-modifiers` | Delete a modifier alias. |

### Square Integration

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/square/status` | Square connection status and last sync date. |
| `POST` | `/api/square/sync` | Sync Square payments. Returns `{ operationId }` for SSE progress. Body: `{ startDate?, endDate?, fullSync? }`. `fullSync: true` fetches all history and enriches existing CSV records. |
| `GET` | `/api/square/catalog` | Preview Square catalog sync (dry run — no writes). |
| `POST` | `/api/square/catalog` | Execute Square catalog sync — syncs item names and categories from Square catalog API. Returns `{ operationId }`. |

### Plaid Integration

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/plaid/status` | Plaid connection status and last sync date. |
| `POST` | `/api/plaid/create-link-token` | Create a Plaid Link token to initiate bank connection flow. |
| `POST` | `/api/plaid/exchange-token` | Exchange public token from Plaid Link for an access token. Body: `{ publicToken, accountId }` |
| `POST` | `/api/plaid/sync` | Sync Plaid transactions into `bank.db`. Returns `{ operationId }` for SSE progress. |
| `POST` | `/api/plaid/disconnect` | Disconnect Plaid and clear stored credentials. |

### Sync & Progress

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/sync` | Returns Square sync status: last sync date, auto-sync enabled, scheduler running. |
| `POST` | `/api/sync` | Trigger a Square sync (alias for `/api/square/sync`). |
| `GET` | `/api/progress/[id]` | SSE stream for tracking background operation progress. Polls every 300ms, times out after 5 minutes. Event format: `data: { phase, current, total, message, complete, error }` |

### Extension & Scraper

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/ingest/extension` | Health check endpoint for the Chrome extension popup. |
| `POST` | `/api/ingest/extension` | Receive order data from the Chrome extension. Runs the full 3-step pipeline. Body: `{ platform, orders, source: "extension", extensionVersion? }`. Supports `ubereats`, `doordash`, `grubhub`. CORS-enabled for `chrome-extension://` origins. |
| `POST` | `/api/scrape/ubereats` | Launch Puppeteer-based Uber Eats scraper. Returns SSE stream with progress. Body: `{ startDate?, endDate? }`. Only one scraper can run at a time. |
| `DELETE` | `/api/scrape/ubereats` | Abort the active Uber Eats scraper. |
