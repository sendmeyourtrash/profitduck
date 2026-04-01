---
name: Platform page consolidation
description: /dashboard/platforms was refactored into a unified 6-tab page; analytics sub-page deleted; [platform] is now a redirect
type: project
---

As of 2026-04-01, the platforms section was consolidated:

- `/dashboard/platforms` is now a single unified page with 6 tabs: Overview, By Hour, By Day of Week, Fee Analysis, Daily Trend, Platform Detail. Previously it was just the overview/comparison page.
- `/dashboard/platforms/analytics` was deleted entirely.
- `/dashboard/platforms/[platform]` now redirects to `/dashboard/platforms?platform={platform}` — no page renders at that path.
- New component `src/components/platforms/PlatformDetailTab.tsx` is the self-contained Platform Detail tab.
- New shared component `src/components/orders/ExpandedOrderRow.tsx` is used by both the Platform Detail tab and the sales page (`/sales`).
- Deleted component: `src/components/layout/PlatformNav.tsx` (was the Overview/Analytics sub-nav).

**Why:** Consolidation reduces navigation depth and lets all platform analytics share a single platform filter and date range context.

**How to apply:** When documenting or referencing platform analytics routes, do not refer to /dashboard/platforms/analytics — it no longer exists.
