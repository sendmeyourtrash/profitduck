# Profit Duck Design System

Reference for all visual patterns, tokens, and component classes used across the application. Maintained by the design-language agent.

## Colors

### Brand Palette

| Role | Color | Hex | Tailwind | Usage |
|------|-------|-----|----------|-------|
| Primary | Indigo-600 | #6366f1 | `bg-indigo-600` | Buttons, links, active states, progress fills |
| Primary hover | Indigo-700 | #4338ca | `bg-indigo-700` | Hover states for primary actions |
| Primary subtle | Indigo-50/50 | — | `bg-indigo-50/50` | Expanded/selected backgrounds (light) |
| Primary subtle dark | Indigo-900/10 | — | `bg-indigo-900/10` | Expanded/selected backgrounds (dark) |
| Success | Emerald-600 | #10b981 | `bg-emerald-600` | Positive actions, confirmations, toast success |
| Danger | Red-600 | #dc2626 | `bg-red-600` | Destructive actions, errors, toast error |
| Danger hover | Red-700 | #b91c1c | `bg-red-700` | Hover states for destructive actions |
| Warning | Amber-500 | #f59e0b | `text-amber-500` | Alerts, attention needed, gold rank |
| Neutral | Gray scale | — | `bg-gray-*` | Backgrounds, borders, text |

### Dark Mode Colors

| Element | Class | Hex |
|---------|-------|-----|
| Root background | `bg-slate-950` | #0f172a |
| Card background | `bg-gray-800` | #1e293b |
| Borders | `border-gray-700` | #334155 |
| Primary text | `text-gray-100` | #f1f5f9 |
| Secondary text | `text-gray-400` | #94a3b8 |

## Typography

| Size | Weight | Tailwind | Usage |
|------|--------|----------|-------|
| text-2xl | bold | `text-2xl font-bold` | Major stat displays |
| text-lg | semibold | `text-lg font-semibold` | Section headers |
| text-sm | medium | `text-sm font-medium` | Body text, labels, buttons |
| text-xs | medium | `text-xs font-medium` | Small labels, stats, metadata |
| text-[11px] | medium | `text-[11px] font-medium` | Micro labels, action buttons |
| text-[10px] | medium | `text-[10px] font-medium` | Tiny hints, match types |

### Text Colors

- Primary: `text-gray-900 dark:text-gray-100`
- Secondary: `text-gray-500 dark:text-gray-400`
- Muted: `text-gray-400`

### Rules

- Financial values always use `font-medium` or `font-bold`, never `font-normal`
- Small action buttons use `text-[11px]`, not `text-xs` (they render differently)

## Spacing

| Context | Token | Usage |
|---------|-------|-------|
| Card padding | `p-4` | Internal padding for standard cards |
| Card padding (large) | `p-6` | Hero cards, main content areas |
| Section gaps | `space-y-4` | Vertical spacing between sections |
| Element gaps | `gap-3` | Inline spacing between sibling elements |
| Row padding | `px-4 py-3` | List rows, table rows |
| Column layout | `gap-6` | Between major layout columns |

## Border Radius

| Context | Token |
|---------|-------|
| Page-level cards | `rounded-2xl` |
| Internal cards | `rounded-xl` |
| Buttons (primary) | `rounded-xl` |
| Buttons (small/action) | `rounded-lg` |
| Inputs | `rounded-lg` |
| Pills/badges | `rounded-full` |

**Rule**: Never use `rounded-md` for cards.

## Components

### Cards

```
Standard:
  bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50

With padding:
  bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-4

Large padding:
  bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-6
```

### Buttons

```
Primary:
  px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors

Secondary:
  px-4 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl border border-gray-200 dark:border-gray-700 transition-colors

Small action:
  text-[11px] px-3 py-1 rounded-lg border transition-colors

Danger:
  bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors

Ghost:
  text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors
```

### Inputs

```
Standard:
  border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm
  bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100
  focus:outline-none focus:ring-2 focus:ring-indigo-400/50

Search (full width):
  w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm
  bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100
  focus:outline-none focus:ring-2 focus:ring-indigo-400/50
```

### Pills / Badges

```
Active:
  px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-600 text-white

Inactive:
  px-2.5 py-1 rounded-full text-xs text-gray-500 bg-gray-100 dark:bg-gray-700

Suggestion:
  text-[10px] px-2 py-0.5 rounded-full border
```

### List Rows

```
Container:
  divide-y divide-gray-100 dark:divide-gray-700/50

Row:
  flex items-center px-4 py-3 hover:bg-gray-50/50 dark:hover:bg-gray-700/20 transition-colors

Expanded row:
  bg-gray-50/50 dark:bg-gray-900/20
```

### Sort Header

```
Container:
  flex items-center px-4 py-2 border-b border-gray-100 dark:border-gray-700
  text-[11px] font-medium text-gray-400
  sticky top-0 bg-white dark:bg-gray-800 z-10

Button:
  hover:text-gray-600 transition-colors

Active indicator:
  text-indigo-500
```

### Toast Messages

```
Position:
  fixed top-4 right-4 z-50

Success:
  bg-emerald-600 text-white px-4 py-3 rounded-xl shadow-lg text-sm font-medium

Error:
  bg-red-600 text-white px-4 py-3 rounded-xl shadow-lg text-sm font-medium

Info:
  bg-gray-800 text-white px-4 py-3 rounded-xl shadow-lg text-sm font-medium
```

### Accordion / Expandable

```
Chevron:
  w-3.5 h-3.5 text-gray-400 transition-transform duration-150

Open state:
  rotate-90 (right chevron) or rotate-180 (down chevron)

Expanded background:
  bg-indigo-50/50 dark:bg-indigo-900/10
```

### Progress Indicators

```
Bar container:
  h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden

Bar fill:
  h-full bg-indigo-600 rounded-full transition-all duration-500

Circular:
  Use SVG with stroke-dasharray
```

## Layout Patterns

### Two-Column Split

```
Container:
  flex gap-6 flex-col md:flex-row

Left column:
  md:w-1/2

Right column:
  md:w-1/2
```

### Top-N Overview Cards

```
Container:
  flex gap-3

Card:
  flex-1 bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 px-4 py-3

Rank colors:
  Gold:   text-amber-500 (1st)
  Silver: text-gray-400 (2nd)
  Bronze: text-amber-700 (3rd)
```

## Shared Components (`src/components/ui/`)

| Component | File | Purpose |
|-----------|------|---------|
| ProgressBar | `ProgressBar.tsx` | Animated progress bar with indigo fill |

More components will be extracted as patterns solidify.

## Rules

1. **Never** use `rounded-md` for cards — always `rounded-xl` or `rounded-2xl`
2. **Always** include dark mode classes alongside light mode
3. **Always** add `transition-colors` to interactive elements
4. Use `text-[11px]` for small action buttons, not `text-xs` (they are different)
5. Financial values use `font-medium` or `font-bold`, never `font-normal`
6. Color palette is indigo-centric — do not introduce new brand colors without updating this doc
7. Borders are always semi-transparent in dark mode: `border-gray-700/50` not `border-gray-700`
8. Cards at the page section level use `rounded-2xl`, internal cards use `rounded-xl`
