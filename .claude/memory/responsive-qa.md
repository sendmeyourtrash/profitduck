# Responsive QA Agent Memory

## Known Responsive Issues
- Sidebar is w-64 (256px), hidden below lg (1024px), replaced by top bar with hamburger menu
- Main content has min-w-0 and overflow-x-hidden to prevent horizontal scroll

## Breakpoint Reference
- < 1024px: Top bar navigation (hamburger menu)
- >= 1024px: Sidebar navigation (w-64)
- Tailwind breakpoints: sm=640, md=768, lg=1024, xl=1280, 2xl=1536

## Pages Verified
- 2026-03-27: platforms/page.tsx — comparison table needs min-w-[700px] and overflow-x-auto

## Common Fixes Applied
- 2026-03-27: Tables need min-w-[N] + overflow-x-auto on parent + whitespace-nowrap on cells
- 2026-03-27: Tab bars need overflow-x-auto scrollbar-hide with whitespace-nowrap shrink-0 on children
- 2026-03-27: Header spacer (h-14) must be inside main content column, not sibling to sidebar
