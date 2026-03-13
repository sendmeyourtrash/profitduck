"use client";

import { useEffect, useState, useCallback } from "react";
import StatCard from "@/components/charts/StatCard";
import { formatCurrency } from "@/lib/utils/format";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReconciliationStats {
  totalPayouts: number;
  reconciledPayouts: number;
  unreconciledPayouts: number;
  totalBankDeposits: number;
  reconciledBankDeposits: number;
  unreconciledBankDeposits: number;
  reconciliationRate: number;
}

interface Summary {
  totalExpectedRevenue: number;
  totalPayoutAmount: number;
  totalBankDeposits: number;
  l1L2Variance: number;
  l2L3Variance: number;
  reconciledChains: number;
  partialChains: number;
  discrepancyChains: number;
  unreconciledChains: number;
  activeAlerts: number;
}

interface Suggestion {
  payoutId: string;
  payoutPlatform: string;
  payoutDate: string;
  payoutAmount: number;
  bankTransactionId: string;
  bankDate: string;
  bankDescription: string;
  bankAmount: number;
  amountDiff: number;
  daysDiff: number;
  confidence: number;
}

interface ReconciledPair {
  payoutId: string;
  platform: string;
  payoutDate: string;
  payoutAmount: number;
  bankTransactionId: string;
  bankDate: string;
  bankDescription: string;
  bankAmount: number;
}

interface Chain {
  id: string;
  platform: string;
  periodStart: string;
  periodEnd: string;
  level1: {
    orderCount: number;
    totalAmount: number;
    orders: Array<{
      id: string;
      orderId: string;
      netPayout: number;
      date: string;
    }>;
  };
  level2: {
    payout: {
      id: string;
      grossAmount: number;
      fees: number;
      netAmount: number;
      date: string;
    } | null;
  };
  level3: {
    bankTransaction: {
      id: string;
      amount: number;
      date: string;
      description: string;
    } | null;
  };
  status: string;
  l1L2Variance: number | null;
  l2L3Variance: number | null;
}

interface Alert {
  id: string;
  type: string;
  severity: string;
  platform: string | null;
  message: string;
  details: string | null;
  resolved: boolean;
  createdAt: string;
}

interface ReconciliationData {
  stats: ReconciliationStats;
  suggestions: Suggestion[];
  reconciledPairs: ReconciledPair[];
  summary: Summary;
  alerts: Alert[];
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "matching", label: "Matching" },
  { key: "chains", label: "Chains" },
  { key: "alerts", label: "Alerts" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReconciliationPage() {
  const [tab, setTab] = useState<TabKey>("overview");
  const [data, setData] = useState<ReconciliationData | null>(null);
  const [chains, setChains] = useState<Chain[]>([]);
  const [loading, setLoading] = useState(true);
  const [matching, setMatching] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [chainPlatform, setChainPlatform] = useState("");

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/reconciliation").then((r) => r.json()),
      fetch(
        `/api/reconciliation/chains${chainPlatform ? `?platform=${chainPlatform}` : ""}`
      ).then((r) => r.json()),
    ])
      .then(([recon, chainData]) => {
        setData(recon);
        setChains(chainData.chains || []);
      })
      .finally(() => setLoading(false));
  }, [chainPlatform]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRunReconciliation = async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const res = await fetch("/api/reconciliation/run", { method: "POST" });
      const result = await res.json();
      setRunResult(
        `L1→L2: ${result.l1l2.matched} matched, ${result.l1l2.discrepancies} discrepancies | L2→L3: ${result.l2l3AutoMatched} auto-matched | ${result.newAlerts} new alerts`
      );
      loadData();
    } catch {
      setRunResult("Reconciliation failed");
    } finally {
      setRunning(false);
    }
  };

  const handleMatch = async (payoutId: string, bankTransactionId: string) => {
    setMatching(payoutId);
    try {
      const res = await fetch("/api/reconciliation/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payoutId, bankTransactionId }),
      });
      if (res.ok) loadData();
    } finally {
      setMatching(null);
    }
  };

  const handleUnmatch = async (payoutId: string) => {
    setMatching(payoutId);
    try {
      const res = await fetch("/api/reconciliation/match", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payoutId }),
      });
      if (res.ok) loadData();
    } finally {
      setMatching(null);
    }
  };

  const handleResolveAlert = async (alertId: string) => {
    await fetch("/api/reconciliation/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId }),
    });
    loadData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!data) return null;

  const unresolvedAlerts = data.alerts.filter((a) => !a.resolved);

  return (
    <div className="space-y-6">
      {/* Tab Bar */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
            {t.key === "alerts" && unresolvedAlerts.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full text-xs">
                {unresolvedAlerts.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <OverviewTab
          summary={data.summary}
          onRun={handleRunReconciliation}
          running={running}
          runResult={runResult}
        />
      )}
      {tab === "matching" && (
        <MatchingTab
          data={data}
          matching={matching}
          onMatch={handleMatch}
          onUnmatch={handleUnmatch}
        />
      )}
      {tab === "chains" && (
        <ChainsTab
          chains={chains}
          platform={chainPlatform}
          onPlatformChange={(p) => setChainPlatform(p)}
        />
      )}
      {tab === "alerts" && (
        <AlertsTab alerts={unresolvedAlerts} onResolve={handleResolveAlert} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview Tab
// ---------------------------------------------------------------------------

function OverviewTab({
  summary,
  onRun,
  running,
  runResult,
}: {
  summary: Summary;
  onRun: () => void;
  running: boolean;
  runResult: string | null;
}) {
  const l1l2Variant =
    Math.abs(summary.l1L2Variance) < 10
      ? "success"
      : Math.abs(summary.l1L2Variance) < 100
        ? "warning"
        : "danger";
  const l2l3Variant =
    Math.abs(summary.l2L3Variance) < 10
      ? "success"
      : Math.abs(summary.l2L3Variance) < 100
        ? "warning"
        : "danger";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">
          3-Level Reconciliation Overview
        </h3>
        <button
          onClick={onRun}
          disabled={running}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          {running ? "Running..." : "Run Reconciliation"}
        </button>
      </div>

      {runResult && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
          {runResult}
        </div>
      )}

      {/* Revenue flow: L1 → L2 → L3 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="L1: Expected Revenue"
          value={formatCurrency(summary.totalExpectedRevenue)}
          subtitle="From atomic events (orders)"
        />
        <StatCard
          title="L2: Platform Payouts"
          value={formatCurrency(summary.totalPayoutAmount)}
          subtitle="From payout records"
        />
        <StatCard
          title="L3: Bank Deposits"
          value={formatCurrency(summary.totalBankDeposits)}
          subtitle="Confirmed in bank"
        />
      </div>

      {/* Variances */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="L1 → L2 Variance"
          value={formatCurrency(Math.abs(summary.l1L2Variance))}
          subtitle={
            summary.l1L2Variance > 0 ? "Over expected" : "Under expected"
          }
          variant={l1l2Variant as "success" | "warning" | "danger"}
        />
        <StatCard
          title="L2 → L3 Variance"
          value={formatCurrency(Math.abs(summary.l2L3Variance))}
          subtitle={
            summary.l2L3Variance > 0 ? "Awaiting deposit" : "Extra deposits"
          }
          variant={l2l3Variant as "success" | "warning" | "danger"}
        />
        <StatCard
          title="Reconciliation Status"
          value={`${summary.reconciledChains} reconciled`}
          subtitle={`${summary.partialChains} partial, ${summary.discrepancyChains} discrepancy`}
          variant={summary.discrepancyChains > 0 ? "warning" : "success"}
        />
        <StatCard
          title="Active Alerts"
          value={summary.activeAlerts.toString()}
          variant={summary.activeAlerts > 0 ? "danger" : "success"}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Matching Tab (preserved from original with enhancements)
// ---------------------------------------------------------------------------

function MatchingTab({
  data,
  matching,
  onMatch,
  onUnmatch,
}: {
  data: ReconciliationData;
  matching: string | null;
  onMatch: (payoutId: string, bankTransactionId: string) => void;
  onUnmatch: (payoutId: string) => void;
}) {
  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="Reconciliation Rate"
          value={`${data.stats.reconciliationRate}%`}
          variant={data.stats.reconciliationRate >= 80 ? "success" : "warning"}
        />
        <StatCard
          title="Reconciled Payouts"
          value={`${data.stats.reconciledPayouts} / ${data.stats.totalPayouts}`}
        />
        <StatCard
          title="Unreconciled Payouts"
          value={data.stats.unreconciledPayouts.toString()}
          variant={data.stats.unreconciledPayouts > 0 ? "warning" : "success"}
        />
        <StatCard
          title="Unreconciled Deposits"
          value={data.stats.unreconciledBankDeposits.toString()}
        />
      </div>

      {/* Suggestions */}
      {data.suggestions.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-medium text-gray-700 mb-4">
            Suggested Matches ({data.suggestions.length})
          </h3>
          <div className="space-y-3">
            {data.suggestions.map((s) => (
              <div
                key={`${s.payoutId}-${s.bankTransactionId}`}
                className="border border-gray-100 rounded-lg p-4 flex items-center justify-between gap-4"
              >
                <div className="flex-1 grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-400 mb-1">
                      Platform Payout
                    </p>
                    <p className="text-sm font-medium text-gray-800">
                      {s.payoutPlatform} - {formatCurrency(s.payoutAmount)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(s.payoutDate).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Bank Deposit</p>
                    <p className="text-sm font-medium text-gray-800">
                      {formatCurrency(s.bankAmount)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(s.bankDate).toLocaleDateString()} -{" "}
                      {s.bankDescription}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-center">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        s.confidence >= 0.8
                          ? "bg-emerald-100 text-emerald-700"
                          : s.confidence >= 0.5
                            ? "bg-amber-100 text-amber-700"
                            : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {Math.round(s.confidence * 100)}%
                    </span>
                    {s.amountDiff > 0 && (
                      <p className="text-xs text-gray-400 mt-1">
                        diff: {formatCurrency(s.amountDiff)}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => onMatch(s.payoutId, s.bankTransactionId)}
                    disabled={matching === s.payoutId}
                    className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {matching === s.payoutId ? "..." : "Match"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.suggestions.length === 0 &&
        data.stats.unreconciledPayouts > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
            <p className="text-sm text-amber-700">
              No automatic matches found. Import bank statements to enable
              reconciliation.
            </p>
          </div>
        )}

      {/* Reconciled Pairs */}
      {data.reconciledPairs.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-medium text-gray-700 mb-4">
            Reconciled Pairs ({data.reconciledPairs.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b">
                  <th className="pb-2 font-medium">Platform</th>
                  <th className="pb-2 font-medium">Payout Date</th>
                  <th className="pb-2 font-medium text-right">Amount</th>
                  <th className="pb-2 font-medium">Bank Date</th>
                  <th className="pb-2 font-medium">Bank Description</th>
                  <th className="pb-2 font-medium text-right">Bank Amount</th>
                  <th className="pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {data.reconciledPairs.map((pair) => (
                  <tr key={pair.payoutId} className="border-b border-gray-50">
                    <td className="py-2 text-gray-800">{pair.platform}</td>
                    <td className="py-2 text-gray-600">
                      {new Date(pair.payoutDate).toLocaleDateString()}
                    </td>
                    <td className="py-2 text-right font-medium">
                      {formatCurrency(pair.payoutAmount)}
                    </td>
                    <td className="py-2 text-gray-600">
                      {pair.bankDate
                        ? new Date(pair.bankDate).toLocaleDateString()
                        : "-"}
                    </td>
                    <td className="py-2 text-gray-600">
                      {pair.bankDescription || "-"}
                    </td>
                    <td className="py-2 text-right font-medium">
                      {pair.bankAmount ? formatCurrency(pair.bankAmount) : "-"}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => onUnmatch(pair.payoutId)}
                        disabled={matching === pair.payoutId}
                        className="text-xs text-red-600 hover:text-red-700"
                      >
                        Unmatch
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.stats.totalPayouts === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">No payouts to reconcile</p>
          <p className="mt-2">
            Import delivery platform data and bank statements to start
            reconciliation.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chains Tab
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  reconciled: "bg-emerald-100 text-emerald-700",
  partially_reconciled: "bg-amber-100 text-amber-700",
  discrepancy_detected: "bg-red-100 text-red-700",
  unreconciled: "bg-gray-100 text-gray-600",
};

function ChainsTab({
  chains,
  platform,
  onPlatformChange,
}: {
  chains: Chain[];
  platform: string;
  onPlatformChange: (p: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">
          Reconciliation Chains ({chains.length})
        </h3>
        <select
          value={platform}
          onChange={(e) => onPlatformChange(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5"
        >
          <option value="">All Platforms</option>
          <option value="square">Square</option>
          <option value="doordash">DoorDash</option>
          <option value="ubereats">Uber Eats</option>
          <option value="grubhub">Grubhub</option>
        </select>
      </div>

      {chains.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p>No reconciliation chains found. Run reconciliation first.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {chains.map((chain) => (
            <div
              key={chain.id}
              className="bg-white rounded-xl border border-gray-200 overflow-hidden"
            >
              {/* Chain Header */}
              <button
                onClick={() => toggle(chain.id)}
                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50"
              >
                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium text-gray-800 capitalize">
                    {chain.platform}
                  </span>
                  <span className="text-xs text-gray-500">
                    {new Date(chain.periodStart).toLocaleDateString()}
                    {chain.periodStart !== chain.periodEnd &&
                      ` — ${new Date(chain.periodEnd).toLocaleDateString()}`}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {/* L1 → L2 → L3 Flow */}
                  <div className="flex items-center gap-1 text-xs">
                    <span
                      className={`px-2 py-0.5 rounded ${chain.level1.orderCount > 0 ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-400"}`}
                    >
                      L1: {chain.level1.orderCount} orders
                    </span>
                    <span className="text-gray-300">→</span>
                    <span
                      className={`px-2 py-0.5 rounded ${chain.level2.payout ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-400"}`}
                    >
                      L2:{" "}
                      {chain.level2.payout
                        ? formatCurrency(chain.level2.payout.netAmount)
                        : "—"}
                    </span>
                    <span className="text-gray-300">→</span>
                    <span
                      className={`px-2 py-0.5 rounded ${chain.level3.bankTransaction ? "bg-teal-100 text-teal-700" : "bg-gray-100 text-gray-400"}`}
                    >
                      L3:{" "}
                      {chain.level3.bankTransaction
                        ? formatCurrency(chain.level3.bankTransaction.amount)
                        : "—"}
                    </span>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[chain.status] || STATUS_COLORS.unreconciled}`}
                  >
                    {chain.status.replace(/_/g, " ")}
                  </span>
                  <span className="text-gray-400 text-sm">
                    {expanded.has(chain.id) ? "▾" : "▸"}
                  </span>
                </div>
              </button>

              {/* Expanded Detail */}
              {expanded.has(chain.id) && (
                <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                  <div className="grid grid-cols-3 gap-4 text-xs">
                    {/* L1 Detail */}
                    <div>
                      <p className="font-medium text-gray-600 mb-2">
                        Level 1: Orders ({chain.level1.orderCount})
                      </p>
                      <p className="text-gray-800 font-medium mb-2">
                        Total: {formatCurrency(chain.level1.totalAmount)}
                      </p>
                      {chain.level1.orders.length > 0 && (
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                          {chain.level1.orders.slice(0, 20).map((o) => (
                            <div
                              key={o.id}
                              className="flex justify-between text-gray-600"
                            >
                              <span>{o.orderId.slice(0, 12)}...</span>
                              <span>{formatCurrency(o.netPayout)}</span>
                            </div>
                          ))}
                          {chain.level1.orders.length > 20 && (
                            <p className="text-gray-400">
                              +{chain.level1.orders.length - 20} more
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    {/* L2 Detail */}
                    <div>
                      <p className="font-medium text-gray-600 mb-2">
                        Level 2: Payout
                      </p>
                      {chain.level2.payout ? (
                        <>
                          <p className="text-gray-800">
                            Gross: {formatCurrency(chain.level2.payout.grossAmount)}
                          </p>
                          <p className="text-gray-800">
                            Fees: {formatCurrency(chain.level2.payout.fees)}
                          </p>
                          <p className="text-gray-800 font-medium">
                            Net: {formatCurrency(chain.level2.payout.netAmount)}
                          </p>
                          <p className="text-gray-500 mt-1">
                            {new Date(chain.level2.payout.date).toLocaleDateString()}
                          </p>
                          {chain.l1L2Variance !== null && (
                            <p
                              className={`mt-2 font-medium ${Math.abs(chain.l1L2Variance) <= 1 ? "text-emerald-600" : "text-red-600"}`}
                            >
                              L1→L2 variance:{" "}
                              {formatCurrency(chain.l1L2Variance)}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-gray-400">No payout record</p>
                      )}
                    </div>
                    {/* L3 Detail */}
                    <div>
                      <p className="font-medium text-gray-600 mb-2">
                        Level 3: Bank
                      </p>
                      {chain.level3.bankTransaction ? (
                        <>
                          <p className="text-gray-800 font-medium">
                            {formatCurrency(chain.level3.bankTransaction.amount)}
                          </p>
                          <p className="text-gray-600 truncate">
                            {chain.level3.bankTransaction.description}
                          </p>
                          <p className="text-gray-500">
                            {new Date(chain.level3.bankTransaction.date).toLocaleDateString()}
                          </p>
                          {chain.l2L3Variance !== null && (
                            <p
                              className={`mt-2 font-medium ${Math.abs(chain.l2L3Variance) <= 1 ? "text-emerald-600" : "text-red-600"}`}
                            >
                              L2→L3 variance:{" "}
                              {formatCurrency(chain.l2L3Variance)}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-gray-400">No bank deposit linked</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alerts Tab
// ---------------------------------------------------------------------------

const SEVERITY_STYLES: Record<string, { bg: string; icon: string }> = {
  error: { bg: "bg-red-50 border-red-200", icon: "text-red-600" },
  warning: { bg: "bg-amber-50 border-amber-200", icon: "text-amber-600" },
  info: { bg: "bg-blue-50 border-blue-200", icon: "text-blue-600" },
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  payout_mismatch: "Payout Mismatch",
  deposit_mismatch: "Deposit Mismatch",
  missing_payout: "Missing Payout",
  missing_deposit: "Missing Deposit",
  duplicate_suspected: "Suspected Duplicate",
};

function AlertsTab({
  alerts,
  onResolve,
}: {
  alerts: Alert[];
  onResolve: (id: string) => void;
}) {
  if (alerts.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg">No active alerts</p>
        <p className="mt-2">
          Run reconciliation to detect discrepancies and missing records.
        </p>
      </div>
    );
  }

  // Group by severity
  const grouped = {
    error: alerts.filter((a) => a.severity === "error"),
    warning: alerts.filter((a) => a.severity === "warning"),
    info: alerts.filter((a) => a.severity === "info"),
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-gray-700">
        Active Alerts ({alerts.length})
      </h3>

      {(["error", "warning", "info"] as const).map((severity) =>
        grouped[severity].length > 0 ? (
          <div key={severity} className="space-y-2">
            <p className="text-xs font-medium text-gray-500 uppercase">
              {severity} ({grouped[severity].length})
            </p>
            {grouped[severity].map((alert) => {
              const style =
                SEVERITY_STYLES[severity] || SEVERITY_STYLES.info;
              return (
                <div
                  key={alert.id}
                  className={`border rounded-lg p-4 flex items-start justify-between gap-4 ${style.bg}`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full bg-white ${style.icon}`}
                      >
                        {ALERT_TYPE_LABELS[alert.type] || alert.type}
                      </span>
                      {alert.platform && (
                        <span className="text-xs text-gray-500 capitalize">
                          {alert.platform}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-800">{alert.message}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(alert.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <button
                    onClick={() => onResolve(alert.id)}
                    className="px-3 py-1 text-xs border border-gray-300 rounded-lg hover:bg-white"
                  >
                    Resolve
                  </button>
                </div>
              );
            })}
          </div>
        ) : null
      )}
    </div>
  );
}
