# Chrome Extension Agent — Learnings

<!-- Append-only. Never delete entries. Max 200 lines — consolidate if approaching. -->

## Patterns
<!-- Recurring issues seen 2+ times -->
- **[2026-03-25]** Manifest V3 world isolation is the #1 source of extension bugs. MAIN and ISOLATED worlds cannot share variables or call each other's functions. DOM attribute polling is the only reliable cross-world communication method.
- **[2026-03-25]** chrome.scripting.executeScript with world:"MAIN" creates a SEPARATE MAIN world instance — it cannot communicate with the content script's MAIN world. Do not use for cross-script communication.
- **[2026-03-25]** CSP on Uber Eats portal blocks inline script injection. Direct fetch() with credentials:"include" works for GraphQL because it inherits the page's cookies.

## Incidents
<!-- One-off findings with date stamps -->
- **[2026-03-25]** Agent created. Extension lives in extension/ folder. Current working platform: Uber Eats. DoorDash and GrubHub portal scraping not yet implemented. Check .claude/research/ for Chrome API research briefs before making changes.
