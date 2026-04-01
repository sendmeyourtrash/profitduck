# UI/UX Reviewer — Learnings

<!-- Append-only. Never delete entries. Max 200 lines — consolidate if approaching. -->

## Patterns
<!-- Recurring UX problems, jargon issues, cognitive overload hotspots -->

- **2026-03-25** Hover-only controls (edit/delete) are a recurring discoverability problem. Edit actions should always be visible; destructive actions may stay hover-only.
- **2026-03-25** Revenue figures are consistently rendered too small (text-[10px] gray) across management panels. For a restaurant owner, revenue is the headline number, not metadata.
- **2026-03-25** Empty right-panel states give no direction. When a two-column layout's right side is empty, users need an explicit prompt like "Select X to see details" not a completion message.
- **2026-03-25** Destructive "reset all" type actions appear without confirmation modals. Delete has a confirm step but bulk-clear actions do not.

## Incidents
<!-- Specific usability issues flagged on specific pages -->

- **2026-03-25** MenuCategoriesPanel: "Reset All" in stats bar calls resetAll() with zero confirmation — single misclick wipes all category mappings with no undo.
- **2026-03-25** MenuCategoriesPanel: bulk-assign API endpoint exists but is never surfaced in UI; "Accept all suggestions" button is a missing quick win.
- **2026-03-25** MenuCategoriesPanel: category color field exists in DB and is auto-assigned at seed time, but no color picker is exposed in the UI. Colors appear only as 2.5px dots.
- **2026-03-25** MenuCategoriesPanel: sortOrder is stored in DB but there is no drag-to-reorder UI; order is creation-order only.
