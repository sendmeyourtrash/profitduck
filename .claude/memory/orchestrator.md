# Orchestrator Agent Memory

## Patterns Discovered
- 2026-03-27: Owner context-switches fast — plan must account for interruptions and re-prioritization
- 2026-03-27: Multi-file changes need a clear execution order — pipeline changes before UI changes
- 2026-03-27: Always verify the previous step works before starting the next one

## User Preferences
- Thinks in systems, not features — will redesign the mental model if it doesn't make sense
- Wants to understand "why" before "how" — explain the data model before showing the code
- Building for scale — everything must work for any restaurant, not just a crêperie
- Dark mode is the primary theme — always test dark first
- Prefers card-based UIs over accordions, side-by-side layouts for mapping tasks
- Gets frustrated when we guess instead of reading documentation
- Values compact, scannable UIs — no visual noise
- Hates silent failures — always surface error messages

## Lessons Learned
- 2026-03-27: Use external-docs-researcher BEFORE building anything that touches external APIs
- 2026-03-27: The Chrome extension debugging wasted an hour because we guessed instead of reading docs
- 2026-03-27: Always run schema-navigator before writing pipeline code — avoids wrong assumptions about columns
