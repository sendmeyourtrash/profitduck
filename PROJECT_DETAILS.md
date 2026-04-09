# Profit Duck — Full Project Details

**Profit Duck** is a financial operations dashboard built for a restaurant/creperie business. It consolidates revenue data from multiple food delivery and payment platforms, reconciles it against bank deposits, and provides analytics, forecasting, and expense management — all in one place.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 16.1.6, React 19.2, TypeScript 5, Tailwind CSS 4, Recharts 3.8 |
| **Backend** | Next.js API Routes (serverless), Prisma ORM 7.5 |
| **Database** | SQLite via libSQL adapter |
| **File Parsing** | xlsx (Excel), CSV/TSV parsers |
| **Integrations** | Square API (POS), Plaid SDK (banking), Rocket Money (CSV import) |

---

## Core Features

### 1. Multi-Platform Data Ingestion

- **6 platform parsers**: Square, Chase, DoorDash, Uber Eats, Grubhub, Rocket Money
- Supports CSV, TSV, XLSX, XLS file formats
- Auto-detects platform from file name/headers with confidence scoring
- SHA256-based file hashing + row-level dedup to prevent duplicate imports
- Real-time progress streaming via Server-Sent Events during uploads

### 2. Three-Level Reconciliation Engine

This is the heart of the app — matching money flow across three levels:

- **L1 (Atomic Events)**: Individual orders/transactions from each platform
- **L2 (Payouts)**: Aggregated payout reports from platforms (e.g., DoorDash weekly payout)
- **L3 (Bank Deposits)**: Actual bank deposits from financial institutions

The engine fuzzy-matches on date, amount, and platform across these levels, tracks variance, and generates alerts for:

- Payout mismatches
- Missing deposits
- Suspected duplicates
- Amount discrepancies

### 3. Financial Analytics & Health Reports

- Period-over-period comparisons (today, week, month — current vs prior or YoY)
- Revenue breakdown by platform, by day, by category
- Expense tracking by vendor and category
- **Linear regression forecasting** for 7-30 day projections
- **Seasonal indices** for trend analysis
- Net profit, fees, expenses, order count metrics

### 4. Data Normalization

- **Vendor Aliases**: Pattern-based matching (contains/starts_with/exact) to normalize messy vendor names
- **Menu Item Aliases**: Tracks renamed items (e.g., "Mushroom Crepe" to "Fun Guy")
- **Menu Category Aliases**: Groups related categories
- **Ignore lists**: Hide irrelevant unmatched items from the UI

### 5. Expense Management & Auto-Categorization

- Categorization rules: vendor match, keyword match, description match — with priority ordering
- Auto-categorization applied during import
- Hit counting to track rule effectiveness
- Parent-child category hierarchy

### 6. Live Integrations

- **Square API**: Fetches payment details, processing fees, card brand, tips, order metadata — with auto-sync scheduler
- **Plaid**: Bank account linking via Link UI, syncs bank transactions automatically — with auto-sync scheduler
- Both support sandbox/development/production environments

### 7. Audit Trail

- Tracks all entity changes (transactions, expenses, payouts, bank transactions)
- Stores old value, new value, reason, and actor (user/system/auto)

---

## Database Schema (17 Tables)

| Table | Purpose |
|-------|---------|
| `Transaction` | Individual platform events |
| `PlatformOrder` | Rich order-level detail (fees, tips, fulfillment type) |
| `Payout` | Platform payout aggregations |
| `BankTransaction` | Bank deposits (Plaid/Rocket Money) |
| `Expense` | Business expenses linked to vendors and categories |
| `Vendor` | Supplier/vendor registry |
| `ExpenseCategory` | Hierarchical category tree |
| `CategorizationRule` | Auto-categorization rules with priority |
| `VendorAlias` | Vendor name normalization patterns |
| `MenuItemAlias` | Menu item name normalization patterns |
| `MenuCategoryAlias` | Menu category normalization patterns |
| `MenuItemIgnore` | Menu item UI suppression list |
| `VendorIgnore` | Vendor UI suppression list |
| `ReconciliationAlert` | Mismatch/anomaly alerts |
| `Import` | File import history with dedup tracking |
| `ClosedDay` | Excluded days from analytics |
| `AuditLog` | Full change history |
| `Setting` | Key-value config store |

---

## API Surface (~40+ Endpoints)

### Dashboard & Analytics (11 routes)

- `GET /api/dashboard/overview` — Summary stats
- `GET /api/dashboard/revenue` — Revenue trends with date filtering
- `GET /api/dashboard/expenses` — Expense breakdown
- `GET /api/dashboard/expenses/category/[category]` — By category
- `GET /api/dashboard/expenses/vendor/[vendorName]` — By vendor
- `GET /api/dashboard/platforms` — Platform summary
- `GET /api/dashboard/platforms/[platform]` — Platform detail
- `GET /api/analytics` — Analytics data
- `GET /api/health-report` — Financial health with forecasting
- `GET /api/data-range` — Available date range
- `GET /api/audit-log` — Change history

### Transactions & Data (5 routes)

- `GET /api/transactions` — List with multi-value filters and search
- `POST /api/upload` — File upload and ingestion (async with progress)
- `GET /api/imports` — Import history
- `POST /api/manual-entry` — Manual transaction entry
- `POST /api/sync` — Trigger all syncs

### Reconciliation (6+ routes)

- `GET /api/reconciliation` — Full reconciliation data
- `POST /api/reconciliation/run` — Run reconciliation engine
- `GET /api/reconciliation/chains` — Reconciliation chains (L1 to L2 to L3)
- `POST /api/reconciliation/match` — Confirm L2/L3 matches
- `GET /api/reconciliation/cleanup` — Data cleanup utilities
- `POST /api/reconciliation/cleanup` — Execute cleanup
- `GET /api/reconciliation/alerts` — Active alerts
- `POST /api/reconciliation/alerts/[alertId]/details` — Alert details

### Categorization (2 routes)

- `GET /api/categorization-rules` — List rules
- `POST /api/categorization-rules` — CRUD operations

### Expense Categories (1 route)

- `GET/POST/PUT/DELETE /api/expense-categories` — Category management

### Aliases & Normalization (4 routes)

- `GET/POST/DELETE /api/vendor-aliases` — Vendor name patterns
- `GET/POST/DELETE /api/menu-item-aliases` — Menu item patterns
- `GET/POST/DELETE /api/menu-category-aliases` — Category patterns

### Square Integration (2 routes)

- `POST /api/square/sync` — Sync fees and orders from Square API
- `GET /api/square/status` — Last sync status

### Plaid Integration (5 routes)

- `POST /api/plaid/create-link-token` — Initiate bank linking
- `POST /api/plaid/exchange-token` — Confirm bank link
- `POST /api/plaid/sync` — Sync bank transactions
- `GET /api/plaid/status` — Sync status
- `POST /api/plaid/disconnect` — Unlink account

### Settings (1 route)

- `GET /api/settings` — Get all settings (masked)
- `POST /api/settings` — Set config value
- `DELETE /api/settings` — Delete config

### Progress (1 route)

- `GET /api/progress/[id]` — Server-sent events stream for long-running operations

---

## Project Structure

```
/profitduck
├── src/
│   ├── app/                    # Next.js App Router pages & API routes
│   │   ├── api/               # 40+ API endpoints
│   │   ├── dashboard/         # Main dashboard page
│   │   ├── transactions/      # Transaction list view
│   │   ├── reconciliation/    # Reconciliation UI
│   │   ├── imports/           # Import history
│   │   ├── settings/          # Configuration UI
│   │   ├── categories/        # Expense category management
│   │   ├── vendor-aliases/    # Vendor name aliases
│   │   ├── manual-entry/      # Manual transaction entry
│   │   ├── health-report/     # Financial health analysis
│   │   └── upload/            # File upload interface
│   ├── components/            # React components
│   │   ├── charts/           # Recharts-based visualizations
│   │   ├── panels/           # Feature panels (reconciliation, categorization)
│   │   ├── layout/           # Header, sidebar, date picker
│   │   ├── filters/          # FilterBar component
│   │   └── ui/               # Reusable UI components
│   ├── contexts/              # React contexts
│   │   ├── DateRangeContext   # Date filtering state
│   │   └── Providers          # Context providers wrapper
│   ├── hooks/                 # Custom React hooks
│   │   └── useProgressStream  # Progress tracking during async operations
│   └── lib/                   # Business logic services
│       ├── db/               # Prisma client setup
│       ├── parsers/          # CSV parsers for 6 platforms
│       ├── services/         # Core business logic
│       │   ├── ingestion.ts          # File import pipeline
│       │   ├── dedup.ts              # Duplicate detection
│       │   ├── reconciliation/       # 3-level reconciliation engine
│       │   ├── categorization/       # Auto-categorization rules
│       │   ├── vendor-aliases.ts     # Vendor name matching
│       │   ├── menu-item-aliases.ts  # Menu item normalization
│       │   ├── plaid-api.ts          # Plaid SDK wrapper
│       │   ├── plaid-sync.ts         # Bank transaction sync
│       │   ├── square-api.ts         # Square API integration
│       │   ├── square-sync.ts        # Square payment sync
│       │   ├── settings.ts           # Persistent config (key-value)
│       │   ├── scheduler.ts          # Background sync scheduler
│       │   ├── progress.ts           # Operation progress tracking
│       │   └── cleanup*.ts           # Data cleanup utilities
│       └── utils/            # Utilities
│           ├── format.ts      # Currency, date, number formatting
│           └── statistics.ts  # Linear regression, seasonal indices
├── prisma/                    # Database schema & migrations
│   ├── schema.prisma         # Complete data model
│   └── migrations/           # Migration history
├── scripts/                   # Database scripts
├── public/                    # Static assets
└── uploads/                   # User file uploads (gitignored)
```

---

## Configuration & Deployment

### Environment Variables

- `DATABASE_URL` — libSQL connection string
- `SQUARE_ACCESS_TOKEN` — Square API token (can also be set via UI)
- `PLAID_CLIENT_ID`, `PLAID_SECRET` — Plaid SDK credentials
- `PLAID_ENV` — sandbox/development/production (defaults to sandbox)
- `NODE_ENV` — development/production

### NPM Scripts

- `npm run dev` — Next.js dev server with HMR
- `npm run build` — Production build
- `npm run start` — Production server
- `npm run lint` — ESLint checking
- `npm run db:migrate` — Create/apply Prisma migrations
- `npm run db:reset` — Wipe and reset database (dev only)
- `npm run db:studio` — Visual database explorer (dev only)

### Deployment

- Vercel-ready (standard Next.js deployment)
- Self-hosted via Node.js with SQLite
- Environment variables for secrets

---

## Authentication & Authorization

**Current State**: No authentication implemented. The project is a single-user personal business tool with all API routes unprotected. Sensitive data (API tokens) are stored in the database `Setting` table.

---

## What's Missing

- No authentication/authorization
- No unit, integration, or E2E tests
- No CI/CD pipeline (no GitHub Actions)
- No Docker/containerization
- API tokens stored in plaintext in the database

---

## Summary

Profit Duck is a sophisticated single-user financial operations tool purpose-built for a restaurant business. It solves the real pain of consolidating revenue from DoorDash, Uber Eats, Grubhub, Square, and bank accounts into one unified view, then reconciling every dollar from order to platform payout to bank deposit. The codebase is well-structured with proper service layer separation, extensive data normalization, and real-time integrations with Square and Plaid.
