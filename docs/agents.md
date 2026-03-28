<!-- Last updated: 2026-03-26 — Full agent documentation for 25 agents -->

# Agent System

Profit Duck uses 25 Claude Code agents organized as a structured development team. Agents are defined in `.claude/agents/` and are automatically triggered based on task context.

## How It Works

1. **Orchestrator runs first** on any multi-step task — it reads the codebase, maps scope, and produces an execution plan with the agents needed in order.
2. **Specialist agents** execute the plan — each owns a domain (backend, frontend, parsers, etc.).
3. **Review agents** run after coding — code-reviewer, security-auditor, and ui-ux-reviewer catch issues before shipping.
4. **Documentation-keeper** runs last to update docs.

## Agent Roster

### Orchestration & Planning

| Agent | Model | Role | Access |
|-------|-------|------|--------|
| **orchestrator** | Opus | Plans multi-step tasks, identifies agents needed, produces execution plan for approval | Read-only |

**When to use**: Before any multi-step task, new feature, bug fix, or change touching multiple files. Always runs first — no code is written until the plan is approved.

---

### Core Development

| Agent | Model | Role | Access |
|-------|-------|------|--------|
| **backend-developer** | Sonnet | API routes, services, ingestion pipeline, data processing | Read + Write |
| **frontend-developer** | Sonnet | Pages, components, charts, layouts, dark mode | Read + Write |
| **api-route-generator** | Sonnet | Scaffolds new API endpoints from scratch | Read + Write |

**backend-developer triggers**: Any work in `src/app/api/` or `src/lib/services/`. Knows all 40+ API routes, SSE patterns, better-sqlite3 conventions.

**frontend-developer triggers**: Any visual/UI work. Knows Tailwind 4, React 19, Recharts 3.8, DateRangeContext, ThemeContext.

**api-route-generator triggers**: When a net-new endpoint is needed. Generates production-ready routes matching existing patterns.

---

### Database & Schema

| Agent | Model | Role | Access |
|-------|-------|------|--------|
| **schema-navigator** | Sonnet | Explores and explains the multi-database data model | Read-only |
| **database-specialist** | Opus | Complex SQL queries, aggregation, optimization | Read + Write |
| **migration-writer** | Sonnet | Safe SQL schema changes (ALTER TABLE, CREATE INDEX) | Read + Write |

**Dependency chain**: schema-navigator (understand) → migration-writer (change schema) → database-specialist (write queries)

**schema-navigator** should run before any DB work to avoid wrong assumptions about which database a table lives in.

**migration-writer** writes idempotent migration scripts in `scripts/`. All changes must be additive — never drop columns on production financial data.

---

### Data & Parsers

| Agent | Model | Role | Access |
|-------|-------|------|--------|
| **parser-developer** | Sonnet | Builds/fixes CSV/XLSX/PDF parsers for 7 platforms | Read + Write |
| **parser-qa** | Sonnet | Verifies parser correctness, edge cases, confidence scoring | Read-only |
| **pipeline-debugger** | Sonnet | Traces data through the 3-step pipeline to find issues | Read-only |

**parser-developer** knows all 7 parsers: Square, Chase CSV, Chase PDF, DoorDash, Uber Eats, Grubhub, Rocket Money.

**parser-qa** runs after any parser change — verifies column mapping, amount handling, date normalization, and dedup hash correctness.

**pipeline-debugger** traces data from CSV upload → parser → Step 1 (vendor DB) → Step 2 (unified DB) → Step 3 (aliases). Use when imported data looks wrong, amounts don't match, or transactions are missing.

---

### Integrations

| Agent | Model | Role | Access |
|-------|-------|------|--------|
| **integration-specialist** | Sonnet | Square POS and Plaid bank sync, auth, scheduler | Read + Write |
| **chart-analytics-builder** | Sonnet | Recharts visualizations, statistics, forecasting | Read + Write |

**integration-specialist triggers**: Anything touching Square API, Plaid SDK, sync errors, scheduler issues, sandbox/production switching.

**chart-analytics-builder triggers**: Any chart, graph, or visualization work. Owns all Recharts components and `statistics.ts`.

---

### Review & Quality

| Agent | Model | Role | Access |
|-------|-------|------|--------|
| **code-reviewer** | Opus | Reviews changes for standards, financial math, SQL safety | Read-only |
| **security-auditor** | Opus | Audits for SQL injection, token exposure, file upload security | Read-only |
| **ui-ux-reviewer** | Opus | Critiques UX from a restaurant owner's perspective | Read-only |
| **reconciliation-debugger** | Sonnet | Explains reconciliation engine, traces match failures | Read-only |
| **responsive-qa** | Sonnet | Responsive design QA — verifies all pages render correctly at every viewport | Read + Write |

**code-reviewer** runs after every coding task. Enforces: parameterized queries, money math correctness, atomic writes, no token leakage.

**security-auditor** runs before shipping features. Checks SQL injection, token exposure in API responses/logs, file upload validation, input sanitization.

**ui-ux-reviewer** thinks like a non-technical restaurant owner. Flags jargon, cognitive overload, buried critical info, unclear flows.

**reconciliation-debugger** traces L1 (orders) → L2 (payouts) → L3 (bank deposits) matching logic. Explains why matches succeed or fail.

**responsive-qa** runs after any frontend-developer, design-language, or chart-analytics-builder agent completes work. Checks all modified components for horizontal overflow, grid collapse correctness, touch target sizing, hardcoded widths, missing `min-w-0`, and Recharts `ResponsiveContainer` usage across five viewport breakpoints (375px, 768px, 1024px, 1280px, 1440px+).

---

### Research

| Agent | Model | Role | Access |
|-------|-------|------|--------|
| **external-docs-researcher** | Sonnet | Reads official docs before code is written to prevent wasted effort from incorrect assumptions | Read-only |

**external-docs-researcher triggers**: Before ANY code that interacts with an external system, API, SDK, library, or platform. Trigger for Chrome Extensions, Square API, Plaid API, Uber Eats, DoorDash, GrubHub, Recharts, Tailwind, Next.js app router, better-sqlite3. Also trigger when another agent hits unexpected behavior ("this should work but doesn't"), when the user says "read the docs" or "check the documentation", or after 2+ failed attempts at the same approach. Saves research briefs to `.claude/research/` for other agents to reference.

---

### Testing & Maintenance

| Agent | Model | Role | Access |
|-------|-------|------|--------|
| **test-writer** | Sonnet | Unit/integration tests for parsers, services, financial math | Read + Write |
| **script-runner** | Sonnet | Runs maintenance scripts (rebuild, reimport, seed) | Read + Execute |
| **documentation-keeper** | Sonnet | Updates all project documentation | Read + Write |

**test-writer** prioritizes: parser correctness > financial math > dedup logic > pipeline steps > API routes. Uses vitest with in-memory SQLite for DB tests.

**script-runner** knows all 12+ scripts in `scripts/`, when to use each, and the correct execution order. Always backs up databases before destructive operations.

**documentation-keeper** runs after any significant change. Owns README, `docs/architecture.md`, `docs/pipeline.md`, `docs/transactions.md`, `docs/agents.md`, API reference, and inline JSDoc.

---

### Performance & Optimization

| Agent | Model | Role | Access |
|-------|-------|------|--------|
| **performance-agent** | Sonnet | Profiles slow operations, audits queries, catches unnecessary pipeline reruns | Read + Write |

**performance-agent triggers**: Any report of slowness, lag, or delay. After backend-developer or database-specialist writes queries touching 10K+ rows. When Step 3 re-runs the full pipeline unnecessarily. Keywords: "slow", "delay", "optimize", "lagging", "takes too long", "make this faster".

Catches: full pipeline reruns on single alias changes, `SELECT *` when 2 columns suffice, missing indexes, N+1 queries, synchronous heavy computation, no pagination on large datasets. Flags any user-facing operation >500ms or background task >2s.

---

### Chrome Extension

| Agent | Model | Role | Access |
|-------|-------|------|--------|
| **chrome-extension-agent** | Sonnet | Owns all code in extension/, delivery platform scraping, data capture | Read + Write |

**chrome-extension-agent triggers**: Any work in the `extension/` folder. Mentions of Uber Eats/DoorDash/GrubHub scraping, popup, content scripts, background workers, or portal data capture. Keywords: "extension", "capture", "sync from portal", "crawl", "fix the extension".

Knows: Manifest V3 MAIN/ISOLATED world isolation, GraphQL capture pattern, React fiber extraction, auto-crawl system, DOM attribute polling for cross-world communication. Reads `.claude/research/` briefs before making changes.

---

### Data Validation

| Agent | Model | Role | Access |
|-------|-------|------|--------|
| **data-integrity-agent** | Sonnet | Validates financial data correctness, completeness, and consistency across all databases | Read + Write |

**data-integrity-agent triggers**: After any pipeline run, import, sync, parser change, or schema migration. Keywords: "numbers don't match", "data missing", "duplicates", "orphaned records", "totals are wrong", "verify the data". Runs automatically after script-runner, pipeline-debugger, or integration-specialist completes work.

Checks: cross-database consistency (vendor DB totals vs sales.db), orphan detection, duplicate detection, financial math validation, missing data, dedup hash integrity, pipeline completeness, date range gaps.

---

## Execution Order

For a typical feature, agents run in this order:

```
1. orchestrator                — Plan the work, identify agents needed
2. external-docs-researcher    — Research external APIs/libraries BEFORE coding (if external systems involved)
3. schema-navigator            — Understand the data model (if DB involved)
4. migration-writer            — Schema changes (if needed)
5. backend-developer           — API routes and services
   api-route-generator         — New endpoints (if needed)
   parser-developer            — Parser work (if needed)
   chrome-extension-agent      — Extension work (if extension/ involved)
6. frontend-developer          — UI components and pages
   chart-analytics-builder     — Charts (if needed)
   responsive-qa               — Responsive QA (after any UI change)
7. performance-agent           — Profile and optimize (if slowness reported or large dataset queries written)
8. data-integrity-agent        — Validate data after pipeline/import/sync operations
9. test-writer                 — Write tests
10. code-reviewer              — Review all changes
    security-auditor           — Security audit
11. ui-ux-reviewer             — UX review (if frontend changed)
12. documentation-keeper       — Update docs
```

Not every feature needs every agent. The orchestrator determines which subset is needed.

## Model Allocation

| Model | Agents | Rationale |
|-------|--------|-----------|
| **Opus** | orchestrator, database-specialist, code-reviewer, security-auditor, ui-ux-reviewer | Planning, complex queries, and review tasks need the strongest reasoning |
| **Sonnet** | All other 20 agents | Implementation tasks where speed matters more than deep analysis |

## Color Legend

Each agent has a unique color for visual identification in the IDE:

| Color | Agent |
|-------|-------|
| Gold | orchestrator |
| Green | backend-developer |
| Cyan | frontend-developer |
| Teal | api-route-generator |
| Blue | schema-navigator |
| Indigo | database-specialist |
| Lime | migration-writer |
| Purple | parser-developer |
| Yellow | parser-qa |
| Sky | pipeline-debugger |
| Amber | integration-specialist |
| Rose | chart-analytics-builder |
| Orange | code-reviewer |
| Slate | security-auditor |
| Pink | ui-ux-reviewer |
| Red | reconciliation-debugger |
| Emerald | test-writer |
| Stone | script-runner |
| Violet | documentation-keeper |
| Fuchsia | responsive-qa |
| Cyan | external-docs-researcher |
| Orange | performance-agent |
| Amber | chrome-extension-agent |
| Red | data-integrity-agent |

## Self-Improvement System

Agents learn from past runs via a file-based memory system in `.claude/memory/`.

### How It Works

1. **At the start** of each run, the agent reads its memory file (e.g., `.claude/memory/code-reviewer.md`) and the shared file (`.claude/memory/_shared.md`)
2. **During work**, the agent uses past learnings to prioritize checks and avoid known pitfalls
3. **At the end**, the agent appends new findings to its memory file — recurring patterns or one-off incidents with date stamps
4. **Cross-agent learnings** go into `_shared.md` when a finding applies to multiple agents

### Memory File Structure

```
.claude/memory/
├── _shared.md              # Cross-agent learnings any agent can read
├── code-reviewer.md        # Bug patterns, code smells found repeatedly
├── security-auditor.md     # Vulnerability classes, systematic gaps
├── orchestrator.md         # Plan failures, scope misses
├── parser-developer.md     # Platform CSV quirks, edge cases
├── parser-qa.md            # Common parser failure modes
├── frontend-developer.md   # Tailwind 4 / Recharts / React 19 quirks
├── backend-developer.md    # SQLite/better-sqlite3 gotchas
├── ui-ux-reviewer.md       # Recurring UX problems
├── pipeline-debugger.md    # Pipeline failure patterns by step
├── migration-writer.md     # SQLite ALTER TABLE pitfalls
├── responsive-qa.md        # Responsive layout issues and breakpoint findings
├── external-docs-researcher.md # API/library gotchas, doc sources verified, research briefs written
├── performance-agent.md    # Performance bottlenecks, optimization patterns, before/after metrics
├── chrome-extension-agent.md # Manifest V3 gotchas, world isolation bugs, platform-specific quirks
└── data-integrity-agent.md # Data consistency issues, common orphan/duplicate patterns, pipeline gaps
```

Other agents create memory files on demand when they have something to record.

### Entry Format

```markdown
## Patterns
- **[2026-03-25]** Float math in fee calculations causes rounding errors in dashboard totals.
  Always use ROUND() in SQL aggregations for display values.

## Incidents
- **[2026-03-25]** DoorDash changed CSV headers in Q1 2026 — "Subtotal" became "Order Subtotal".
```

### Guardrails

- **Append-only**: Entries are never deleted, only added
- **No duplicates**: Agents check if a pattern is already recorded before adding
- **200-line cap**: Agents consolidate older entries when approaching the limit
- **Skip if empty**: No entry is written if nothing new was learned

### Periodic Maintenance

Every few months, review memory files and consolidate old Incidents into Patterns. Delete redundant entries. This is a manual housekeeping task.

## Key Principles

- **Schema first**: If a schema change is needed, migration-writer runs before any service code.
- **Financial data is high stakes**: Any change touching amounts, dedup, or reconciliation gets flagged as HIGH RISK.
- **Know your databases**: Always identify which `.db` file(s) are affected. Cross-database joins must happen in application code.
- **Review before shipping**: code-reviewer and security-auditor run after every coding task, not just when asked.
- **Plan before executing**: The orchestrator exists to prevent wasted work. Five minutes of planning prevents hours of rework.
- **Learn from past runs**: Agents read their memory files at the start and record new findings at the end.
