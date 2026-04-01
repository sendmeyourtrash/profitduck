---
name: Common Design System Mistakes
description: Recurring violations found during component audits — use to prioritize review checklist
type: feedback
---

## Semantic color values missing dark variants
`text-emerald-600`, `text-red-600`, `text-amber-600` are used for financial values (net payout, fees, tips, discounts) throughout the codebase but frequently appear without dark counterparts. Always pair:
- `text-emerald-600` → `dark:text-emerald-400`
- `text-red-600` → `dark:text-red-400`
- `text-amber-600` → `dark:text-amber-400`

**Why:** These semantic colors are used in receipt cards, fee tables, and order rows. Without dark variants they render dark-on-dark in dark mode.
**How to apply:** Any time you see a semantic color on a financial value, check for its dark counterpart before committing.

## Opaque dark borders in total/separator rows
Table separator rows (`border-t border-gray-200`) commonly use `dark:border-gray-700` (opaque) instead of the required `dark:border-gray-700/50`. Affects totals rows, section dividers, and header separators.

**Why:** The design system rule is explicit — all dark mode borders must use `/50` opacity.
**How to apply:** Search for `dark:border-gray-700"` (no slash) in any component being reviewed.

## Inverted dark mode text direction
`text-gray-400 dark:text-gray-500` is the wrong direction — it darkens text in dark mode (from 400 to 500), which reduces contrast. The correct secondary pattern is `text-gray-500 dark:text-gray-400`.

**Why:** This was found in ExpandedOrderRow thead and modifier rows (2026-04-01 audit). Previously documented in design-language.md as a known mistake but still appears in new code.
**How to apply:** When you see `dark:text-gray-500`, check whether the light value is lighter (e.g. `text-gray-400`) — that's the wrong direction. Muted items should use bare `text-gray-400` with no dark override.

## Badge dark mode: all three conditional states must have dark variants
When a badge color is determined by a conditional (e.g. fee rate thresholds), all branches must include dark variants, not just one or none. The fee rate badge in PlatformDetailTab (2026-04-01) had zero dark variants across all three states.

**Why:** It's easy to forget that a ternary that sets bg + text color needs `dark:` on every branch.
**How to apply:** When reviewing conditional badge classes, scan every branch of the ternary.

## Table thead dark background: use dark:bg-gray-700/50, not dark:bg-gray-800/50
Thead rows with `bg-gray-50` should pair with `dark:bg-gray-700/50`. Using `dark:bg-gray-800/50` makes the header indistinguishable from the card body, and the `/50` on gray-800 causes bleed-through.

**Why:** Documented 2026-03-26: `dark:bg-gray-800/50` on surfaces causes bleed-through.
**How to apply:** Any `bg-gray-50` thead → `dark:bg-gray-700/50`.

## Financial subtotals in tfoot need font-medium
Currency amounts in table tfoot (Items, Modifiers subtotal rows) sometimes appear without any font weight class. All financial values must use `font-medium` or `font-bold`.

**Why:** Design system rule: financial values always use font-medium or font-bold, never font-normal.
**How to apply:** Scan tfoot cells for currency output — add font-medium if missing.

## Tab bar active buttons: rounded-lg not rounded-md
Main page-level tab bars should use `rounded-lg` on active/inner buttons, not `rounded-md`. The `rounded-md` rule from the system ("never for cards") extends to primary navigation controls.

**Why:** Found in platforms/page.tsx line 238. Inner toggle buttons in micro-controls (granularity pickers) can use rounded-md but main nav tabs should use rounded-lg.
**How to apply:** Check top-level tab bars for rounded-md; replace with rounded-lg.
