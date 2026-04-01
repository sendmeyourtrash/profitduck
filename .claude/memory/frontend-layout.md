# Frontend Layout Agent Memory

## Patterns Discovered
- 2026-03-27: Page sections use `space-y-6` on container for consistent vertical spacing
- 2026-03-27: Page-level cards: `bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-6`
- 2026-03-27: Table hover rows: `group` on tr, `group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30` on each td
- 2026-03-27: First td gets `rounded-l-xl`, last td gets `rounded-r-xl` for hover rounding
- 2026-03-27: `dark:bg-gray-800/50` causes bleed-through — use solid `dark:bg-gray-800`

## User Preferences
- Dark mode is primary — test dark first, then verify light
- Hates wrapping text in tables — everything on one line with scroll
- Hates cramped layouts — needs padding between columns (px-3 minimum)
- Wants consistent rounding — `rounded-2xl` for page cards, `rounded-xl` for internal
