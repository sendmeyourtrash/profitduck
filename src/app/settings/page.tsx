"use client";

import { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { ProgressBar, type ProgressState } from "@/components/ui/ProgressBar";
import { useProgressStream } from "@/hooks/useProgressStream";

const loadingSpinner = () => (
  <div className="flex items-center justify-center h-64">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
  </div>
);

const ReconciliationPanel = dynamic(
  () => import("@/components/panels/ReconciliationPanel"),
  { loading: loadingSpinner }
);

const ManualEntryPanel = dynamic(
  () => import("@/components/panels/ManualEntryPanel"),
  { loading: loadingSpinner }
);

const CategoriesPanel = dynamic(
  () => import("@/components/panels/CategoriesPanel"),
  { loading: loadingSpinner }
);

const VendorAliasesPanel = dynamic(
  () => import("@/components/panels/VendorAliasesPanel"),
  { loading: loadingSpinner }
);


const ClosedDaysPanel = dynamic(
  () => import("@/components/panels/ClosedDaysPanel"),
  { loading: loadingSpinner }
);

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

type SettingsTab = "settings" | "history" | "reconciliation" | "manual-entry" | "categories" | "vendor-aliases" | "menu-aliases" | "category-aliases" | "closed-days";

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
  { key: "doordash", name: "DoorDash", color: "bg-red-50 border-red-200", icon: "🔴" },
  { key: "ubereats", name: "Uber Eats", color: "bg-green-50 border-green-200", icon: "🟢" },
  { key: "grubhub", name: "Grubhub", color: "bg-orange-50 border-orange-200", icon: "🟠" },
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

export default function SettingsPage() {
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

  // Business info
  const [openDate, setOpenDate] = useState("");
  const [openDateSaving, setOpenDateSaving] = useState(false);
  const [openDateSaved, setOpenDateSaved] = useState(false);
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [timezoneSaving, setTimezoneSaving] = useState(false);
  const [timezoneSaved, setTimezoneSaved] = useState(false);

  // History
  const [syncHistory, setSyncHistory] = useState<SyncHistory[]>([]);

  // Uber Eats scraper state
  const [ueScraperActive, setUeScraperActive] = useState(false);
  const [ueScraperStatus, setUeScraperStatus] = useState<{
    stage: string; message: string; ordersScraped?: number;
  } | null>(null);

  // Tab & import history
  const [activeTab, setActiveTab] = useState<SettingsTab>("settings");
  const [importHistory, setImportHistory] = useState<ImportRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

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
          loadImportHistory();
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
    loadImportHistory();
  }, []);

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
      if (data.settings?.restaurant_open_date) {
        setOpenDate(data.settings.restaurant_open_date);
      }
      if (data.settings?.timezone) {
        setTimezone(data.settings.timezone);
      }
    } catch {
      // ignore
    }
  }

  async function saveOpenDate() {
    setOpenDateSaving(true);
    setOpenDateSaved(false);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "restaurant_open_date", value: openDate }),
      });
      setOpenDateSaved(true);
      setTimeout(() => setOpenDateSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setOpenDateSaving(false);
    }
  }

  async function saveTimezone() {
    setTimezoneSaving(true);
    setTimezoneSaved(false);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "timezone", value: timezone }),
      });
      setTimezoneSaved(true);
      setTimeout(() => setTimezoneSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setTimezoneSaving(false);
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

  async function loadImportHistory() {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/imports");
      const data = await res.json();
      setImportHistory(data.imports || []);
    } catch {
      // ignore
    } finally {
      setHistoryLoading(false);
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
    <div className="space-y-6">

      {/* ═══════════════════════════════════════════════════════════
          TAB BAR
          ═══════════════════════════════════════════════════════════ */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab("settings")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "settings"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          }`}
        >
          Import & Settings
        </button>
        <button
          onClick={() => { setActiveTab("history"); loadImportHistory(); }}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "history"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          }`}
        >
          Import History
        </button>
        <button
          onClick={() => setActiveTab("reconciliation")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "reconciliation"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          }`}
        >
          Reconciliation
        </button>
        <div className="border-l border-gray-200 mx-2" />
        <button
          onClick={() => setActiveTab("manual-entry")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "manual-entry"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          }`}
        >
          Manual Entry
        </button>
        <button
          onClick={() => setActiveTab("categories")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "categories"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          }`}
        >
          Categories
        </button>
        <button
          onClick={() => setActiveTab("vendor-aliases")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "vendor-aliases"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          }`}
        >
          Vendor Aliases
        </button>
        <button
          onClick={() => setActiveTab("closed-days")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "closed-days"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          }`}
        >
          Closed Days
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          TAB: Reconciliation
          ═══════════════════════════════════════════════════════════ */}
      {activeTab === "reconciliation" && <ReconciliationPanel />}
      {activeTab === "manual-entry" && <ManualEntryPanel />}
      {activeTab === "categories" && <CategoriesPanel />}
      {activeTab === "vendor-aliases" && <VendorAliasesPanel />}
      {activeTab === "closed-days" && <ClosedDaysPanel />}

      {/* ═══════════════════════════════════════════════════════════
          TAB: Import History
          ═══════════════════════════════════════════════════════════ */}
      {activeTab === "history" && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {historyLoading ? (
            <div className="flex items-center justify-center h-48">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
            </div>
          ) : importHistory.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-lg">No imports yet</p>
              <p className="mt-2 text-sm">Upload your first file to see import history.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-gray-500">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">File Name</th>
                  <th className="px-4 py-3 font-medium text-right">Rows</th>
                  <th className="px-4 py-3 font-medium text-right">Skipped</th>
                  <th className="px-4 py-3 font-medium text-right">Failed</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {importHistory.map((imp) => (
                  <tr key={imp.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                      {new Date(imp.importedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      <span className="text-gray-400 ml-1 text-xs">
                        {new Date(imp.importedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                        {imp.source}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-800 max-w-[200px] truncate">{imp.fileName}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{imp.rowsProcessed.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right">
                      {imp.rowsSkipped > 0 ? (
                        <span className="text-amber-600">{imp.rowsSkipped.toLocaleString()}</span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {imp.rowsFailed > 0 ? (
                        <span className="text-red-600">{imp.rowsFailed}</span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${
                        imp.status === "completed"
                          ? "bg-emerald-100 text-emerald-700"
                          : imp.status === "failed"
                            ? "bg-red-100 text-red-700"
                            : imp.status === "processing"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-gray-100 text-gray-600"
                      }`}>
                        {imp.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          TAB: Import & Settings
          ═══════════════════════════════════════════════════════════ */}
      {activeTab === "settings" && <div className="max-w-3xl mx-auto">

      {/* ═══════════════════════════════════════════════════════════
          CARD 0 — Business Info
          ═══════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4 mb-6">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Business Info</h3>
          <p className="text-xs text-gray-500 mt-0.5">General information about your restaurant</p>
        </div>

        <div className="flex items-end gap-3">
          <div className="flex-1 max-w-xs">
            <label htmlFor="openDate" className="block text-xs font-medium text-gray-600 mb-1">
              Restaurant Open Date
            </label>
            <input
              id="openDate"
              type="date"
              value={openDate}
              onChange={(e) => { setOpenDate(e.target.value); setOpenDateSaved(false); }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <button
            onClick={saveOpenDate}
            disabled={openDateSaving || !openDate}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          >
            {openDateSaving ? "Saving..." : openDateSaved ? "Saved ✓" : "Save"}
          </button>
        </div>
        <p className="text-xs text-gray-400">
          Used in reports to provide context for profit calculations.
        </p>

        {/* Timezone */}
        <div className="flex items-end gap-3 pt-3 border-t border-gray-100">
          <div className="flex-1 max-w-xs">
            <label htmlFor="timezone" className="block text-xs font-medium text-gray-600 mb-1">
              Timezone
            </label>
            <select
              id="timezone"
              value={timezone}
              onChange={(e) => { setTimezone(e.target.value); setTimezoneSaved(false); }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="America/New_York">Eastern Time (New York)</option>
              <option value="America/Chicago">Central Time (Chicago)</option>
              <option value="America/Denver">Mountain Time (Denver)</option>
              <option value="America/Los_Angeles">Pacific Time (Los Angeles)</option>
              <option value="America/Anchorage">Alaska Time</option>
              <option value="Pacific/Honolulu">Hawaii Time</option>
              <option value="UTC">UTC</option>
            </select>
          </div>
          <button
            onClick={saveTimezone}
            disabled={timezoneSaving}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          >
            {timezoneSaving ? "Saving..." : timezoneSaved ? "Saved ✓" : "Save"}
          </button>
        </div>
        <p className="text-xs text-gray-400">
          All dates and times are displayed in this timezone. Affects charts, reports, and date filtering.
        </p>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          CARD 1 — Platform Connections & Sync
          ═══════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        {/* Header with Sync All */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Platform Connections</h3>
            <p className="text-xs text-gray-500 mt-0.5">Connect platform APIs to sync data automatically</p>
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
        <div className="border border-blue-200 bg-blue-50/50 rounded-lg p-4 space-y-3">
          {/* Connection header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">🔵</span>
              <div>
                <p className="text-sm font-medium text-gray-800">Square</p>
                <p className="text-xs text-gray-500">Sync processing fees via Square Payments API</p>
              </div>
            </div>
            {squareConfigured !== null && (
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${
                  squareConfigured ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"
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
                  className={`flex-1 border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono bg-white ${
                    tokenError ? "border-red-300" : "border-gray-300"
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
            <div className="border-t border-blue-200/60 pt-3 space-y-3">
              {/* Auto-sync toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-700">Auto-sync daily</p>
                  <p className="text-xs text-gray-400">
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
                <p className="text-xs text-gray-500">
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
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-sm text-red-700">{syncError}</p>
                </div>
              )}

              {/* Sync results */}
              {syncResult && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-600">&#10003;</span>
                      <p className="text-sm font-medium text-gray-800">Sync Complete</p>
                    </div>
                    <button
                      onClick={() => { setSyncResult(null); setSyncError(null); }}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      Dismiss
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-white/80 rounded-lg p-2.5">
                      <p className="text-xs text-gray-500">API Payments</p>
                      <p className="font-medium text-gray-800 text-sm">{(syncResult.totalPayments ?? 0).toLocaleString()}</p>
                    </div>
                    <div className="bg-emerald-50 rounded-lg p-2.5">
                      <p className="text-xs text-emerald-600">New Orders</p>
                      <p className="font-medium text-emerald-800 text-sm">{(syncResult.newOrders ?? 0).toLocaleString()}</p>
                    </div>
                    <div className="bg-white/80 rounded-lg p-2.5">
                      <p className="text-xs text-gray-500">Enriched Orders</p>
                      <p className="font-medium text-gray-800 text-sm">{(syncResult.enrichedOrders ?? 0).toLocaleString()}</p>
                    </div>
                    <div className="bg-white/80 rounded-lg p-2.5">
                      <p className="text-xs text-gray-500">Skipped Duplicates</p>
                      <p className="font-medium text-gray-800 text-sm">{(syncResult.skippedDuplicates ?? 0).toLocaleString()}</p>
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
          <div key={p.key} className={`border ${p.color} rounded-lg p-4 flex items-center justify-between`}>
            <div className="flex items-center gap-2">
              <span className="text-lg">{p.icon}</span>
              <div>
                <p className="text-sm font-medium text-gray-800">{p.name}</p>
                <p className="text-xs text-gray-500">
                  {p.key === "ubereats" ? "CSV import or auto-scrape" : "CSV import only — no API available"}
                </p>
              </div>
            </div>
            {p.key === "ubereats" ? (
              <button
                onClick={async () => {
                  if (ueScraperActive) {
                    // Abort
                    await fetch("/api/scrape/ubereats", { method: "DELETE" });
                    setUeScraperActive(false);
                    setUeScraperStatus(null);
                    return;
                  }
                  setUeScraperActive(true);
                  setUeScraperStatus({ stage: "launching", message: "Launching Chrome..." });
                  try {
                    await fetch("/api/scrape/ubereats", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({}),
                    });
                    // Poll for status
                    const poll = setInterval(async () => {
                      try {
                        const res = await fetch("/api/scrape/ubereats");
                        const data = await res.json();
                        setUeScraperStatus(data);
                        if (data.stage === "done" || data.stage === "error" || !data.active) {
                          clearInterval(poll);
                          setUeScraperActive(false);
                        }
                      } catch { /* ignore */ }
                    }, 2000);
                  } catch {
                    setUeScraperActive(false);
                    setUeScraperStatus({ stage: "error", message: "Failed to start scraper" });
                  }
                }}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                  ueScraperActive
                    ? "bg-red-100 text-red-700 hover:bg-red-200"
                    : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                }`}
              >
                {ueScraperActive ? "Stop Scraper" : "Scrape Orders"}
              </button>
            ) : (
              <span className="text-xs text-gray-400 px-2.5 py-1 bg-gray-100 rounded-full">CSV Only</span>
            )}
          </div>
        ))}
        {/* Uber Eats Scraper Status */}
        {ueScraperStatus && ueScraperStatus.stage !== "done" && (
          <div className={`rounded-lg p-3 text-sm ${
            ueScraperStatus.stage === "error"
              ? "bg-red-50 border border-red-100 text-red-700"
              : "bg-blue-50 border border-blue-100 text-blue-700"
          }`}>
            <div className="flex items-center gap-2">
              {ueScraperStatus.stage !== "error" && (
                <div className="animate-spin h-3.5 w-3.5 border-2 border-blue-400 border-t-transparent rounded-full" />
              )}
              <span className="text-xs">{ueScraperStatus.message}</span>
            </div>
            {ueScraperStatus.ordersScraped != null && ueScraperStatus.ordersScraped > 0 && (
              <p className="text-xs mt-1 ml-5">
                {ueScraperStatus.ordersScraped} orders found
              </p>
            )}
          </div>
        )}
        {ueScraperStatus && ueScraperStatus.stage === "done" && ueScraperStatus.message !== "Ready" && (
          <div className="rounded-lg p-3 text-xs bg-emerald-50 border border-emerald-100 text-emerald-700">
            {ueScraperStatus.message}
          </div>
        )}

        {/* ── Sync History ────────────────────────────────────────── */}
        {syncHistory.length > 0 && (
          <div className="border-t border-gray-100 pt-4 space-y-3">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Sync History</h4>
            <div className="space-y-1">
              {syncHistory.map((h) => (
                <div key={h.id} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full ${
                      h.status === "completed" ? "bg-emerald-500" : h.status === "failed" ? "bg-red-500" : "bg-amber-500"
                    }`} />
                    <div>
                      <p className="text-sm text-gray-700">
                        {new Date(h.importedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                      <p className="text-xs text-gray-400">
                        {new Date(h.importedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-700">{h.rowsProcessed.toLocaleString()} payments</p>
                    <p className={`text-xs ${
                      h.status === "completed" ? "text-emerald-600" : h.status === "failed" ? "text-red-600" : "text-amber-600"
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
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Import Data</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Upload CSV, TSV, or Excel files from your platforms
          </p>
        </div>

        {/* Drop zone */}
        <div
          className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
            dragOver
              ? "border-indigo-500 bg-indigo-50"
              : file
                ? "border-emerald-400 bg-emerald-50"
                : "border-gray-300 bg-gray-50 hover:border-gray-400"
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {file ? (
            <div>
              <p className="text-base font-medium text-gray-800">{file.name}</p>
              <p className="text-sm text-gray-500 mt-1">
                {(file.size / 1024).toFixed(1)} KB
              </p>
              {!uploading && (
                <button onClick={resetUpload} className="mt-3 text-sm text-red-600 hover:text-red-700">
                  Remove
                </button>
              )}
            </div>
          ) : (
            <div>
              <p className="text-base text-gray-500">Drag and drop a file here, or</p>
              <label className="mt-3 inline-block px-4 py-2 bg-indigo-600 text-white rounded-lg cursor-pointer hover:bg-indigo-700 text-sm">
                Browse Files
                <input
                  type="file"
                  accept=".csv,.tsv,.xlsx,.xls,.pdf"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
              </label>
              <p className="text-xs text-gray-400 mt-3">Supported: CSV, TSV, XLSX, XLS, PDF (Chase statements)</p>
            </div>
          )}
        </div>

        {/* Platform selection + upload button */}
        {file && !importResult && !duplicateInfo && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Source Platform</label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as SourcePlatform)}
                disabled={uploading}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50"
              >
                {PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">Leave on Auto-detect to let the system identify the source</p>
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
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
            <div className="flex items-start gap-3">
              <span className="text-amber-600 text-xl mt-0.5">&#9888;</span>
              <div>
                <h4 className="text-sm font-medium text-amber-800">Duplicate File Detected</h4>
                <p className="text-sm text-amber-700 mt-1">{duplicateInfo.message}</p>
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
              <button onClick={resetUpload} className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-50 text-sm">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Upload error */}
        {uploadError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-sm text-red-700">{uploadError}</p>
          </div>
        )}

        {/* Import result */}
        {importResult && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-emerald-600 text-lg">&#10003;</span>
              <h4 className="text-sm font-medium text-gray-800">Import Successful</h4>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-50 rounded-lg p-2.5">
                <p className="text-xs text-gray-500">Source</p>
                <p className="font-medium text-gray-800 text-sm">{importResult.summary.source}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2.5">
                <p className="text-xs text-gray-500">Rows Processed</p>
                <p className="font-medium text-gray-800 text-sm">{importResult.summary.rowsProcessed}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2.5">
                <p className="text-xs text-gray-500">Transactions</p>
                <p className="font-medium text-gray-800 text-sm">{importResult.summary.transactions}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2.5">
                <p className="text-xs text-gray-500">Platform Orders</p>
                <p className="font-medium text-gray-800 text-sm">{importResult.summary.platformOrders}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2.5">
                <p className="text-xs text-gray-500">Bank Transactions</p>
                <p className="font-medium text-gray-800 text-sm">{importResult.summary.bankTransactions}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2.5">
                <p className="text-xs text-gray-500">Expenses</p>
                <p className="font-medium text-gray-800 text-sm">{importResult.summary.expenses}</p>
              </div>
            </div>

            {importResult.summary.rowsSkipped > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5">
                <p className="text-xs text-blue-700">
                  {importResult.summary.rowsSkipped} duplicate row(s) were automatically skipped.
                </p>
              </div>
            )}

            {importResult.overlappingImports && importResult.overlappingImports.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                <p className="text-xs font-medium text-amber-700 mb-1">Overlapping time ranges detected</p>
                <ul className="text-xs text-amber-600 space-y-0.5">
                  {importResult.overlappingImports.map((imp) => (
                    <li key={imp.id}>
                      &quot;{imp.fileName}&quot; imported on {new Date(imp.importedAt).toLocaleDateString()}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-amber-600 mt-1">Duplicate rows were automatically skipped during import.</p>
              </div>
            )}

            {importResult.summary.errors.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                <p className="text-xs font-medium text-amber-700 mb-1">{importResult.summary.errors.length} warning(s)</p>
                <ul className="text-xs text-amber-600 space-y-0.5">
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
              className="w-full border border-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-50 text-sm"
            >
              Import Another File
            </button>
          </div>
        )}

        {/* ── Supported File Formats ─────────────────────────────── */}
        <div className="border-t border-gray-100 pt-4 mt-4">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Supported File Formats</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            {SUPPORTED_FORMATS.map((p) => (
              <div key={p.name} className="flex items-start gap-2">
                <span className="text-indigo-600 mt-0.5">&#9679;</span>
                <div>
                  <p className="font-medium text-gray-700">{p.name}</p>
                  <p className="text-gray-500 text-xs">{p.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      </div>}
    </div>
  );
}
