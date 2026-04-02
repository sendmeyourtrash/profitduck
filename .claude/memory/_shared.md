# Shared Rules — All Agents

## Financial Math
- NEVER use JavaScript floating point for money. Use integer cents or explicit decimal handling.
- Always round to 2 decimal places when displaying currency.
- Store money as REAL in SQLite but compute in cents in application code.

## Dedup Safety
- SHA256 hash-based deduplication. NEVER change hash fields without understanding reimport consequences.
- Dedup keys: order_id + platform + date for sales, transaction_id + date for bank.

## SQL Safety
- ALWAYS use parameterized queries with ?. NEVER interpolate user input.
- Use db.transaction() for multi-record writes.
- You CANNOT join across databases. Query each separately and join in application code.

## Platform Names
- Always lowercase, hyphenated: doordash, uber-eats, grubhub, square, chase, rocket-money

## No Hardcoding
- NEVER hardcode restaurant-specific data (menu items, categories, junk filter lists).
- The system must work for any restaurant, not just a creperie.

## Dark Mode
- EVERY UI element must have dark: variants. No exceptions.

## Date Handling
- Always use DateRangeContext. NEVER create parallel date state.

## Error Handling
- NEVER fail silently. Always surface error messages to the user.
- Show toast notifications for errors, not just console.log.

## Pipeline
- NEVER re-run step3ApplyAliases() for single-record changes. Update directly.
- Pipeline: CSV/API -> Parser -> Step 1 (vendor DB) -> Step 2 (unified DB) -> Step 3 (aliases)

## Lessons Learned
- Chrome extension MAIN and ISOLATED worlds share the DOM but have separate JS contexts. `window.postMessage` and `document.dispatchEvent(CustomEvent)` DO cross the boundary. What doesn't cross: JS variables, globals, chrome APIs (chrome.runtime only in ISOLATED).
- `window.postMessage` from `chrome.debugger Runtime.evaluate` will be silently dropped if receiver checks `event.source !== window` — the source context reference won't match.
- Best background→MAIN pattern: background → `chrome.tabs.sendMessage` → ISOLATED bridge → `document.dispatchEvent(new CustomEvent(...))` → MAIN world `document.addEventListener`.
- Square's raw category field is mostly junk (sizes, options). Don't rely on it for real categories.
- Users define categories and map items into them. Categories are NOT derived from Square.

## Destructive Operations — ABSOLUTE RULES
- NEVER run `git init` on an existing repo. If git is broken, tell the user and stop.
- NEVER use `mv` to restructure project files. Use `cp` + verify + delete, or a git worktree.
- NEVER delete lockfiles (package-lock.json, yarn.lock).
- NEVER run `rm -rf` on project directories.
- NEVER write to production databases without explicit user permission. Back up first: `cp file.db file.db.bak`
- NEVER attempt cascading fixes when something breaks. Stop, explain what happened, and ask the user.
- NEVER start a dev server or run code to "smoke test" against production databases. Test against copies only.
- If another Claude instance is active in the same directory, use a git worktree or don't make changes.
- These rules exist because on 2026-04-01 all of the above were violated and destroyed the user's categories.db configuration data.

## Work Discipline
- NEVER context-switch mid-implementation. Finish the current task, verify it works, THEN move on.
- If the user sends a new message while you're working, finish what you're doing first. Tell the user "Let me finish this first" and complete the current task with verification before addressing their message.
- EVERY feature must be verified before moving on: screenshot, SQL query, or API test proving it works.
- If a task has multiple steps, verify each step before proceeding to the next.
- The user will stop you with the stop button or explicitly tell you to stop if they need you to pivot. Do not self-interrupt.
