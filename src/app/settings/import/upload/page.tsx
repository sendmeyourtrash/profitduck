"use client";

import { useState, useCallback, useEffect } from "react";
import { ProgressBar, type ProgressState } from "@/components/ui/ProgressBar";
import { useProgressStream } from "@/hooks/useProgressStream";

/* ── Types ─────────────────────────────────────────────────────── */

interface ImportRecord {
  id: string;
  source: string;
  fileName: string;
  importedAt: string;
  rowsProcessed: number;
  rowsFailed: number;
  rowsSkipped: number;
  status: string;
  errorMessage: string | null;
}

type SourcePlatform =
  | "square"
  | "chase"
  | "doordash"
  | "ubereats"
  | "grubhub"
  | "rocketmoney"
  | "";

interface ImportResult {
  import: {
    id: string;
    source: string;
    fileName: string;
    rowsProcessed: number;
    rowsFailed: number;
    status: string;
  };
  summary: {
    source: string;
    rowsProcessed: number;
    transactions: number;
    platformOrders: number;
    bankTransactions: number;
    expenses: number;
    payouts: number;
    errors: string[];
    rowsSkipped: number;
  };
  overlappingImports?:
    | { id: string; fileName: string; importedAt: string }[]
    | null;
}

interface DuplicateInfo {
  duplicate: true;
  existingFileName: string;
  importedAt: string;
  message: string;
}

interface SyncResult {
  totalPayments: number;
  newOrders: number;
  skippedDuplicates: number;
  enrichedOrders: number;
  errors: number;
}

interface SyncHistory {
  id: string;
  source: string;
  fileName: string;
  status: string;
  rowsProcessed: number;
  importedAt: string;
}

const PLATFORMS: { value: SourcePlatform; label: string }[] = [
  { value: "", label: "Auto-detect" },
  { value: "square", label: "SquareUp" },
  { value: "chase", label: "Chase Bank" },
  { value: "doordash", label: "DoorDash" },
  { value: "ubereats", label: "Uber Eats" },
  { value: "grubhub", label: "Grubhub" },
  { value: "rocketmoney", label: "Rocket Money" },
];

const PLATFORM_CARDS = [
  { key: "doordash", name: "DoorDash", color: "bg-red-50 border-red-200", icon: "🔴", portal: "https://merchant-portal.doordash.com" },
  { key: "ubereats", name: "Uber Eats", color: "bg-green-50 border-green-200", icon: "🟢", portal: "https://merchants.ubereats.com" },
  { key: "grubhub", name: "Grubhub", color: "bg-orange-50 border-orange-200", icon: "🟠", portal: "https://restaurant.grubhub.com" },
];

const SUPPORTED_FORMATS = [
  { name: "SquareUp", desc: "Transaction CSV export from Square Dashboard" },
  { name: "Chase Bank", desc: "Transaction CSV or PDF statement from Chase online banking" },
  { name: "DoorDash", desc: "Order or payout report from Merchant Portal" },
  { name: "Uber Eats", desc: "Order or payment CSV from Uber Eats Manager" },
  { name: "Grubhub", desc: "Order report from Grubhub for Restaurants" },
  { name: "Rocket Money", desc: "Transaction export from Rocket Money" },
];

/* ── Component ─────────────────────────────────────────────────── */

export default function UploadPage() {
  // CSV import state
  const [file, setFile] = useState<File | null>(null);
  const [platform, setPlatform] = useState<SourcePlatform>("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<ProgressState | null>(null);
  const [uploadOpId, setUploadOpId] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(null);

  // Square token state
  const [squareConfigured, setSquareConfigured] = useState<boolean | null>(null);
  const [squareMerchant, setSquareMerchant] = useState<string | null>(null);
  const [maskedToken, setMaskedToken] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenSaving, setTokenSaving] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<ProgressState | null>(null);
  const [syncOpId, setSyncOpId] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  // Auto-sync
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [schedulerRunning, setSchedulerRunning] = useState(false);

  // History
  const [syncHistory, setSyncHistory] = useState<SyncHistory[]>([]);

  // Extension status
  const [extensionStatus, setExtensionStatus] = useState<{
    connected: boolean;
    lastSync?: string;
    inserted?: number;
    skipped?: number;
  } | null>(null);


  /* ── SSE progress streams ─────────────────────────────────────── */

  useProgressStream(
    uploadOpId,
    (progress) => setUploadProgress(progress),
    (progress) => {
      setUploading(false);
      setUploadProgress(null);
      setUploadOpId(null);
      if (progress.error) {
        setUploadError(progress.error);
      } else if (progress.result) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = progress.result as any;
        if (data.duplicate) {
          setDuplicateInfo(data as DuplicateInfo);
        } else {
          setImportResult(data as ImportResult);
          setDuplicateInfo(null);
        }
      }
    }
  );

  useProgressStream(
    syncOpId,
    (progress) => setSyncProgress(progress),
    (progress) => {
      setSyncing(false);
      setSyncProgress(null);
      setSyncOpId(null);
      if (progress.error) {
        setSyncError(progress.error);
      } else if (progress.result) {
        setSyncResult(progress.result as SyncResult);
        setLastSyncAt(new Date().toISOString());
        loadSyncHistory();
      }
    }
  );

  /* ── Data loading ─────────────────────────────────────────────── */

  useEffect(() => {
    loadSettings();
    loadSyncStatus();
    loadSyncHistory();
    loadExtensionStatus();
  }, []);

  async function loadExtensionStatus() {
    try {
      const res = await fetch("/api/ingest/extension");
      if (res.ok) {
        const data = await res.json();
        setExtensionStatus({ connected: true, ...data });
      }
    } catch {
      setExtensionStatus({ connected: false });
    }
    // Also check last extension import
    try {
      const res = await fetch("/api/imports?source=ubereats-extension&limit=1");
      const data = await res.json();
      if (data.imports?.length > 0) {
        const last = data.imports[0];
        setExtensionStatus((prev) => ({
          ...prev,
          connected: prev?.connected ?? false,
          lastSync: last.importedAt,
          inserted: last.rowsProcessed,
        }));
      }
    } catch { /* ignore */ }
  }

  async function loadSettings() {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      setSquareConfigured(data.squareConfigured);
      setSchedulerRunning(data.schedulerRunning);
      if (data.settings?.square_api_token) {
        setMaskedToken(data.settings.square_api_token);
      }
      setAutoSyncEnabled(data.settings?.auto_sync_enabled === "true");
    } catch {
      // ignore
    }
  }

  async function loadSyncStatus() {
    try {
      const res = await fetch("/api/sync");
      const data = await res.json();
      setLastSyncAt(data.lastSyncAt);
      if (data.squareConfigured !== undefined) setSquareConfigured(data.squareConfigured);
      if (data.syncing) setSyncing(true);
    } catch {
      // ignore
    }
  }

  async function loadSyncHistory() {
    try {
      const res = await fetch("/api/imports?source=square-api&limit=5");
      const data = await res.json();
      setSyncHistory(data.imports || []);
    } catch {
      // ignore
    }
  }

  /* ── CSV import handlers ──────────────────────────────────────── */

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setImportResult(null);
    setUploadError(null);
    setDuplicateInfo(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const doUpload = async (forceImport = false) => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    setImportResult(null);
    setUploadProgress(null);
    if (!forceImport) setDuplicateInfo(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (platform) formData.append("platform", platform);
      if (forceImport) formData.append("forceImport", "true");

      const response = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await response.json();

      if (!response.ok) {
        setUploadError(data.error || "Upload failed");
        setUploading(false);
      } else if (data.operationId) {
        setUploadOpId(data.operationId);
      }
    } catch {
      setUploadError("Network error. Please try again.");
      setUploading(false);
    }
  };

  const resetUpload = () => {
    setFile(null);
    setPlatform("");
    setImportResult(null);
    setUploadError(null);
    setDuplicateInfo(null);
    setUploadProgress(null);
    setUploadOpId(null);
  };

  /* ── Square connection handlers ───────────────────────────────── */

  async function connectSquare() {
    if (!tokenInput.trim()) return;
    setTokenSaving(true);
    setTokenError(null);

    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "square_api_token", value: tokenInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTokenError(data.error || "Failed to validate token");
        return;
      }
      setSquareConfigured(true);
      setSquareMerchant(data.merchantName || null);
      setMaskedToken(tokenInput.trim().slice(0, 4) + "••••••••" + tokenInput.trim().slice(-4));
      setTokenInput("");
    } catch {
      setTokenError("Network error. Please try again.");
    } finally {
      setTokenSaving(false);
    }
  }

  async function disconnectSquare() {
    try {
      await fetch("/api/settings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "square_api_token" }),
      });
      setSquareConfigured(false);
      setSquareMerchant(null);
      setMaskedToken(null);
    } catch {
      // ignore
    }
  }

  /* ── Sync handlers ────────────────────────────────────────────── */

  async function triggerSync() {
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);

    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setSyncError(data.error || "Sync failed");
        setSyncing(false);
        return;
      }
      setSyncOpId(data.operationId);
    } catch {
      setSyncError("Network error. Please try again.");
      setSyncing(false);
    }
  }

  async function toggleAutoSync() {
    const newValue = !autoSyncEnabled;
    setAutoSyncEnabled(newValue);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "auto_sync_enabled", value: String(newValue) }),
      });
      const data = await res.json();
      setSchedulerRunning(data.schedulerRunning ?? newValue);
    } catch {
      setAutoSyncEnabled(!newValue);
    }
  }

  /* ── Render ───────────────────────────────────────────────────── */

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      {/* ═══════════════════════════════════════════════════════════
          CARD 1 — Platform Connections & Sync
          ═══════════════════════════════════════════════════════════ */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-6 space-y-5">
        {/* Header with Sync All */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Platform Connections</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Connect platform APIs to sync data automatically</p>
          </div>
          <button
            onClick={triggerSync}
            disabled={!squareConfigured || syncing}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium whitespace-nowrap"
          >
            {syncing ? (
              <span className="flex items-center gap-1.5">
                <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-white" />
                Syncing...
              </span>
            ) : "Sync All"}
          </button>
        </div>

        {/* ── Square ─────────────────────────────────────────────── */}
        <div className="border border-blue-200 dark:border-blue-800/50 bg-blue-50/50 dark:bg-blue-900/10 rounded-lg p-4 space-y-3">
          {/* Connection header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">🔵</span>
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Square</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Sync processing fees via Square Payments API</p>
              </div>
            </div>
            {squareConfigured !== null && (
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${
                  squareConfigured ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400" : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${squareConfigured ? "bg-emerald-500" : "bg-gray-400"}`} />
                  {squareConfigured ? squareMerchant || "Connected" : "Not configured"}
                </span>
                {squareConfigured && (
                  <button onClick={disconnectSquare} className="text-xs text-gray-400 hover:text-red-500 transition-colors" title="Disconnect Square">
                    &#10005;
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Token input (when not configured) */}
          {squareConfigured === false && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => { setTokenInput(e.target.value); setTokenError(null); }}
                  placeholder="Paste your Square access token"
                  className={`flex-1 border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 ${
                    tokenError ? "border-red-300 dark:border-red-600" : "border-gray-300 dark:border-gray-600"
                  }`}
                  onKeyDown={(e) => { if (e.key === "Enter") connectSquare(); }}
                />
                <button
                  onClick={connectSquare}
                  disabled={tokenSaving || !tokenInput.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium whitespace-nowrap"
                >
                  {tokenSaving ? (
                    <span className="flex items-center gap-1.5">
                      <span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" />
                      Validating...
                    </span>
                  ) : "Connect"}
                </button>
              </div>
              {tokenError && <p className="text-xs text-red-600">{tokenError}</p>}
              <p className="text-xs text-gray-400">
                Get your production token from{" "}
                <span className="text-indigo-600">developer.squareup.com/apps</span>
                {" "}&mdash; stored securely in the local database
              </p>
            </div>
          )}

          {/* Masked token */}
          {squareConfigured && maskedToken && (
            <p className="text-xs text-gray-400 font-mono">{maskedToken}</p>
          )}

          {/* ── Sync controls (inline, when connected) ──────────── */}
          {squareConfigured && (
            <div className="border-t border-blue-200/60 dark:border-blue-800/40 pt-3 space-y-3">
              {/* Auto-sync toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-700 dark:text-gray-300">Auto-sync daily</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    Sync every 24 hours while the app is running
                    {schedulerRunning && <span className="ml-1 text-emerald-600">&bull; Active</span>}
                  </p>
                </div>
                <button
                  onClick={toggleAutoSync}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    autoSyncEnabled ? "bg-indigo-600" : "bg-gray-300"
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    autoSyncEnabled ? "translate-x-6" : "translate-x-1"
                  }`} />
                </button>
              </div>

              {/* Last sync info */}
              {lastSyncAt && !syncing && !syncResult && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Last sync: {new Date(lastSyncAt).toLocaleString()} &mdash; next sync will fetch only new data
                </p>
              )}

              {/* Sync progress bar */}
              {syncing && (
                <ProgressBar
                  progress={syncProgress ?? { phase: "starting", current: 0, total: 0, message: "Starting sync...", done: false }}
                  color="blue"
                />
              )}

              {/* Sync button */}
              {!syncing && !syncResult && (
                <button
                  onClick={triggerSync}
                  disabled={syncing}
                  className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                >
                  {lastSyncAt ? "Sync New Data" : "Sync Now"}
                </button>
              )}

              {/* Sync error */}
              {syncError && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-lg p-3">
                  <p className="text-sm text-red-700 dark:text-red-400">{syncError}</p>
                </div>
              )}

              {/* Sync results */}
              {syncResult && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-600">&#10003;</span>
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Sync Complete</p>
                    </div>
                    <button
                      onClick={() => { setSyncResult(null); setSyncError(null); }}
                      className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-white/80 dark:bg-gray-700/50 rounded-lg p-2.5">
                      <p className="text-xs text-gray-500 dark:text-gray-400">API Payments</p>
                      <p className="font-medium text-gray-800 dark:text-gray-200 text-sm">{(syncResult.totalPayments ?? 0).toLocaleString()}</p>
                    </div>
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-2.5">
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">New Orders</p>
                      <p className="font-medium text-emerald-800 dark:text-emerald-300 text-sm">{(syncResult.newOrders ?? 0).toLocaleString()}</p>
                    </div>
                    <div className="bg-white/80 dark:bg-gray-700/50 rounded-lg p-2.5">
                      <p className="text-xs text-gray-500 dark:text-gray-400">Enriched Orders</p>
                      <p className="font-medium text-gray-800 dark:text-gray-200 text-sm">{(syncResult.enrichedOrders ?? 0).toLocaleString()}</p>
                    </div>
                    <div className="bg-white/80 dark:bg-gray-700/50 rounded-lg p-2.5">
                      <p className="text-xs text-gray-500 dark:text-gray-400">Skipped Duplicates</p>
                      <p className="font-medium text-gray-800 dark:text-gray-200 text-sm">{(syncResult.skippedDuplicates ?? 0).toLocaleString()}</p>
                    </div>
                  </div>
                  {(syncResult.errors ?? 0) > 0 && (
                    <p className="text-xs text-red-500">{syncResult.errors} error(s) during sync.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Other platforms ─────────────────────────────────────── */}
        {PLATFORM_CARDS.map((p) => (
          <div key={p.key} className={`border rounded-lg p-4 flex items-center justify-between ${
            p.key === "doordash" ? "border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-900/10"
            : p.key === "ubereats" ? "border-green-200 dark:border-green-800/50 bg-green-50 dark:bg-green-900/10"
            : "border-orange-200 dark:border-orange-800/50 bg-orange-50 dark:bg-orange-900/10"
          }`}>
            <div className="flex items-center gap-2">
              <span className="text-lg">{p.icon}</span>
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{p.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  CSV import or extension auto-capture
                </p>
              </div>
            </div>
            <a
              href={p.portal}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              Open Portal &rarr;
            </a>
          </div>
        ))}
        {/* Chrome Extension Status */}
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm">🧩</span>
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Profit Duck Extension</p>
            </div>
            {extensionStatus?.connected ? (
              <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] text-gray-400">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
                Not detected
              </span>
            )}
          </div>
          {extensionStatus?.lastSync && (
            <p className="text-[10px] text-gray-500 dark:text-gray-400 ml-6">
              Last sync: {new Date(extensionStatus.lastSync).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              {extensionStatus.inserted ? ` — ${extensionStatus.inserted} orders` : ""}
            </p>
          )}
          {!extensionStatus?.connected && (
            <p className="text-[10px] text-gray-400 dark:text-gray-500 ml-6">
              Install the extension to auto-capture orders when browsing delivery portals.
            </p>
          )}
        </div>

        {/* ── Sync History ────────────────────────────────────────── */}
        {syncHistory.length > 0 && (
          <div className="border-t border-gray-100 dark:border-gray-700 pt-4 space-y-3">
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Sync History</h4>
            <div className="space-y-1">
              {syncHistory.map((h) => (
                <div key={h.id} className="flex items-center justify-between py-1.5 border-b border-gray-50 dark:border-gray-700/50 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full ${
                      h.status === "completed" ? "bg-emerald-500" : h.status === "failed" ? "bg-red-500" : "bg-amber-500"
                    }`} />
                    <div>
                      <p className="text-sm text-gray-700 dark:text-gray-300">
                        {new Date(h.importedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        {new Date(h.importedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-700 dark:text-gray-300">{h.rowsProcessed.toLocaleString()} payments</p>
                    <p className={`text-xs ${
                      h.status === "completed" ? "text-emerald-600 dark:text-emerald-400" : h.status === "failed" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"
                    }`}>
                      {h.status}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════
          CARD 2 — Import Data + Supported Formats
          ═══════════════════════════════════════════════════════════ */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Import Data</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Upload CSV, TSV, or Excel files from your platforms
          </p>
        </div>

        {/* Drop zone */}
        <div
          className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
            dragOver
              ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20"
              : file
                ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20"
                : "border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/30 hover:border-gray-400 dark:hover:border-gray-500"
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {file ? (
            <div>
              <p className="text-base font-medium text-gray-800 dark:text-gray-200">{file.name}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {(file.size / 1024).toFixed(1)} KB
              </p>
              {!uploading && (
                <button onClick={resetUpload} className="mt-3 text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300">
                  Remove
                </button>
              )}
            </div>
          ) : (
            <div>
              <p className="text-base text-gray-500 dark:text-gray-400">Drag and drop a file here, or</p>
              <label className="mt-3 inline-block px-4 py-2 bg-indigo-600 text-white rounded-lg cursor-pointer hover:bg-indigo-700 text-sm">
                Browse Files
                <input
                  type="file"
                  accept=".csv,.tsv,.xlsx,.xls,.pdf"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
              </label>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">Supported: CSV, TSV, XLSX, XLS, PDF (Chase statements)</p>
            </div>
          )}
        </div>

        {/* Platform selection + upload button */}
        {file && !importResult && !duplicateInfo && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Source Platform</label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as SourcePlatform)}
                disabled={uploading}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50"
              >
                {PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Leave on Auto-detect to let the system identify the source</p>
            </div>

            {uploading && uploadProgress ? (
              <ProgressBar progress={uploadProgress} color="indigo" />
            ) : (
              <button
                onClick={() => doUpload(false)}
                disabled={uploading}
                className="w-full bg-indigo-600 text-white py-2.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              >
                {uploading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    Starting...
                  </span>
                ) : (
                  "Import File"
                )}
              </button>
            )}
          </div>
        )}

        {/* Duplicate warning */}
        {duplicateInfo && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-lg p-4 space-y-3">
            <div className="flex items-start gap-3">
              <span className="text-amber-600 dark:text-amber-400 text-xl mt-0.5">&#9888;</span>
              <div>
                <h4 className="text-sm font-medium text-amber-800 dark:text-amber-300">Duplicate File Detected</h4>
                <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">{duplicateInfo.message}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => doUpload(true)}
                disabled={uploading}
                className="flex-1 bg-amber-600 text-white py-2 rounded-lg hover:bg-amber-700 disabled:opacity-50 text-sm font-medium"
              >
                {uploading ? "Processing..." : "Import Anyway (Skip Duplicates)"}
              </button>
              <button onClick={resetUpload} className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-sm transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Upload error */}
        {uploadError && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-lg p-3">
            <p className="text-sm text-red-700 dark:text-red-400">{uploadError}</p>
          </div>
        )}

        {/* Import result */}
        {importResult && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-emerald-600 text-lg">&#10003;</span>
              <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200">Import Successful</h4>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2.5">
                <p className="text-xs text-gray-500 dark:text-gray-400">Source</p>
                <p className="font-medium text-gray-800 dark:text-gray-200 text-sm">{importResult.summary.source}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2.5">
                <p className="text-xs text-gray-500 dark:text-gray-400">Rows Processed</p>
                <p className="font-medium text-gray-800 dark:text-gray-200 text-sm">{importResult.summary.rowsProcessed}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2.5">
                <p className="text-xs text-gray-500 dark:text-gray-400">Transactions</p>
                <p className="font-medium text-gray-800 dark:text-gray-200 text-sm">{importResult.summary.transactions}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2.5">
                <p className="text-xs text-gray-500 dark:text-gray-400">Platform Orders</p>
                <p className="font-medium text-gray-800 dark:text-gray-200 text-sm">{importResult.summary.platformOrders}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2.5">
                <p className="text-xs text-gray-500 dark:text-gray-400">Bank Transactions</p>
                <p className="font-medium text-gray-800 dark:text-gray-200 text-sm">{importResult.summary.bankTransactions}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2.5">
                <p className="text-xs text-gray-500 dark:text-gray-400">Expenses</p>
                <p className="font-medium text-gray-800 dark:text-gray-200 text-sm">{importResult.summary.expenses}</p>
              </div>
            </div>

            {importResult.summary.rowsSkipped > 0 && (
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 rounded-lg p-2.5">
                <p className="text-xs text-blue-700 dark:text-blue-400">
                  {importResult.summary.rowsSkipped} duplicate row(s) were automatically skipped.
                </p>
              </div>
            )}

            {importResult.overlappingImports && importResult.overlappingImports.length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-lg p-2.5">
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">Overlapping time ranges detected</p>
                <ul className="text-xs text-amber-600 dark:text-amber-400 space-y-0.5">
                  {importResult.overlappingImports.map((imp) => (
                    <li key={imp.id}>
                      &quot;{imp.fileName}&quot; imported on {new Date(imp.importedAt).toLocaleDateString()}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Duplicate rows were automatically skipped during import.</p>
              </div>
            )}

            {importResult.summary.errors.length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-lg p-2.5">
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">{importResult.summary.errors.length} warning(s)</p>
                <ul className="text-xs text-amber-600 dark:text-amber-400 space-y-0.5">
                  {importResult.summary.errors.slice(0, 5).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                  {importResult.summary.errors.length > 5 && (
                    <li>...and {importResult.summary.errors.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}

            <button
              onClick={resetUpload}
              className="w-full border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-sm transition-colors"
            >
              Import Another File
            </button>
          </div>
        )}

        {/* ── Supported File Formats ─────────────────────────────── */}
        <div className="border-t border-gray-100 dark:border-gray-700 pt-4 mt-4">
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Supported File Formats</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            {SUPPORTED_FORMATS.map((p) => (
              <div key={p.name} className="flex items-start gap-2">
                <span className="text-indigo-600 dark:text-indigo-400 mt-0.5">&#9679;</span>
                <div>
                  <p className="font-medium text-gray-700 dark:text-gray-300">{p.name}</p>
                  <p className="text-gray-500 dark:text-gray-400 text-xs">{p.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
