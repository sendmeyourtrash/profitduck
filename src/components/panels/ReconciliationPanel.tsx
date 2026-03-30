"use client";

import { useEffect, useState, useCallback } from "react";
import StatCard from "@/components/charts/StatCard";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { ProgressState } from "@/components/ui/ProgressBar";
import { useProgressStream } from "@/hooks/useProgressStream";
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

export default function ReconciliationPanel() {
  const [tab, setTab] = useState<TabKey>("overview");
  const [data, setData] = useState<ReconciliationData | null>(null);
  const [chains, setChains] = useState<Chain[]>([]);
  const [loading, setLoading] = useState(true);
  const [matching, setMatching] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [reconOperationId, setReconOperationId] = useState<string | null>(null);
  const [reconProgress, setReconProgress] = useState<ProgressState | null>(null);
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
        // Transform flat ReconMatch rows into nested Chain structure
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setChains((chainData.chains || []).map((m: any) => ({
          id: String(m.id),
          platform: m.platform,
          periodStart: m.order_group_start,
          periodEnd: m.order_group_end,
          status: m.status,
          level1: {
            orderCount: m.order_count || 0,
            totalAmount: m.expected_amount || 0,
            orders: [],
          },
          level2: {
            payout: m.bank_tx_id ? {
              id: String(m.bank_tx_id),
              grossAmount: m.bank_amount || 0,
              fees: 0,
              netAmount: m.bank_amount || 0,
              date: m.bank_date || "",
            } : null,
          },
          level3: {
            bankTransaction: m.bank_tx_id ? {
              id: String(m.bank_tx_id),
              amount: m.bank_amount || 0,
              date: m.bank_date || "",
              description: "",
            } : null,
            variance: m.variance || 0,
          },
        })));
      })
      .finally(() => setLoading(false));
  }, [chainPlatform]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // SSE progress stream for reconciliation
  useProgressStream(
    reconOperationId,
    (progress) => setReconProgress(progress),
    (progress) => {
      // Show "Complete" briefly before clearing the progress bar
      setReconProgress({
        phase: "done",
        current: 6,
        total: 6,
        message: "Reconciliation complete",
        done: true,
      });
      setReconOperationId(null);

      if (progress.error) {
        setReconProgress(null);
        setRunning(false);
        setRunResult(progress.error);
        loadData();
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = progress.result as any;
        // Keep the completed bar visible for a moment, then fade to result
        setTimeout(() => {
          setReconProgress(null);
          setRunning(false);
          if (result) {
            setRunResult(
              `L1→L2: ${result.l1l2.matched} matched, ${result.l1l2.discrepancies} discrepancies | L2→L3: ${result.l2l3AutoMatched} auto-matched | ${result.newAlerts} new alerts`
            );
          }
          loadData();
        }, 800);
      }
    }
  );

  const handleRunReconciliation = async () => {
    setRunning(true);
    setRunResult(null);
    // Show progress bar immediately with an "initializing" state
    setReconProgress({
      phase: "starting",
      current: 0,
      total: 6,
      message: "Starting reconciliation…",
      done: false,
    });
    try {
      const res = await fetch("/api/reconciliation/run", { method: "POST" });
      const { operationId } = await res.json();
      setReconOperationId(operationId);
    } catch {
      setReconProgress(null);
      setRunResult("Reconciliation failed");
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
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {t.label}
            {t.key === "alerts" && unresolvedAlerts.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-full text-xs">
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
          progress={reconProgress}
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
  progress,
}: {
  summary: Summary;
  onRun: () => void;
  running: boolean;
  runResult: string | null;
  progress: ProgressState | null;
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

      {progress && (
        <div className="mt-2">
          <ProgressBar progress={progress} />
        </div>
      )}

      {runResult && (
        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700/50 rounded-lg p-3 text-sm text-blue-800 dark:text-blue-300">
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
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 dark:border-gray-700 p-6">
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
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">
                      Platform Payout
                    </p>
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 dark:text-gray-200">
                      {s.payoutPlatform} - {formatCurrency(s.payoutAmount)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {new Date(s.payoutDate).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">Bank Deposit</p>
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 dark:text-gray-200">
                      {formatCurrency(s.bankAmount)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
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
                            : "bg-gray-100 text-gray-600 dark:text-gray-400"
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
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 dark:border-gray-700 p-6">
          <h3 className="text-sm font-medium text-gray-700 mb-4">
            Reconciled Pairs ({data.reconciledPairs.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 dark:text-gray-500 border-b dark:border-gray-700">
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
                    <td className="py-2 text-gray-800 dark:text-gray-200">{pair.platform}</td>
                    <td className="py-2 text-gray-600 dark:text-gray-400">
                      {new Date(pair.payoutDate).toLocaleDateString()}
                    </td>
                    <td className="py-2 text-right font-medium">
                      {formatCurrency(pair.payoutAmount)}
                    </td>
                    <td className="py-2 text-gray-600 dark:text-gray-400">
                      {pair.bankDate
                        ? new Date(pair.bankDate).toLocaleDateString()
                        : "-"}
                    </td>
                    <td className="py-2 text-gray-600 dark:text-gray-400">
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
  unreconciled: "bg-gray-100 text-gray-600 dark:text-gray-400",
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
          className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5"
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
              className="bg-white rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
            >
              {/* Chain Header */}
              <button
                onClick={() => toggle(chain.id)}
                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-700/30"
              >
                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200 capitalize">
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
                      className={`px-2 py-0.5 rounded ${chain.level1.orderCount > 0 ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400" : "bg-gray-100 text-gray-400"}`}
                    >
                      L1: {chain.level1.orderCount} orders
                    </span>
                    <span className="text-gray-300">→</span>
                    <span
                      className={`px-2 py-0.5 rounded ${chain.level2.payout ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400" : "bg-gray-100 text-gray-400"}`}
                    >
                      L2:{" "}
                      {chain.level2.payout
                        ? formatCurrency(chain.level2.payout.netAmount)
                        : "—"}
                    </span>
                    <span className="text-gray-300">→</span>
                    <span
                      className={`px-2 py-0.5 rounded ${chain.level3.bankTransaction ? "bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400" : "bg-gray-100 text-gray-400"}`}
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
                <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 bg-gray-50 dark:bg-gray-800">
                  <div className="grid grid-cols-3 gap-4 text-xs">
                    {/* L1 Detail */}
                    <div>
                      <p className="font-medium text-gray-600 dark:text-gray-400 mb-2">
                        Level 1: Orders ({chain.level1.orderCount})
                      </p>
                      <p className="text-gray-800 dark:text-gray-200 font-medium mb-2">
                        Total: {formatCurrency(chain.level1.totalAmount)}
                      </p>
                      {chain.level1.orders.length > 0 && (
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                          {chain.level1.orders.slice(0, 20).map((o) => (
                            <div
                              key={o.id}
                              className="flex justify-between text-gray-600 dark:text-gray-400"
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
                      <p className="font-medium text-gray-600 dark:text-gray-400 mb-2">
                        Level 2: Payout
                      </p>
                      {chain.level2.payout ? (
                        <>
                          <p className="text-gray-800 dark:text-gray-200">
                            Gross: {formatCurrency(chain.level2.payout.grossAmount)}
                          </p>
                          <p className="text-gray-800 dark:text-gray-200">
                            Fees: {formatCurrency(chain.level2.payout.fees)}
                          </p>
                          <p className="text-gray-800 dark:text-gray-200 font-medium">
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
                      <p className="font-medium text-gray-600 dark:text-gray-400 mb-2">
                        Level 3: Bank
                      </p>
                      {chain.level3.bankTransaction ? (
                        <>
                          <p className="text-gray-800 dark:text-gray-200 font-medium">
                            {formatCurrency(chain.level3.bankTransaction.amount)}
                          </p>
                          <p className="text-gray-600 dark:text-gray-400 truncate">
                            {chain.level3.bankTransaction.description}
                          </p>
                          <p className="text-gray-500 dark:text-gray-400">
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

/* eslint-disable @typescript-eslint/no-explicit-any */

function AlertDetailRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500">{label}:</span>
      <span className={`text-xs font-medium ${highlight ? "text-red-700" : "text-gray-800 dark:text-gray-200"}`}>{value}</span>
    </div>
  );
}

function AlertSummary({ alert }: { alert: Alert }) {
  if (!alert.details) return null;

  try {
    const d = JSON.parse(alert.details);

    switch (alert.type) {
      case "payout_mismatch":
        return (
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 bg-white/60 dark:bg-gray-700/40 rounded-md px-3 py-2">
            <AlertDetailRow label="Payout" value={`$${Number(d.payoutAmount).toFixed(2)}`} />
            <AlertDetailRow label="Expected (orders)" value={`$${Number(d.expectedAmount).toFixed(2)}`} />
            <AlertDetailRow label="Variance" value={`$${Number(d.variance).toFixed(2)}`} highlight={Math.abs(d.variance) > 10} />
          </div>
        );
      case "deposit_mismatch":
        return (
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 bg-white/60 dark:bg-gray-700/40 rounded-md px-3 py-2">
            <AlertDetailRow label="Payout amount" value={`$${Number(d.payoutAmount).toFixed(2)}`} />
            <AlertDetailRow label="Bank deposit" value={`$${Number(d.bankAmount).toFixed(2)}`} />
            <AlertDetailRow label="Difference" value={`$${Number(d.difference).toFixed(2)}`} highlight={d.difference > 10} />
          </div>
        );
      case "missing_payout":
        return (
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 bg-white/60 dark:bg-gray-700/40 rounded-md px-3 py-2">
            <AlertDetailRow label="Unlinked orders" value={String(d.orderCount)} />
            <AlertDetailRow label="Total amount" value={`$${Number(d.totalAmount).toFixed(2)}`} highlight />
          </div>
        );
      case "missing_deposit":
        return (
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 bg-white/60 dark:bg-gray-700/40 rounded-md px-3 py-2">
            <AlertDetailRow label="Payout amount" value={`$${Number(d.netAmount).toFixed(2)}`} />
            {d.payoutDate && (
              <AlertDetailRow label="Payout date" value={new Date(d.payoutDate).toLocaleDateString()} />
            )}
            <AlertDetailRow label="Days waiting" value={`${Math.floor((Date.now() - new Date(d.payoutDate || alert.createdAt).getTime()) / 86400000)}d`} highlight />
          </div>
        );
      case "duplicate_suspected":
        return (
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 bg-white/60 dark:bg-gray-700/40 rounded-md px-3 py-2">
            <AlertDetailRow label="Duplicate count" value={`${d.cnt} orders`} highlight />
            <AlertDetailRow label="Amount (each)" value={`$${Number(d.amount).toFixed(2)}`} />
            <AlertDetailRow label="Date" value={d.date} />
          </div>
        );
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// ── Expanded transaction tables for each alert type ──

function MiniTable({ headers, rows, footer }: {
  headers: string[];
  rows: (string | number)[][];
  footer?: (string | number)[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700">
            {headers.map((h) => (
              <th key={h} className="py-1.5 px-2 text-left font-medium text-gray-500 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-white/40 dark:bg-gray-700/20" : ""}>
              {row.map((cell, j) => (
                <td key={j} className="py-1 px-2 text-gray-700 whitespace-nowrap">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot>
            <tr className="border-t border-gray-300 font-medium">
              {footer.map((cell, j) => (
                <td key={j} className="py-1.5 px-2 text-gray-800 dark:text-gray-200 whitespace-nowrap">{cell}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function fmtDate(d: string | Date) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtAmt(n: number) {
  return `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ExpandedAlertContent({ alert, data }: { alert: Alert; data: any }) {
  switch (alert.type) {
    case "payout_mismatch":
    case "deposit_mismatch": {
      const { payout, orders, bankTransaction } = data;
      return (
        <div className="space-y-3">
          {/* Payout info */}
          {payout && (
            <div>
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Payout</p>
              <div className="flex flex-wrap gap-x-5 gap-y-1 bg-white/50 dark:bg-gray-700/30 rounded px-3 py-2 text-xs">
                <span><span className="text-gray-500 dark:text-gray-400">Date:</span> {fmtDate(payout.payoutDate)}</span>
                <span><span className="text-gray-500 dark:text-gray-400">Gross:</span> {fmtAmt(payout.grossAmount)}</span>
                <span><span className="text-gray-500 dark:text-gray-400">Fees:</span> {fmtAmt(payout.fees)}</span>
                <span className="font-medium"><span className="text-gray-500 dark:text-gray-400">Net:</span> {fmtAmt(payout.netAmount)}</span>
                {payout.amountVariance != null && Math.abs(payout.amountVariance) > 1 && (
                  <span className="text-red-700 font-medium">
                    Variance: {payout.amountVariance > 0 ? "+" : ""}{fmtAmt(payout.amountVariance)}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Bank deposit */}
          {bankTransaction && (
            <div>
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Bank Deposit</p>
              <div className="flex flex-wrap gap-x-5 gap-y-1 bg-white/50 dark:bg-gray-700/30 rounded px-3 py-2 text-xs">
                <span><span className="text-gray-500 dark:text-gray-400">Date:</span> {fmtDate(bankTransaction.date)}</span>
                <span className="font-medium"><span className="text-gray-500 dark:text-gray-400">Amount:</span> {fmtAmt(bankTransaction.amount)}</span>
                <span><span className="text-gray-500 dark:text-gray-400">Desc:</span> {(bankTransaction.description || "").slice(0, 60)}</span>
              </div>
            </div>
          )}

          {/* Linked orders */}
          {orders && orders.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Linked Orders ({orders.length})</p>
              <MiniTable
                headers={["Order ID", "Date", "Subtotal", "Fees", "Tip", "Net Payout"]}
                rows={orders.map((o: any) => [
                  o.orderId?.slice(0, 12) || o.id.slice(0, 8),
                  fmtDate(o.orderDatetime),
                  fmtAmt(o.subtotal),
                  fmtAmt((o.commissionFee || 0) + (o.serviceFee || 0) + (o.deliveryFee || 0)),
                  fmtAmt(o.tip || 0),
                  fmtAmt(o.netPayout),
                ])}
                footer={[
                  `${orders.length} orders`,
                  "",
                  fmtAmt(orders.reduce((s: number, o: any) => s + o.subtotal, 0)),
                  fmtAmt(orders.reduce((s: number, o: any) => s + (o.commissionFee || 0) + (o.serviceFee || 0) + (o.deliveryFee || 0), 0)),
                  fmtAmt(orders.reduce((s: number, o: any) => s + (o.tip || 0), 0)),
                  fmtAmt(orders.reduce((s: number, o: any) => s + o.netPayout, 0)),
                ]}
              />
            </div>
          )}
        </div>
      );
    }

    case "missing_payout": {
      const { orders } = data;
      if (!orders || orders.length === 0) {
        return <p className="text-xs text-gray-500 dark:text-gray-400">No unlinked orders found.</p>;
      }
      return (
        <div>
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Unlinked Orders ({orders.length})</p>
          <MiniTable
            headers={["Order ID", "Date", "Platform", "Subtotal", "Net Payout"]}
            rows={orders.map((o: any) => [
              o.orderId?.slice(0, 12) || o.id.slice(0, 8),
              fmtDate(o.orderDatetime),
              o.platform,
              fmtAmt(o.subtotal),
              fmtAmt(o.netPayout),
            ])}
            footer={[
              `${orders.length} orders`,
              "",
              "",
              "",
              fmtAmt(orders.reduce((s: number, o: any) => s + o.netPayout, 0)),
            ]}
          />
        </div>
      );
    }

    case "missing_deposit": {
      const { payout, candidateDeposits } = data;
      return (
        <div className="space-y-3">
          {payout && (
            <div>
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Payout Awaiting Deposit</p>
              <div className="flex flex-wrap gap-x-5 gap-y-1 bg-white/50 dark:bg-gray-700/30 rounded px-3 py-2 text-xs">
                <span><span className="text-gray-500 dark:text-gray-400">Platform:</span> {payout.platform}</span>
                <span><span className="text-gray-500 dark:text-gray-400">Date:</span> {fmtDate(payout.payoutDate)}</span>
                <span><span className="text-gray-500 dark:text-gray-400">Gross:</span> {fmtAmt(payout.grossAmount)}</span>
                <span><span className="text-gray-500 dark:text-gray-400">Fees:</span> {fmtAmt(payout.fees)}</span>
                <span className="font-medium"><span className="text-gray-500 dark:text-gray-400">Net:</span> {fmtAmt(payout.netAmount)}</span>
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Candidate Bank Deposits ({candidateDeposits?.length || 0})
            </p>
            {candidateDeposits && candidateDeposits.length > 0 ? (
              <MiniTable
                headers={["Date", "Amount", "Description", "Account"]}
                rows={candidateDeposits.map((d: any) => [
                  fmtDate(d.date),
                  fmtAmt(d.amount),
                  (d.description || "").slice(0, 50),
                  d.accountName || "",
                ])}
              />
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400 bg-white/50 dark:bg-gray-700/30 rounded px-3 py-2">
                No matching bank deposits found within $2 and 5 days of this payout.
              </p>
            )}
          </div>
        </div>
      );
    }

    case "duplicate_suspected": {
      const { orders } = data;
      if (!orders || orders.length === 0) {
        return <p className="text-xs text-gray-500 dark:text-gray-400">No matching orders found.</p>;
      }
      return (
        <div>
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Potentially Duplicated Orders ({orders.length})</p>
          <MiniTable
            headers={["Order ID", "Date", "Platform", "Net Payout", "Linked Payout?"]}
            rows={orders.map((o: any) => [
              o.orderId?.slice(0, 12) || o.id.slice(0, 8),
              fmtDate(o.orderDatetime),
              o.platform,
              fmtAmt(o.netPayout),
              o.linkedPayoutId ? "Yes" : "No",
            ])}
          />
        </div>
      );
    }

    default:
      return null;
  }
}

function AlertsTab({
  alerts,
  onResolve,
}: {
  alerts: Alert[];
  onResolve: (id: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailsCache, setDetailsCache] = useState<Record<string, any>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleToggle = useCallback(async (alertId: string) => {
    if (expandedId === alertId) {
      setExpandedId(null);
      return;
    }

    setExpandedId(alertId);

    // Fetch details if not cached
    if (!detailsCache[alertId]) {
      setLoadingId(alertId);
      try {
        const res = await fetch(`/api/reconciliation/alerts/${alertId}/details`);
        if (res.ok) {
          const data = await res.json();
          setDetailsCache((prev) => ({ ...prev, [alertId]: data }));
        }
      } catch {
        // silently fail — user sees the summary row instead
      } finally {
        setLoadingId(null);
      }
    }
  }, [expandedId, detailsCache]);

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
              const style = SEVERITY_STYLES[severity] || SEVERITY_STYLES.info;
              const isExpanded = expandedId === alert.id;
              const isLoading = loadingId === alert.id;
              const cachedData = detailsCache[alert.id];

              return (
                <div
                  key={alert.id}
                  className={`border rounded-lg ${style.bg} transition-all`}
                >
                  {/* Header — clickable to expand */}
                  <div
                    className="p-4 cursor-pointer select-none"
                    onClick={() => handleToggle(alert.id)}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {/* Chevron */}
                          <svg
                            className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
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
                          <span className="text-xs text-gray-400 ml-auto">
                            {new Date(alert.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm text-gray-800 dark:text-gray-200 pl-5.5">{alert.message}</p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); onResolve(alert.id); }}
                        className="px-3 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-white shrink-0"
                      >
                        Resolve
                      </button>
                    </div>

                    {/* Summary metrics — always visible */}
                    <div className="pl-5.5">
                      <AlertSummary alert={alert} />
                    </div>
                  </div>

                  {/* Expanded detail section */}
                  {isExpanded && (
                    <div className="border-t border-gray-200 dark:border-gray-700/60 px-4 py-3 bg-white/30">
                      {isLoading ? (
                        <div className="flex items-center gap-2 py-4 justify-center">
                          <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-500" />
                          <span className="text-xs text-gray-500">Loading transactions...</span>
                        </div>
                      ) : cachedData ? (
                        <ExpandedAlertContent alert={alert} data={cachedData} />
                      ) : (
                        <p className="text-xs text-gray-500 dark:text-gray-400 py-2">Unable to load details.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : null
      )}
    </div>
  );
}
