# Profit Duck

Restaurant financial dashboard — tracks sales, expenses, bank activity, and business health across Square POS, DoorDash, GrubHub, Uber Eats, and bank feeds (Rocket Money, Chase).

## Tech Stack

- **Framework**: Next.js 16.1.6 (App Router, Turbopack)
- **Language**: TypeScript 5 (strict mode)
- **Database**: SQLite via better-sqlite3 — NO Prisma, NO ORM
- **Styling**: Tailwind CSS 4 with full dark mode
- **Charts**: Recharts 3.8
- **State**: React Context (DateRangeContext, ThemeContext)
- **Integrations**: Square POS API, Plaid (bank connection)

## Multi-Database Architecture

All databases in `databases/`. No single schema file — schemas defined in DB modules and pipeline code.

| Database | Purpose | DB Module |
|----------|---------|-----------|
| `sales.db` | Unified sales (`orders`, `order_items`) | `src/lib/db/sales-db.ts` |
| `bank.db` | Bank transactions (`rocketmoney`, `chase_statements`) | `src/lib/db/bank-db.ts` |
| `categories.db` | Config: aliases, rules, settings, imports, reconciliation | `src/lib/db/config-db.ts` |
| `vendor-aliases.db` | Vendor name mappings | `src/lib/db/config-db.ts` |
| `squareup.db`, `grubhub.db`, `doordash.db`, `ubereats.db`, `rocketmoney.db` | Raw vendor source data | Pipeline Step 1 |

**Critical**: You CANNOT join across databases. Query each separately and join in application code.

## 3-Step Data Pipeline

```
CSV/API → Parser → Step 1 (vendor DB) → Step 2 (unified DB) → Step 3 (apply aliases)
```

- `src/lib/services/pipeline-step1-ingest.ts` — Raw data → vendor source DB
- `src/lib/services/pipeline-step2-unify.ts` — Vendor DB → sales.db / bank.db
- `src/lib/services/pipeline-step3-aliases.ts` — Apply menu/category aliases
- `src/lib/services/ingestion.ts` — Orchestrator (Step 1 → 2 → 3)

## Key Conventions

- **Money math**: Never use JS floats for financial calculations. Use integers (cents) or explicit decimal handling.
- **SQL safety**: Always parameterized queries with `?` — never interpolate user input.
- **Atomic writes**: Use `db.transaction()` for multi-record writes.
- **Dedup**: SHA256 hash-based. Never change hash fields without understanding reimport consequences.
- **API routes**: All logic in services (`src/lib/services/`), never in route handlers.
- **Platform names**: Lowercase, hyphenated: `doordash`, `uber-eats`, `grubhub`, `square`, `chase`, `rocket-money`
- **Date filtering**: Always use DateRangeContext — never create parallel date state.
- **Auth**: API_KEY env var. When set, all /api/ routes require `x-api-key` header. Unset = open (local dev).

## Parsers

7 parsers in `src/lib/parsers/`: square, chase (CSV), chase-pdf (PDF), doordash, ubereats, grubhub, rocketmoney.

## Tests

Run with: `npx vitest` or `npx vitest run`

## Common Commands

```bash
npm run dev                              # Start dev server
npx vitest                               # Run tests (watch mode)
npx vitest run                           # Run tests (single pass)
npx tsx scripts/rebuild-pipeline.ts      # Rebuild sales.db + bank.db from vendor DBs
npx tsx scripts/reimport-all.ts          # Reimport everything from vendor DBs
npx tsx scripts/seed-categories.ts       # Seed default expense categories
```

## Documentation

All docs in `docs/`:
- `docs/architecture.md` — System architecture, DB schema, API routes, services
- `docs/pipeline.md` — 3-step data pipeline detail
- `docs/transactions.md` — Transaction system, dedup, reconciliation
- `docs/agents.md` — 19 Claude Code agents: roles, triggers, execution order
