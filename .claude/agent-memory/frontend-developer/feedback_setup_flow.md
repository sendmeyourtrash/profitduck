---
name: Setup-flow pattern for zero-state pages
description: When a page has no data yet, show a centered setup card with two entry-point buttons before revealing the full dashboard layout
type: feedback
---

Zero-state pages (e.g. CategoriesPanel with no categories) use a centered card layout with an icon, heading, description, and two action buttons ("Suggest from X" and "Start from Scratch"). After the user makes a choice the card expands or transitions to the main dashboard layout — it never shows the full dashboard immediately on an empty state.

**Why:** Showing an empty two-column dashboard on first visit is confusing. The setup card guides the user to a meaningful first action and avoids rendering skeleton/empty columns.

**How to apply:** Add a `setupMode` boolean state. Gate the main `return (...)` behind `if (setupMode || data.length === 0)` and return the setup card instead. The setup card can expand inline (e.g. showing checkboxes) without a modal.
