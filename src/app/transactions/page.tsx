"use client";

import { useEffect, useState, useCallback } from "react";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils/format";
import FilterBar, {
  FilterState,
  emptyFilters,
} from "@/components/filters/FilterBar";

interface AuditLog {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
  actor: string;
  createdAt: string;
}

interface Transaction {
  id: string;
  date: string;
  amount: number;
  type: string;
  sourcePlatform: string;
  category: string;
  description: string;
  isManual: boolean;
  rawSourceId: string | null;
  rawData: string | null;
  reconciliationStatus: string;
  createdAt: string;
  import: {
    source: string;
    fileName: string;
    importedAt: string;
  } | null;
  linkedPayout: {
    id: string;
    platform: string;
    payoutDate: string;
    grossAmount: number;
    fees: number;
    netAmount: number;
    reconciliationStatus: string;
  } | null;
  linkedBankTransaction: {
    id: string;
    date: string;
    description: string;
    amount: number;
    category: string | null;
    accountName: string | null;
    institutionName: string | null;
    reconciliationStatus: string;
  } | null;
  auditLogs: AuditLog[];
}

const RECON_STYLES: Record<string, string> = {
  reconciled: "bg-emerald-100 text-emerald-700",
  partial: "bg-amber-100 text-amber-700",
  discrepancy: "bg-red-100 text-red-700",
  unreconciled: "bg-gray-100 text-gray-600",
};

function DetailField({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div>
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="text-sm text-gray-800 mt-0.5">{value}</dd>
    </div>
  );
}

function ExpandedRow({ tx }: { tx: Transaction }) {
  const [showRaw, setShowRaw] = useState(false);

  const hasImport = !!tx.import;
  const hasPayout = !!tx.linkedPayout;
  const hasBankTx = !!tx.linkedBankTransaction;
  const hasAudit = tx.auditLogs && tx.auditLogs.length > 0;
  const hasRaw = !!tx.rawData;

  let parsedRaw: string | null = null;
  if (hasRaw) {
    try {
      parsedRaw = JSON.stringify(JSON.parse(tx.rawData!), null, 2);
    } catch {
      parsedRaw = tx.rawData;
    }
  }

  return (
    <td colSpan={6} className="px-4 py-4 bg-gray-50/70">
      <div className="space-y-4">
        {/* Details Section */}
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Details
          </h4>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
            <DetailField label="Transaction ID" value={tx.id.slice(0, 8) + "..."} />
            <DetailField
              label="Reconciliation"
              value={
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    RECON_STYLES[tx.reconciliationStatus] || RECON_STYLES.unreconciled
                  }`}
                >
                  {tx.reconciliationStatus}
                </span>
              }
            />
            <DetailField
              label="Source ID"
              value={tx.rawSourceId}
            />
            <DetailField
              label="Added"
              value={formatDateTime(tx.createdAt)}
            />
          </dl>
        </div>

        {/* Import Source */}
        {hasImport && (
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Import Source
            </h4>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
              <DetailField label="File" value={tx.import!.fileName} />
              <DetailField
                label="Source"
                value={
                  <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                    {tx.import!.source}
                  </span>
                }
              />
              <DetailField
                label="Imported"
                value={formatDateTime(tx.import!.importedAt)}
              />
            </dl>
          </div>
        )}

        {/* Linked Payout */}
        {hasPayout && (
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Linked Payout
            </h4>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
              <DetailField
                label="Platform"
                value={tx.linkedPayout!.platform}
              />
              <DetailField
                label="Payout Date"
                value={formatDate(tx.linkedPayout!.payoutDate)}
              />
              <DetailField
                label="Gross"
                value={formatCurrency(tx.linkedPayout!.grossAmount)}
              />
              <DetailField
                label="Fees"
                value={formatCurrency(tx.linkedPayout!.fees)}
              />
              <DetailField
                label="Net"
                value={
                  <span className="font-medium text-emerald-700">
                    {formatCurrency(tx.linkedPayout!.netAmount)}
                  </span>
                }
              />
              <DetailField
                label="Status"
                value={
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      RECON_STYLES[tx.linkedPayout!.reconciliationStatus] ||
                      RECON_STYLES.unreconciled
                    }`}
                  >
                    {tx.linkedPayout!.reconciliationStatus}
                  </span>
                }
              />
            </dl>
          </div>
        )}

        {/* Linked Bank Transaction */}
        {hasBankTx && (
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Linked Bank Transaction
            </h4>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
              <DetailField
                label="Date"
                value={formatDate(tx.linkedBankTransaction!.date)}
              />
              <DetailField
                label="Description"
                value={tx.linkedBankTransaction!.description}
              />
              <DetailField
                label="Amount"
                value={formatCurrency(tx.linkedBankTransaction!.amount)}
              />
              <DetailField
                label="Institution"
                value={tx.linkedBankTransaction!.institutionName}
              />
              <DetailField
                label="Account"
                value={tx.linkedBankTransaction!.accountName}
              />
              <DetailField
                label="Category"
                value={tx.linkedBankTransaction!.category}
              />
            </dl>
          </div>
        )}

        {/* Audit History */}
        {hasAudit && (
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Change History
            </h4>
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-100">
                  <tr className="text-left text-gray-500">
                    <th className="px-3 py-1.5 font-medium">Field</th>
                    <th className="px-3 py-1.5 font-medium">Old Value</th>
                    <th className="px-3 py-1.5 font-medium">New Value</th>
                    <th className="px-3 py-1.5 font-medium">Reason</th>
                    <th className="px-3 py-1.5 font-medium">By</th>
                    <th className="px-3 py-1.5 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {tx.auditLogs.map((log) => (
                    <tr
                      key={log.id}
                      className="border-t border-gray-100"
                    >
                      <td className="px-3 py-1.5 text-gray-700 font-medium">
                        {log.field}
                      </td>
                      <td className="px-3 py-1.5 text-red-600 line-through">
                        {log.oldValue || "—"}
                      </td>
                      <td className="px-3 py-1.5 text-emerald-700">
                        {log.newValue || "—"}
                      </td>
                      <td className="px-3 py-1.5 text-gray-500">
                        {log.reason || "—"}
                      </td>
                      <td className="px-3 py-1.5 text-gray-500">{log.actor}</td>
                      <td className="px-3 py-1.5 text-gray-500">
                        {formatDateTime(log.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Raw Data */}
        {hasRaw && (
          <div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowRaw(!showRaw);
              }}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
            >
              <span>{showRaw ? "▾" : "▸"}</span>
              Raw Import Data
            </button>
            {showRaw && (
              <pre className="mt-2 p-3 bg-gray-900 text-gray-200 text-xs rounded-lg overflow-x-auto max-h-64">
                {parsedRaw}
              </pre>
            )}
          </div>
        )}
      </div>
    </td>
  );
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const limit = 50;

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const fetchData = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    filters.types.forEach((t) => params.append("types", t));
    filters.platforms.forEach((p) => params.append("platforms", p));
    filters.categories.forEach((c) => params.append("categories", c));
    if (filters.startDate) params.set("startDate", filters.startDate);
    if (filters.endDate) params.set("endDate", filters.endDate);
    if (filters.search) params.set("search", filters.search);
    params.set("limit", String(limit));
    params.set("offset", String(page * limit));

    fetch(`/api/transactions?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setTransactions(data.transactions);
        setTotal(data.total);
      })
      .finally(() => setLoading(false));
  }, [filters, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Collapse all when changing pages or filters
  useEffect(() => {
    setExpanded(new Set());
  }, [filters, page]);

  const handleFilterChange = useCallback((newFilters: FilterState) => {
    setFilters(newFilters);
    setPage(0);
  }, []);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      <FilterBar
        filters={filters}
        onChange={handleFilterChange}
        extraContent={
          <span className="text-sm text-gray-400 ml-auto">
            {total.toLocaleString()} records
          </span>
        }
      />

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
          </div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-12 text-gray-500 text-sm">
            No transactions found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-gray-500">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Description</th>
                  <th className="px-4 py-3 font-medium">Platform</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const isExpanded = expanded.has(tx.id);
                  return (
                    <>
                      <tr
                        key={tx.id}
                        className={`border-t border-gray-100 cursor-pointer transition-colors ${
                          isExpanded
                            ? "bg-indigo-50/50"
                            : "hover:bg-gray-50"
                        }`}
                        onClick={() => toggleExpand(tx.id)}
                      >
                        <td className="px-4 py-2.5 text-gray-600">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className={`text-xs text-gray-400 transition-transform ${
                                isExpanded ? "rotate-90" : ""
                              }`}
                            >
                              ▸
                            </span>
                            {formatDate(tx.date)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-800 max-w-xs truncate">
                          {tx.description || "-"}
                          {tx.isManual && (
                            <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-purple-100 text-purple-700">
                              manual
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                            {tx.sourcePlatform}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">
                          {tx.category || "-"}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs ${
                              tx.type === "income"
                                ? "bg-emerald-100 text-emerald-700"
                                : tx.type === "fee"
                                  ? "bg-amber-100 text-amber-700"
                                  : tx.type === "expense"
                                    ? "bg-red-100 text-red-700"
                                    : tx.type === "adjustment"
                                      ? "bg-purple-100 text-purple-700"
                                      : "bg-blue-100 text-blue-700"
                            }`}
                          >
                            {tx.type}
                          </span>
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right font-medium ${
                            tx.type === "income"
                              ? "text-emerald-600"
                              : "text-gray-800"
                          }`}
                        >
                          {formatCurrency(tx.amount)}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${tx.id}-detail`} className="border-t border-gray-100">
                          <ExpandedRow tx={tx} />
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="border-t border-gray-100 px-4 py-3 flex items-center justify-between">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-gray-400">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
