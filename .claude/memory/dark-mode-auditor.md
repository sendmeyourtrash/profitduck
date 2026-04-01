# Dark Mode Auditor Agent Memory

## Patterns Discovered
- 2026-03-27: dominant missing pattern is `bg-white rounded-xl border border-gray-200` cards with no dark: variant
- 2026-03-27: dark:bg-gray-800/50 causes bleed-through — always use solid dark:bg-gray-800
- 2026-03-27: Table header text: text-gray-500 dark:text-gray-400 (lightens in dark, NOT the reverse)
- 2026-03-27: Recharts SVG stroke attributes can't use Tailwind — use useTheme() with JS ternary
- 2026-03-27: Small badges use text-[11px] font-medium, not text-xs

## Common Mistakes Found
- 2026-03-27: Inverted dark text (text-gray-400 dark:text-gray-500 is WRONG)
- 2026-03-27: Shared chart components (StatCard, BarChartCard) often missed in dark mode retrofits
- 2026-03-27: Colored badges (bg-emerald-50, bg-red-50) always need dark:bg-*-900/20 variants

## Lessons Learned
- 2026-03-27: Fix shared components FIRST (StatCard, BarChartCard) — they cascade to every page
- 2026-03-27: 8 pages needed full retrofit, ~200+ total fixes in this session
