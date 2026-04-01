# Design Language Agent Memory

## Patterns Discovered
- 2026-03-26: Table hover rows use `rounded-xl` (internal card level), table containers use `rounded-2xl` (page-level card)
- 2026-03-26: Table cells need `whitespace-nowrap` and `px-3` padding to prevent data cramping
- 2026-03-26: All page sections should use `space-y-6` on the container for consistent vertical spacing
- 2026-03-26: `dark:bg-gray-800/50` on cards causes bleed-through — always use solid `dark:bg-gray-800`
- 2026-03-26: Table header text: `text-gray-500 dark:text-gray-400` (lightens in dark mode, not the reverse)
- 2026-03-26: Small badges use `text-[11px] font-medium`, not `text-xs`
- 2026-03-26: StatCard had zero dark mode support — retrofitted all variants (success/danger/warning)
- 2026-03-26: StatCard variant dark backgrounds: `/20` opacity bg, `/50` opacity borders
- 2026-03-27: Full dark mode audit reveals BarChartCard and many page-level table cards are completely missing dark: variants

## Common Mistakes Found
- Inverted dark mode text colors (text-gray-400 dark:text-gray-500 is WRONG — should darken the number, not increase it)
- Shared chart components in src/components/charts/ need dark mode too, not just page components
- 2026-04-01: Semantic financial colors (text-emerald-600, text-red-600, text-amber-600) pervasively missing dark variants in receipt cards, fee tables, order rows — always pair with dark:text-{color}-400
- 2026-04-01: Conditional badge ternaries missing dark on all branches — every branch of a color conditional must carry dark: variants
- 2026-04-01: tfoot financial subtotals (Items, Modifiers) missing font-medium — all currency output needs font-medium or font-bold
- 2026-04-01: `dark:border-gray-700` (opaque) found in 4 totals/separator rows in PlatformDetailTab — must always be /50
- 2026-03-27: `bg-white rounded-xl border border-gray-200` on cards with zero dark: counterparts — extremely common in revenue, expenses, health-report, platform detail, and settings pages
- 2026-03-27: `bg-gray-50` table headers (thead) missing `dark:bg-gray-700/50` — affects sales.tsx, bank.tsx
- 2026-03-27: `bg-indigo-50`/`bg-amber-50` callout banners missing all dark: variants — expenses page Biggest Movers, health report Key Insights
- 2026-03-27: `bg-gray-50/80 border-gray-100` expanded rows in sales/bank missing dark: variants
- 2026-03-27: Badge/pill colors (`bg-blue-50 text-blue-700`, `bg-emerald-100 text-emerald-700`, etc.) missing dark: variants — pervasive in sales expanded rows and bank expanded rows
- 2026-03-27: BarChartCard hardcodes `bg-white rounded-xl border border-gray-200` with zero dark mode support — used on every chart page
- 2026-03-27: Analytics page tab bar `bg-gray-100` toggle missing dark: variant — also affects health report compare toggle
- 2026-03-27: Settings page has NO dark: variants anywhere — every card, input, table, tab bar is light-only

## Component Extraction Log
(none yet)
- 2026-03-27: Tab bars and horizontal nav lists use `overflow-x-auto scrollbar-hide` with `whitespace-nowrap shrink-0` on children
- 2026-03-27: `.scrollbar-hide` utility class defined in globals.css — hides scrollbar while keeping scroll functionality
