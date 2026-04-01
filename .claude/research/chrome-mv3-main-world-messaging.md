# Research Brief: Chrome MV3 — Background to MAIN World Content Script Messaging

**Date:** 2026-03-30
**Trigger:** Debugging failed attempts to send commands from background service worker to MAIN world content script

---

## Context: The Current Architecture

The extension has:
- `content-main.js` — MAIN world content script (manifest-declared), patches `window.fetch`, listens for `window.addEventListener("message", ...)` for `PROFITDUCK_CRAWL` messages, also has a `MutationObserver` on `data-profitduck-crawl` attribute
- `content-bridge.js` — ISOLATED world content script (manifest-declared), has `chrome.runtime.onMessage` listener, relays commands via `window.postMessage`
- `background.js` — Service worker, uses `chrome.debugger` + `Runtime.evaluate` to set DOM attribute, also has a `window.postMessage` path via `chrome.debugger`

---

## What Works

### 1. window.postMessage between MAIN and ISOLATED worlds — YES, it works
This is the documented, correct mechanism. MAIN and ISOLATED worlds share the same DOM but have separate JavaScript execution contexts. `window.postMessage` fires in the shared DOM, so both worlds receive it.

**Official docs example (ISOLATED world listening for MAIN world):**
```javascript
// ISOLATED world (content script)
window.addEventListener("message", (event) => {
  if (event.source !== window) return;  // CRITICAL check
  if (event.data.type === "FROM_PAGE") {
    chrome.runtime.sendMessage(event.data.text);
  }
});
```

**This means the bridge → MAIN path should work:**
- Background sends `chrome.tabs.sendMessage` to bridge (ISOLATED)
- Bridge calls `window.postMessage({ type: "PROFITDUCK_CRAWL", ... }, "*")`
- MAIN world `content-main.js` receives it via `window.addEventListener("message", ...)`

### 2. DOM attribute + MutationObserver — YES, this should work
`chrome.debugger` `Runtime.evaluate` executes in the page's main execution context (the "inspected page" context — equivalent to the MAIN world). `document.documentElement.setAttribute(...)` modifies the shared DOM. A `MutationObserver` in the MAIN world content script watching the same DOM will fire.

**This is already implemented in `content-main.js`** and is the correct fallback approach.

### 3. chrome.scripting.executeScript with world: "MAIN" — YES, shares globals
When a manifest-declared content script runs in `world: "MAIN"` and an `executeScript` call also specifies `world: "MAIN"`, they share the same JavaScript global scope (both operate in the page's global). A function set on `window.__profitduck_start` by `content-main.js` CAN be called by a subsequent `executeScript({ world: "MAIN", func: () => window.__profitduck_start("smart") })`.

### 4. CustomEvent on document — YES, reliable alternative
```javascript
// Sender (ISOLATED or debugger-injected code):
document.dispatchEvent(new CustomEvent("profitduck-crawl", { detail: { command: "smart-sync" } }));

// Receiver (MAIN world):
document.addEventListener("profitduck-crawl", (e) => { startSync(e.detail.command); });
```
Preferred over `window.postMessage` because it avoids collision with the page's own `postMessage` traffic.

---

## What Doesn't Work

### 1. chrome.runtime.onMessage in MAIN world — DOES NOT EXIST
`chrome.runtime` is NOT available in the MAIN world. The `chrome` APIs (including `runtime.onMessage`, `runtime.sendMessage`) are only available in the ISOLATED world. MAIN world content scripts have no `chrome` object by default.

**This means: the background cannot directly message the MAIN world content script.** It must go through the ISOLATED bridge.

### 2. chrome.tabs.sendMessage directly to MAIN world script — NOT POSSIBLE
`chrome.tabs.sendMessage` / `chrome.runtime.onMessage` only work for ISOLATED world scripts. There is no way to target a specific world with `tabs.sendMessage`.

---

## Gotchas That Explain Why the Current Code May Fail

### Critical Gotcha #1: chrome.debugger Runtime.evaluate + window.postMessage — PROBABLY DOESN'T REACH content-main.js
**This is the most likely source of the bug.**

`Runtime.evaluate` executes in the page's main execution context — which IS the same as `world: "MAIN"`. So `window.postMessage` called via `Runtime.evaluate` fires from within the MAIN world. The `window.addEventListener("message")` in `content-main.js` is also in the MAIN world.

**However:** `content-main.js` checks `event.source !== window` at line 325. When `Runtime.evaluate` calls `window.postMessage(...)`, the `event.source` of the resulting MessageEvent may be a different context reference than the `window` object as seen by `content-main.js`. This source-check could be filtering out the message.

**Also:** The `chrome.debugger` approach at line 396 uses `setAttribute` (not `postMessage`), and the MutationObserver path should work for that. The `postMessage` via debugger only appears in the `stop` path (line 424) — which also likely fails for the same source-check reason.

### Critical Gotcha #2: Bridge's chrome.runtime.onMessage may not be firing
In `content-bridge.js`, `chrome.runtime.onMessage.addListener` is the receive path for background → bridge commands (lines 38-69). Check whether the background is actually calling `chrome.tabs.sendMessage` (to the bridge) or only using `chrome.debugger`. Looking at the background code, `triggerSync` at line 356 **only uses `chrome.debugger` — it never calls `chrome.tabs.sendMessage` to the bridge**. The bridge's `onMessage` relay path at lines 38-43 (`PROFITDUCK_RELAY`) is apparently never triggered by the background.

### Gotcha #3: event.source check on postMessage
The official Chrome docs code checks `event.source !== window`. If postMessage is sent from a different context (e.g., a DevTools Runtime.evaluate call, or an iframe), `event.source` will NOT equal `window`, and the handler silently drops the message. This is the #1 reason postMessage appears to "work" (no errors) but the handler never fires.

### Gotcha #4: chrome.debugger setAttribute IS the right approach, but the attribute name differs
- `background.js` sets: `data-profitduck-crawl` (line 396)
- `content-main.js` MutationObserver watches: `data-profitduck-crawl` (line 352)

These match — this path should work. If it's failing, the likely cause is a timing issue: the observer must be set up before the attribute is set. Since `content-main.js` runs at `document_start`, the observer should be ready before any user action triggers the debugger command.

### Gotcha #5: CSP and chrome.scripting.executeScript
Uber Eats' CSP applies to `world: "MAIN"` executeScript calls. If the page has `script-src 'self'` (which many SPAs do), `executeScript` with `world: "MAIN"` may be blocked. **Manifest-declared content scripts are NOT blocked by page CSP** — they are injected by the browser at a privileged level before CSP evaluation.

---

## Recommended Approach: Use the Bridge + CustomEvent

The correct and most reliable architecture for background → MAIN world messaging:

```
Background → chrome.tabs.sendMessage(tabId, msg) → Bridge (ISOLATED)
  → document.dispatchEvent(new CustomEvent("profitduck-crawl", { detail: msg }))
    → MAIN world listener on document
```

**Step 1 — Background calls the bridge:**
```javascript
// background.js
await chrome.tabs.sendMessage(tabId, {
  type: "PROFITDUCK_RELAY",
  crawl: { type: "PROFITDUCK_CRAWL", command: "smart-sync" }
});
```

**Step 2 — Bridge dispatches CustomEvent:**
```javascript
// content-bridge.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PROFITDUCK_RELAY" && message.crawl) {
    document.dispatchEvent(new CustomEvent("profitduck-crawl", {
      detail: message.crawl
    }));
    sendResponse({ ok: true });
  }
});
```

**Step 3 — MAIN world listens on document:**
```javascript
// content-main.js
document.addEventListener("profitduck-crawl", (event) => {
  const cmd = event.detail.command;
  if (cmd === "smart-sync") startSync("smart");
  // ...
});
```

**Why this works:**
- Bridge has `chrome.runtime.onMessage` (ISOLATED world has chrome APIs)
- `document` is shared between MAIN and ISOLATED — CustomEvent crosses the boundary reliably
- No `event.source` check needed (CustomEvent has no `source`)
- Not affected by page's postMessage traffic
- Not affected by CSP (no script injection)
- No `chrome.debugger` needed (no permission concerns, no DevTools warning bar)

---

## What to Fix in the Current Code

The current `background.js` `triggerSync` function uses `chrome.debugger` to set a DOM attribute. This is a valid approach IF:
1. The MutationObserver is set up before the attribute is written (it is, since `document_start`)
2. `chrome.debugger.attach` succeeds (requires `debugger` permission, which is in manifest)
3. The tab isn't already being debugged by DevTools (attaching twice throws)

**If the DOM attribute approach is working for some commands but not others**, suspect the `window.postMessage` path (stop command, line 424) — which has the `event.source` problem.

**The simplest complete fix:** Replace the `chrome.debugger` trigger mechanism entirely with `chrome.tabs.sendMessage` → bridge → `CustomEvent`.

---

## chrome.debugger Runtime.evaluate Context Clarification

`Runtime.evaluate` with no `contextId` specified executes in **the top-level frame of the page's main world** — the same execution context as `world: "MAIN"` content scripts. This means:
- It CAN set DOM attributes that a MAIN world MutationObserver will see
- It CAN call functions defined on `window` by a MAIN world content script
- `window.postMessage` called from it does fire, but `event.source` will not equal `window` as seen by other scripts, so source checks will filter it out

---

## Sources

- [Content Scripts — Chrome for Developers](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Message Passing — Chrome for Developers](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [chrome.scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [chrome.debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger)
- [Chrome DevTools Protocol — Runtime.evaluate](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-evaluate)
- [Manifest — content_scripts world parameter](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)
- [Inject a Global with Web Extensions in MV3 (David Walsh)](https://davidwalsh.name/inject-global-mv3)
- [Solved: How to Inject JavaScript into the Main Page Context](https://sqlpey.com/javascript/solved-how-to-inject-javascript-into-the-main-page-context-from-a-chrome-extension-content-script/)
