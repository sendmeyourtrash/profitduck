---
name: Design system card radius rule
description: Page-level section cards must use rounded-2xl, not rounded-xl; rounded-xl is for internal/nested cards only
type: feedback
---

Always use `rounded-2xl` for top-level section cards on a page (fee breakdown, order type table, orders list, etc.). `rounded-xl` is reserved for cards nested *inside* another card.

**Why:** The design system doc explicitly states: "Page-level cards: rounded-2xl, Internal cards: rounded-xl". Using rounded-xl at the page level is a recurring mistake that violates the design system.

**How to apply:** Any `div` that is a direct child of a page's main content area and wraps a section (with `p-6`, a heading, and content) gets `rounded-2xl`. Only use `rounded-xl` when the card sits inside another card's padding.
