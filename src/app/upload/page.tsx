"use client";

import { useState, useCallback, useEffect, useRef } from "react";

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
  overlappingImports?: { id: string; fileName: string; importedAt: string }[] | null;
}

interface DuplicateInfo {
  duplicate: true;
  existingFileName: string;
  importedAt: string;
  message: string;
}

interface SquareSyncResult {
  totalPayments: number;
  matched: number;
  enriched: number;
  skipped: number;
  unmatched: number;
  totalFeesAdded: number;
  importId: string;
}

interface ProgressState {
  phase: string;
  current: number;
  total: number;
  message: string;
  done: boolean;
  result?: unknown;
  error?: string;
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

function ProgressBar({
  progress,
  color = "indigo",
}: {
  progress: ProgressState;
  color?: "indigo" | "blue";
}) {
  const pct = progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : -1; // -1 = indeterminate
  const isIndeterminate = pct < 0;
  const colorClasses = color === "blue" ? "bg-blue-600" : "bg-indigo-600";
  const trackClasses = color === "blue" ? "bg-blue-100" : "bg-indigo-100";

  return (
    <div className="space-y-2">
      <div className={`w-full ${trackClasses} rounded-full h-2 overflow-hidden`}>
        {isIndeterminate ? (
          <div
            className={`h-full ${colorClasses} rounded-full animate-progress-indeterminate`}
            style={{ width: "40%" }}
          />
        ) : (
          <div
            className={`h-full ${colorClasses} rounded-full transition-all duration-300 ease-out`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{progress.message}</p>
        {!isIndeterminate && (
          <p className="text-xs font-medium text-gray-600">{pct}%</p>
        )}
      </div>
    </div>
  );
}

/**
 * Subscribe to SSE progress updates for an operation.
 * Returns a cleanup function.
 */
function useProgressStream(
  operationId: string | null,
  onUpdate: (progress: ProgressState) => void,
  onDone: (progress: ProgressState) => void
) {
  const onUpdateRef = useRef(onUpdate);
  const onDoneRef = useRef(onDone);
  onUpdateRef.current = onUpdate;
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!operationId) return;

    const eventSource = new EventSource(`/api/progress/${operationId}`);

    eventSource.onmessage = (event) => {
      try {
        const progress: ProgressState = JSON.parse(event.data);
        if (progress.done) {
          onDoneRef.current(progress);
          eventSource.close();
        } else {
          onUpdateRef.current(progress);
        }
      } catch {
        // ignore parse errors
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [operationId]);
}

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [platform, setPlatform] = useState<SourcePlatform>("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<ProgressState | null>(null);
  const [uploadOpId, setUploadOpId] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(null);

  // Square API sync state
  const [squareConfigured, setSquareConfigured] = useState<boolean | null>(null);
  const [squareMerchant, setSquareMerchant] = useState<string | null>(null);
  const [squareSyncing, setSquareSyncing] = useState(false);
  const [squareSyncProgress, setSquareSyncProgress] = useState<ProgressState | null>(null);
  const [squareSyncOpId, setSquareSyncOpId] = useState<string | null>(null);
  const [squareSyncResult, setSquareSyncResult] = useState<SquareSyncResult | null>(null);
  const [squareSyncError, setSquareSyncError] = useState<string | null>(null);
  const [lastSyncDate, setLastSyncDate] = useState<string | null>(null);
  const [squareToken, setSquareToken] = useState("");
  const [tokenSaving, setTokenSaving] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  // SSE progress streams
  useProgressStream(
    uploadOpId,
    (progress) => setUploadProgress(progress),
    (progress) => {
      setUploading(false);
      setUploadProgress(null);
      setUploadOpId(null);
      if (progress.error) {
        setError(progress.error);
      } else if (progress.result) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = progress.result as any;
        if (data.duplicate) {
          setDuplicateInfo(data as DuplicateInfo);
        } else {
          setResult(data as ImportResult);
          setDuplicateInfo(null);
        }
      }
    }
  );

  useProgressStream(
    squareSyncOpId,
    (progress) => setSquareSyncProgress(progress),
    (progress) => {
      setSquareSyncing(false);
      setSquareSyncProgress(null);
      setSquareSyncOpId(null);
      if (progress.error) {
        setSquareSyncError(progress.error);
      } else if (progress.result) {
        setSquareSyncResult(progress.result as SquareSyncResult);
        setLastSyncDate(new Date().toISOString());
      }
    }
  );

  // Check Square API status on mount
  useEffect(() => {
    fetch("/api/square/status")
      .then((r) => r.json())
      .then((data) => setSquareConfigured(data.configured))
      .catch(() => setSquareConfigured(false));

    fetch("/api/square/sync")
      .then((r) => r.json())
      .then((data) => {
        if (data.lastSync?.importedAt) {
          setLastSyncDate(data.lastSync.importedAt);
        }
      })
      .catch(() => {});
  }, []);

  const doSquareSync = async () => {
    setSquareSyncing(true);
    setSquareSyncError(null);
    setSquareSyncResult(null);
    setSquareSyncProgress(null);

    try {
      const response = await fetch("/api/square/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const data = await response.json();

      if (!response.ok) {
        setSquareSyncError(data.error || "Sync failed");
        setSquareSyncing(false);
      } else if (data.operationId) {
        setSquareSyncOpId(data.operationId);
      }
    } catch {
      setSquareSyncError("Network error. Please try again.");
      setSquareSyncing(false);
    }
  };

  const saveSquareToken = async () => {
    if (!squareToken.trim()) return;
    setTokenSaving(true);
    setTokenError(null);
    try {
      const response = await fetch("/api/square/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: squareToken }),
      });
      const data = await response.json();
      if (data.configured) {
        setSquareConfigured(true);
        setSquareMerchant(data.merchantName || null);
        setSquareToken("");
        setTokenError(null);
      } else {
        setTokenError(data.error || "Failed to connect");
      }
    } catch {
      setTokenError("Network error. Please try again.");
    } finally {
      setTokenSaving(false);
    }
  };

  const disconnectSquare = async () => {
    try {
      await fetch("/api/square/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disconnect" }),
      });
      setSquareConfigured(false);
      setSquareMerchant(null);
      setSquareSyncResult(null);
      setSquareSyncError(null);
    } catch {
      // ignore
    }
  };

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setResult(null);
    setError(null);
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
    setError(null);
    setResult(null);
    setUploadProgress(null);
    if (!forceImport) setDuplicateInfo(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (platform) formData.append("platform", platform);
      if (forceImport) formData.append("forceImport", "true");

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Upload failed");
        setUploading(false);
      } else if (data.operationId) {
        setUploadOpId(data.operationId);
      }
    } catch {
      setError("Network error. Please try again.");
      setUploading(false);
    }
  };

  const reset = () => {
    setFile(null);
    setPlatform("");
    setResult(null);
    setError(null);
    setDuplicateInfo(null);
    setUploadProgress(null);
    setUploadOpId(null);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Indeterminate progress bar animation */}
      <style>{`
        @keyframes progress-indeterminate {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
        .animate-progress-indeterminate {
          animation: progress-indeterminate 1.5s ease-in-out infinite;
        }
      `}</style>

      {/* Drop Zone */}
      <div
        className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
          dragOver
            ? "border-indigo-500 bg-indigo-50"
            : file
              ? "border-emerald-400 bg-emerald-50"
              : "border-gray-300 bg-white hover:border-gray-400"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {file ? (
          <div>
            <p className="text-lg font-medium text-gray-800">{file.name}</p>
            <p className="text-sm text-gray-500 mt-1">
              {(file.size / 1024).toFixed(1)} KB
            </p>
            {!uploading && (
              <button
                onClick={reset}
                className="mt-3 text-sm text-red-600 hover:text-red-700"
              >
                Remove
              </button>
            )}
          </div>
        ) : (
          <div>
            <p className="text-lg text-gray-500">
              Drag and drop a file here, or
            </p>
            <label className="mt-3 inline-block px-4 py-2 bg-indigo-600 text-white rounded-lg cursor-pointer hover:bg-indigo-700 text-sm">
              Browse Files
              <input
                type="file"
                accept=".csv,.tsv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </label>
            <p className="text-xs text-gray-400 mt-3">
              Supported: CSV, TSV, XLSX, XLS
            </p>
          </div>
        )}
      </div>

      {/* Platform Selection + Upload */}
      {file && !result && !duplicateInfo && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Source Platform
            </label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as SourcePlatform)}
              disabled={uploading}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50"
            >
              {PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Leave on Auto-detect to let the system identify the source
            </p>
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

      {/* Duplicate Warning */}
      {duplicateInfo && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 space-y-4">
          <div className="flex items-start gap-3">
            <span className="text-amber-600 text-xl mt-0.5">&#9888;</span>
            <div>
              <h3 className="text-sm font-medium text-amber-800">
                Duplicate File Detected
              </h3>
              <p className="text-sm text-amber-700 mt-1">
                {duplicateInfo.message}
              </p>
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
            <button
              onClick={reset}
              className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-50 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Success Result */}
      {result && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-emerald-600 text-lg">&#10003;</span>
            <h3 className="text-lg font-medium text-gray-800">
              Import Successful
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500">Source</p>
              <p className="font-medium text-gray-800">
                {result.summary.source}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500">Rows Processed</p>
              <p className="font-medium text-gray-800">
                {result.summary.rowsProcessed}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500">Transactions</p>
              <p className="font-medium text-gray-800">
                {result.summary.transactions}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500">Platform Orders</p>
              <p className="font-medium text-gray-800">
                {result.summary.platformOrders}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500">Bank Transactions</p>
              <p className="font-medium text-gray-800">
                {result.summary.bankTransactions}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500">Expenses</p>
              <p className="font-medium text-gray-800">
                {result.summary.expenses}
              </p>
            </div>
          </div>

          {result.summary.rowsSkipped > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-sm text-blue-700">
                {result.summary.rowsSkipped} duplicate row(s) were automatically skipped.
              </p>
            </div>
          )}

          {result.overlappingImports && result.overlappingImports.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm font-medium text-amber-700 mb-1">
                Overlapping time ranges detected
              </p>
              <ul className="text-xs text-amber-600 space-y-0.5">
                {result.overlappingImports.map((imp) => (
                  <li key={imp.id}>
                    &quot;{imp.fileName}&quot; imported on{" "}
                    {new Date(imp.importedAt).toLocaleDateString()}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-amber-600 mt-1">
                Duplicate rows were automatically skipped during import.
              </p>
            </div>
          )}

          {result.summary.errors.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm font-medium text-amber-700 mb-1">
                {result.summary.errors.length} warning(s)
              </p>
              <ul className="text-xs text-amber-600 space-y-0.5">
                {result.summary.errors.slice(0, 5).map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
                {result.summary.errors.length > 5 && (
                  <li>
                    ...and {result.summary.errors.length - 5} more
                  </li>
                )}
              </ul>
            </div>
          )}

          <button
            onClick={reset}
            className="w-full border border-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-50 text-sm"
          >
            Import Another File
          </button>
        </div>
      )}

      {/* Square API Sync */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-800">
              Square API Sync
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Pull processing fees from Square&apos;s API to enrich imported
              orders
            </p>
          </div>
          {squareConfigured !== null && (
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${
                  squareConfigured
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-gray-100 text-gray-500"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    squareConfigured ? "bg-emerald-500" : "bg-gray-400"
                  }`}
                />
                {squareConfigured
                  ? squareMerchant || "Connected"
                  : "Not configured"}
              </span>
              {squareConfigured && (
                <button
                  onClick={disconnectSquare}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                  title="Disconnect Square"
                >
                  &#10005;
                </button>
              )}
            </div>
          )}
        </div>

        {squareConfigured === false && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="password"
                value={squareToken}
                onChange={(e) => {
                  setSquareToken(e.target.value);
                  setTokenError(null);
                }}
                placeholder="Paste your Square access token"
                className={`flex-1 border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono ${
                  tokenError ? "border-red-300" : "border-gray-300"
                }`}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveSquareToken();
                }}
              />
              <button
                onClick={saveSquareToken}
                disabled={tokenSaving || !squareToken.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium whitespace-nowrap"
              >
                {tokenSaving ? (
                  <span className="flex items-center gap-1.5">
                    <span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" />
                    Validating...
                  </span>
                ) : (
                  "Connect"
                )}
              </button>
            </div>
            {tokenError && (
              <p className="text-xs text-red-600">{tokenError}</p>
            )}
            <p className="text-xs text-gray-400">
              Get your production token from{" "}
              <span className="text-indigo-600">
                developer.squareup.com/apps
              </span>
              {" "}&mdash; stored in server memory only
            </p>
          </div>
        )}

        {squareConfigured && (
          <>
            {lastSyncDate && !squareSyncResult && !squareSyncing && (
              <p className="text-xs text-gray-500">
                Last sync: {new Date(lastSyncDate).toLocaleString()}
              </p>
            )}

            {squareSyncing && squareSyncProgress ? (
              <ProgressBar progress={squareSyncProgress} color="blue" />
            ) : (
              <button
                onClick={doSquareSync}
                disabled={squareSyncing}
                className="w-full bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              >
                {squareSyncing ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    Starting...
                  </span>
                ) : (
                  "Sync Processing Fees"
                )}
              </button>
            )}
          </>
        )}

        {squareSyncError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-sm text-red-700">{squareSyncError}</p>
          </div>
        )}

        {squareSyncResult && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-emerald-600">&#10003;</span>
              <p className="text-sm font-medium text-gray-800">
                Sync Complete
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-50 rounded-lg p-2.5">
                <p className="text-xs text-gray-500">API Payments</p>
                <p className="font-medium text-gray-800 text-sm">
                  {squareSyncResult.totalPayments.toLocaleString()}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2.5">
                <p className="text-xs text-gray-500">Matched Orders</p>
                <p className="font-medium text-gray-800 text-sm">
                  {squareSyncResult.matched.toLocaleString()}
                </p>
              </div>
              <div className="bg-emerald-50 rounded-lg p-2.5">
                <p className="text-xs text-emerald-600">Fees Enriched</p>
                <p className="font-medium text-emerald-800 text-sm">
                  {squareSyncResult.enriched.toLocaleString()}
                </p>
              </div>
              <div className="bg-emerald-50 rounded-lg p-2.5">
                <p className="text-xs text-emerald-600">Total Fees Added</p>
                <p className="font-medium text-emerald-800 text-sm">
                  $
                  {squareSyncResult.totalFeesAdded.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
            </div>
            {squareSyncResult.skipped > 0 && (
              <p className="text-xs text-gray-500">
                {squareSyncResult.skipped} order(s) already had fees (skipped).
              </p>
            )}
            {squareSyncResult.unmatched > 0 && (
              <p className="text-xs text-amber-600">
                {squareSyncResult.unmatched} API payment(s) had no matching CSV
                order.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-700 mb-3">
          Supported File Formats
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          {[
            { name: "SquareUp", desc: "Transaction CSV export from Square Dashboard" },
            { name: "Chase Bank", desc: "Transaction CSV from Chase online banking" },
            { name: "DoorDash", desc: "Order or payout report from Merchant Portal" },
            { name: "Uber Eats", desc: "Order or payment CSV from Uber Eats Manager" },
            { name: "Grubhub", desc: "Order report from Grubhub for Restaurants" },
            { name: "Rocket Money", desc: "Transaction export from Rocket Money" },
          ].map((p) => (
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
  );
}
