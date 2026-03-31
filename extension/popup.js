/**
 * Popup script — Profit Duck extension controls.
 *
 * Sync modes:
 *   - Smart Sync: fetches new orders until hitting known IDs
 *   - Full Re-sync: re-fetches everything
 *   - Date Range: fetches orders within a date range
 */

const $ = (sel) => document.querySelector(sel);

// ---- Elements ----
const statusDot = $("#status-dot");
const statusText = $("#status-text");
const capturedEl = $("#captured-count");
const syncedEl = $("#synced-count");
const queuedEl = $("#queued-count");
const lastSyncEl = $("#last-sync");
const smartSyncBtn = $("#smart-sync-btn");
const fullSyncBtn = $("#full-sync-btn");
const dateSyncBtn = $("#date-sync-btn");
const dateRangePanel = $("#date-range-panel");
const dateFrom = $("#date-from");
const dateTo = $("#date-to");
const dateSyncGo = $("#date-sync-go");
const dateSyncCancel = $("#date-sync-cancel");
const crawlProgress = $("#crawl-progress");
const crawlMessage = $("#crawl-message");
const crawlBar = $("#crawl-bar");
const crawlCount = $("#crawl-count");
const crawlStop = $("#crawl-stop");
const serverUrlInput = $("#server-url");
const apiKeyInput = $("#api-key");
const saveSettingsBtn = $("#save-settings");
const logEl = $("#log");
const pauseBar = $("#pause-bar");
const pauseLabel = $("#pause-label");
const pauseToggle = $("#pause-toggle");
const platformBar = $("#platform-bar");
const platformLabel = $("#platform-label");

// ---- State ----
let syncing = false;
let lastLoggedCrawlMessage = "";

// ---- Pause toggle ----
pauseToggle.addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({ action: "toggle_pause" });
  updatePauseUI(result.paused);
});

// ---- Platform detection ----
let currentPlatform = null;

async function refreshPlatform() {
  try {
    const info = await chrome.runtime.sendMessage({ action: "detect_platform" });
    currentPlatform = info.platform;
    if (info.platform) {
      platformBar.className = `platform-bar platform-${info.platform}`;
      platformLabel.textContent = `${info.label} — ${info.page}`;
      // Enable sync buttons when on supported page
      if (!syncing) enableSyncButtons();
    } else {
      platformBar.className = "platform-bar platform-none";
      platformLabel.textContent = "Not on a supported page";
      if (!syncing) disableSyncButtons();
    }
  } catch {
    currentPlatform = null;
    platformBar.className = "platform-bar platform-none";
    platformLabel.textContent = "Not on a supported page";
  }
}

function updatePauseUI(isPaused) {
  if (isPaused) {
    pauseBar.className = "pause-bar paused";
    pauseLabel.textContent = "Auto-capture paused";
    pauseToggle.textContent = "Resume";
  } else {
    pauseBar.className = "pause-bar active";
    pauseLabel.textContent = "Auto-capture active";
    pauseToggle.textContent = "Pause";
  }
}

// ---- Load settings ----
chrome.storage.local
  .get(["serverUrl", "apiKey"])
  .then((result) => {
    serverUrlInput.value = result.serverUrl || "http://localhost:3000";
    apiKeyInput.value = result.apiKey || "";
  });

// ---- Save settings ----
saveSettingsBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({
    serverUrl: serverUrlInput.value.replace(/\/+$/, ""),
    apiKey: apiKeyInput.value,
  });
  addLog("Settings saved");
  checkConnection();
});

// ---- Sync buttons ----

function disableSyncButtons() {
  syncing = true;
  smartSyncBtn.disabled = true;
  fullSyncBtn.disabled = true;
  dateSyncBtn.disabled = true;
  crawlProgress.style.display = "block";
  crawlBar.style.width = "0%";
  crawlCount.textContent = "";
}

function enableSyncButtons() {
  syncing = false;
  smartSyncBtn.disabled = false;
  fullSyncBtn.disabled = false;
  dateSyncBtn.disabled = false;
  smartSyncBtn.textContent = "Sync New Orders";
}

async function triggerSync(mode, options = {}) {
  if (syncing) return;
  disableSyncButtons();

  const label = mode === "full" ? "Full re-sync" : mode === "date-range" ? "Date range sync" : "Smart sync";
  smartSyncBtn.textContent = `${label}...`;
  crawlMessage.textContent = "Starting...";
  lastLoggedCrawlMessage = ""; // Reset so next completion logs
  addLog(`Starting ${label}...`);

  try {
    await chrome.runtime.sendMessage({
      action: "start_sync",
      mode,
      ...options,
    });
  } catch (err) {
    addLog(`Error: ${err.message}`, "error");
    enableSyncButtons();
  }
}

smartSyncBtn.addEventListener("click", () => triggerSync("smart"));
fullSyncBtn.addEventListener("click", () => triggerSync("full"));

// ---- Date range ----
dateSyncBtn.addEventListener("click", () => {
  dateRangePanel.style.display = dateRangePanel.style.display === "none" ? "block" : "none";
  // Default: last 30 days
  const today = new Date().toISOString().split("T")[0];
  const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
  dateFrom.value = dateFrom.value || thirtyAgo;
  dateTo.value = dateTo.value || today;
});

dateSyncGo.addEventListener("click", () => {
  if (!dateFrom.value || !dateTo.value) {
    addLog("Please select both dates", "error");
    return;
  }
  dateRangePanel.style.display = "none";
  triggerSync("date-range", { startDate: dateFrom.value, endDate: dateTo.value });
});

dateSyncCancel.addEventListener("click", () => {
  dateRangePanel.style.display = "none";
});

// ---- Stop ----
crawlStop.addEventListener("click", async () => {
  try {
    await chrome.runtime.sendMessage({ action: "stop_sync" });
    addLog("Stopping...");
  } catch (err) {
    addLog(`Stop error: ${err.message}`, "error");
  }
});

// ---- Connection check ----
async function checkConnection() {
  try {
    const result = await chrome.runtime.sendMessage({ action: "health_check" });
    if (result.connected) {
      statusDot.className = "dot dot-connected";
      statusText.textContent = `Connected${result.version ? ` v${result.version}` : ""}`;
    } else {
      statusDot.className = "dot dot-disconnected";
      statusText.textContent = "Disconnected";
    }
  } catch {
    statusDot.className = "dot dot-disconnected";
    statusText.textContent = "Disconnected";
  }
}

// ---- Status refresh ----
async function refreshStatus() {
  try {
    const status = await chrome.runtime.sendMessage({ action: "get_status" });
    capturedEl.textContent = status.capturedCount || 0;
    syncedEl.textContent = status.sentCount || 0;
    queuedEl.textContent = status.queueSize || 0;
    updatePauseUI(status.paused);

    if (status.lastSync?.time) {
      const ago = timeAgo(new Date(status.lastSync.time));
      if (status.lastSync.error) {
        lastSyncEl.textContent = `Failed: ${status.lastSync.error}`;
        lastSyncEl.className = "last-sync error";
      } else {
        lastSyncEl.textContent = `${ago} — ${status.lastSync.inserted} new, ${status.lastSync.skipped} skipped`;
        lastSyncEl.className = "last-sync success";
      }
    }

    // Update crawl progress for detected platform only
    const platformKey = currentPlatform === "ubereats" ? "ubereats" : currentPlatform === "doordash" ? "doordash" : null;
    const cs = platformKey && status.crawlStatus ? status.crawlStatus[platformKey] : null;
    if (cs) {
      if (["fetching", "scanning", "throttled", "starting", "syncing"].includes(cs.state)) {
        crawlProgress.style.display = "block";
        crawlMessage.textContent = cs.message || "Working...";
        if (cs.total && cs.current !== undefined) {
          const pct = Math.round((cs.current / cs.total) * 100);
          crawlBar.style.width = `${pct}%`;
          crawlCount.textContent = `${cs.current} / ${cs.total}`;
        }
        if (!syncing) disableSyncButtons();
      } else if (["done", "aborted", "error"].includes(cs.state)) {
        crawlMessage.textContent = cs.message || "Done";
        // Only log once per unique message to avoid spam
        if (cs.message && cs.message !== lastLoggedCrawlMessage) {
          lastLoggedCrawlMessage = cs.message;
          if (cs.state === "done") {
            crawlBar.style.width = "100%";
            addLog(cs.message, "success");
          } else if (cs.state === "error") {
            addLog(cs.message, "error");
          }
        }
        enableSyncButtons();
      }
    }
  } catch {
    // Background not ready yet
  }
}

// ---- Logging ----
function addLog(message, type = "") {
  const entry = document.createElement("div");
  entry.className = `log-entry ${type}`;
  entry.textContent = `${new Date().toLocaleTimeString()} ${message}`;
  logEl.prepend(entry);
  while (logEl.children.length > 20) logEl.removeChild(logEl.lastChild);
}

// ---- Helpers ----
function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ---- Init ----
checkConnection();
refreshStatus();
refreshPlatform();
setInterval(refreshStatus, 2000);
setInterval(refreshPlatform, 2000);
