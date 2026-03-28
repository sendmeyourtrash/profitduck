# Profit Duck - Restaurant Financial Dashboard

A Next.js dashboard for restaurant owners to track sales, expenses, bank activity, and business health across multiple platforms (Square POS, DoorDash, GrubHub, Uber Eats).

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Architecture

- **Framework:** Next.js 16 (App Router, Turbopack)
- **Database:** SQLite via better-sqlite3 (no external DB required)
- **Styling:** Tailwind CSS
- **Charts:** Recharts

All data lives in local SQLite files under `/databases/`. No cloud database, no Docker, no external services required (except Square API for live sales sync).

## Data Sources

| Source | Import Method | Data |
|--------|-------------|------|
| Square POS | API sync (automatic) | Sales, orders, items, fees |
| DoorDash | CSV upload | Orders, fees, payouts |
| GrubHub | CSV upload | Orders, fees, payouts |
| Uber Eats | CSV upload | Orders, fees, payouts |
| Rocket Money | CSV upload | Bank transactions |

## Pages

| Page | URL | Purpose |
|------|-----|---------|
| Overview | `/dashboard` | Revenue, expenses, profit, top items, trends |
| Health Report | `/health-report` | KPIs, projections, seasonality, insights |
| Expenses | `/dashboard/expenses` | Cost breakdown, budget tracking, movers |
| Platforms | `/dashboard/platforms` | Platform comparison, fee analysis |
| Sales | `/sales` | Transaction-level sales with filtering |
| Bank Activity | `/bank` | Bank transactions with vendor aliases |
| Settings | `/settings` | API keys, sync, CSV uploads, aliases |
| Reconciliation | `/reconciliation` | Match sales to bank deposits |

## Key Concepts

### Three-Step Pipeline

All data flows through a 3-step pipeline. See [docs/pipeline.md](./docs/pipeline.md) for details.

```
Step 1: Source -> Vendor DB    (raw data with cleanup)
Step 2: Vendor DB -> Unified DB (normalize to common schema)
Step 3: Apply Aliases           (menu names, categories)
```

### Vendor Aliases

Bank transactions have raw names like "AMZN MKTP US" or "COSTCO WHSE #1062". Vendor aliases map these to clean display names ("Amazon", "Costco") using pattern matching (exact, starts_with, contains).

### Expense Categories

Categorization rules auto-assign bank transactions to expense categories (Rent, Groceries, Payroll, etc.) based on vendor name patterns. Categories can be ignored to exclude them from reports.

### Transaction Renaming

Individual bank transactions can be renamed inline from the Bank Activity page. This sets a `custom_name` field that takes priority over vendor alias resolution.

## Databases

All stored in `/databases/`:

| Database | Purpose |
|----------|---------|
| `sales.db` | Unified sales orders + items (all platforms) |
| `bank.db` | Bank transactions from Rocket Money |
| `categories.db` | Settings, aliases, categories, rules, reconciliation |
| `vendor-aliases.db` | Bank vendor name mappings |
| `squareup.db` | Raw Square API data (Step 1) |
| `grubhub.db` | Raw GrubHub CSV data (Step 1) |
| `doordash.db` | Raw DoorDash CSV data (Step 1) |
| `ubereats.db` | Raw Uber Eats CSV data (Step 1) |

## Environment Variables

```env
SQUARE_ACCESS_TOKEN=   # Square POS API token (also stored in categories.db)
PLAID_CLIENT_ID=       # Plaid bank connection (optional)
PLAID_SECRET=          # Plaid secret (optional)
PLAID_ENV=sandbox      # Plaid environment
```

## Authentication

Set `API_KEY` in `.env` to protect all API routes. When set, requests must include an `x-api-key` header. When unset, all routes are open (local dev mode).

## Documentation

- [docs/architecture.md](./docs/architecture.md) — System architecture, DB schema, API routes
- [docs/pipeline.md](./docs/pipeline.md) — 3-step data pipeline
- [docs/transactions.md](./docs/transactions.md) — Transaction system, dedup, reconciliation
- [docs/agents.md](./docs/agents.md) — 19 Claude Code agents: roles, triggers, execution order
