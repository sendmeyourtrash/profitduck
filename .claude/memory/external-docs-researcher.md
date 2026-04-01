# External Docs Researcher Memory

## Lessons Learned
- Chrome Manifest V3: MAIN and ISOLATED worlds are NOT fully isolated from each other via the DOM — `window.postMessage` and `document.dispatchEvent(CustomEvent)` BOTH cross the boundary. What's isolated is the JavaScript execution context (variables, globals). The DOM itself is shared.
- Chrome Manifest V3: `chrome.runtime.onMessage` does NOT exist in the MAIN world. Only ISOLATED world content scripts have chrome APIs.
- Chrome Manifest V3: `window.postMessage` from Runtime.evaluate may be silently dropped by a content script's `event.source !== window` check — the source is a different context reference.
- Chrome Manifest V3: `chrome.scripting.executeScript` with `world: "MAIN"` IS blocked by page CSP. Manifest-declared content scripts are NOT blocked by page CSP.
- Chrome Manifest V3: `chrome.scripting` is only available in background service workers, NOT in popups.
- Chrome Manifest V3: `Runtime.evaluate` (no contextId) runs in the page's top-level main world — same JS context as `world: "MAIN"` content scripts.
- Chrome Manifest V3: `CustomEvent` dispatched on `document` is the most reliable ISOLATED→MAIN communication method, preferred over `window.postMessage` because it avoids collisions with page postMessage traffic and has no `event.source` concern.
- Chrome Manifest V3: The canonical background→MAIN path is: background → `chrome.tabs.sendMessage` → ISOLATED bridge → `document.dispatchEvent(CustomEvent)` → MAIN world listener.

## Documentation Sources Verified
- Chrome Extensions Manifest V3: https://developer.chrome.com/docs/extensions/develop
- Chrome Extensions content scripts: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Chrome Extensions messaging: https://developer.chrome.com/docs/extensions/develop/concepts/messaging
- Chrome scripting API: https://developer.chrome.com/docs/extensions/reference/api/scripting
- Chrome debugger API: https://developer.chrome.com/docs/extensions/reference/api/debugger
- Chrome DevTools Protocol Runtime: https://chromedevtools.github.io/devtools-protocol/tot/Runtime/
- Square API: https://developer.squareup.com/docs
- Plaid API: https://plaid.com/docs

## Research Briefs Written
- **2026-03-30** Chrome MV3 background→MAIN world messaging: correct patterns, gotchas, why existing attempts fail. Saved to `.claude/research/chrome-mv3-main-world-messaging.md`.
- **2026-04-01** Linear regression trend display: slope × period² gives monthly-total change; projection totals = sum of daily point estimates (closed form: n × (yStart+yEnd)/2). Saved to `.claude/research/linear-regression-trend-display.md`.
