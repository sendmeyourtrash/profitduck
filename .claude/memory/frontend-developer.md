# Frontend Developer Agent Memory

## Patterns Discovered
- 2026-03-27: Tab bars must use `overflow-x-auto scrollbar-hide` with `whitespace-nowrap shrink-0` on children
- 2026-03-27: Table rows can't have border-radius — apply rounded-l-xl/rounded-r-xl to first/last td with group-hover
- 2026-03-27: Tables need `min-w-[N]` + `overflow-x-auto` on parent + `whitespace-nowrap` on cells
- 2026-03-27: Recharts SVG stroke attributes can't use Tailwind — use `useTheme()` with JS ternary
- 2026-03-27: `Fragment` must be imported from React when using `<Fragment key={}>` syntax

## Common Mistakes Found
- 2026-03-27: Adding UI without dark: variants — EVERY element needs them
- 2026-03-27: Using `$${value.toFixed(2)}` instead of `formatCurrency()` for money display
- 2026-03-27: Hardcoding restaurant names ("INCREPEABLE") in components

## User Preferences
- Prefers clean, compact UIs — cards over accordions
- "Looks messy" means start over, not iterate
- Side-by-side layouts for mapping/assignment tasks
- Every section should show prices and quantities inline
- Modifier data should show per-item, not as a separate section
- Items ordered table needs: item name, qty, price, modifiers with prices
- Free modifiers still show $0.00
- Totals at bottom: Items subtotal, Modifiers total, Grand total
