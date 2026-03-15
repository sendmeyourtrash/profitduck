"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils/format";
import FilterBar, {
  FilterState,
  emptyFilters,
} from "@/components/filters/FilterBar";

const ManualEntryPanel = dynamic(
  () => import("@/components/panels/ManualEntryPanel"),
  { loading: () => (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
    </div>
  )}
);

const CategoriesPanel = dynamic(
  () => import("@/components/panels/CategoriesPanel"),
  { loading: () => (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
    </div>
  )}
);

const VendorAliasesPanel = dynamic(
  () => import("@/components/panels/VendorAliasesPanel"),
  { loading: () => (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
    </div>
  )}
);

const MenuItemAliasesPanel = dynamic(
  () => import("@/components/panels/MenuItemAliasesPanel"),
  { loading: () => (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
    </div>
  )}
);

type TransactionsTab = "transactions" | "manual-entry" | "categories" | "vendor-aliases" | "menu-aliases";

interface AuditLog {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
  actor: string;
  createdAt: string;
}

interface OrderItem {
  name: string;
  category: string;
  qty: number;
  price: number;
}

interface OrderDetail {
  cardBrand: string | null;
  diningOption: string | null;
  channel: string | null;
  fulfillmentType: string | null;
  subtotal: number;
  tax: number;
  tip: number;
  fees: number;
  netPayout: number;
  items: OrderItem[] | null;
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
  orderDetail: OrderDetail | null;
}

function getOrderType(tx: Transaction): string | null {
  if (!tx.orderDetail) {
    // Default for delivery platforms even without orderDetail
    if (["doordash", "ubereats", "grubhub"].includes(tx.sourcePlatform)) {
      return "Delivery";
    }
    return null;
  }
  const d = tx.orderDetail;
  if (d.diningOption) return d.diningOption;
  if (d.fulfillmentType) return d.fulfillmentType;
  if (d.channel && d.channel !== "INCREPEABLE") return d.channel;
  // Default for delivery platforms
  if (["doordash", "ubereats", "grubhub"].includes(tx.sourcePlatform)) {
    return "Delivery";
  }
  return null;
}

function getPaymentMethod(tx: Transaction): string | null {
  if (!tx.orderDetail) return null;
  if (tx.orderDetail.cardBrand) return tx.orderDetail.cardBrand;
  // No card brand on a Square order = cash payment
  if (tx.sourcePlatform === "square") return "Cash";
  return null;
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
  const [showMore, setShowMore] = useState(false);

  const hasImport = !!tx.import;
  const hasPayout = !!tx.linkedPayout;
  const hasBankTx = !!tx.linkedBankTransaction;
  const hasAudit = tx.auditLogs && tx.auditLogs.length > 0;
  const hasRaw = !!tx.rawData;
  const od = tx.orderDetail;
  const hasItems = !!(od?.items && od.items.length > 0);

  const orderType = getOrderType(tx);
  const paymentMethod = getPaymentMethod(tx);
  const isPlatformOrder = ["square", "doordash", "ubereats", "grubhub"].includes(tx.sourcePlatform);

  let parsedRaw: string | null = null;
  if (hasRaw) {
    try {
      parsedRaw = JSON.stringify(JSON.parse(tx.rawData!), null, 2);
    } catch {
      parsedRaw = tx.rawData;
    }
  }

  return (
    <td colSpan={8} className="px-0 py-0">
      <div className="bg-gray-50/80 border-t border-gray-100">
        {/* Top summary bar: key info at a glance */}
        {isPlatformOrder && (
          <div className="px-5 py-3 flex items-center gap-6 border-b border-gray-100 bg-white/60">
            {paymentMethod && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Payment</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                  {paymentMethod}
                </span>
              </div>
            )}
            {orderType && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Order</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                  {orderType}
                </span>
              </div>
            )}
            {od && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Subtotal</span>
                  <span className="text-xs font-medium text-gray-700">{formatCurrency(od.subtotal)}</span>
                </div>
                {od.tax > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Tax</span>
                    <span className="text-xs text-gray-600">{formatCurrency(od.tax)}</span>
                  </div>
                )}
                {od.tip > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Tip</span>
                    <span className="text-xs text-emerald-600">{formatCurrency(od.tip)}</span>
                  </div>
                )}
                {od.fees > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Fees</span>
                    <span className="text-xs text-red-500">{formatCurrency(od.fees)}</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5 ml-auto">
                  <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Net Payout</span>
                  <span className="text-sm font-semibold text-emerald-700">{formatCurrency(od.netPayout)}</span>
                </div>
              </>
            )}
          </div>
        )}

        <div className="px-5 py-3 space-y-3">
          {/* Items Ordered */}
          {hasItems && (
            <div>
              <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Items Ordered
              </h4>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-gray-100">
                      <th className="px-3 py-1.5 font-medium">Item</th>
                      <th className="px-3 py-1.5 font-medium">Category</th>
                      <th className="px-3 py-1.5 font-medium text-right">Qty</th>
                      <th className="px-3 py-1.5 font-medium text-right">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {od!.items!.map((item, i) => (
                      <tr key={i} className="border-t border-gray-50">
                        <td className="px-3 py-1.5 text-gray-800 font-medium">{item.name}</td>
                        <td className="px-3 py-1.5">
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-gray-50 text-gray-500">
                            {item.category}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right text-gray-600">{item.qty}</td>
                        <td className="px-3 py-1.5 text-right text-gray-800 font-medium">{formatCurrency(item.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Linked Payout */}
          {hasPayout && (
            <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
              <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Linked Payout
              </h4>
              <div className="flex items-center gap-6 text-xs">
                <span className="text-gray-500">{tx.linkedPayout!.platform}</span>
                <span className="text-gray-500">{formatDate(tx.linkedPayout!.payoutDate)}</span>
                <span className="text-gray-700">Gross {formatCurrency(tx.linkedPayout!.grossAmount)}</span>
                <span className="text-red-500">Fees {formatCurrency(tx.linkedPayout!.fees)}</span>
                <span className="font-medium text-emerald-700">Net {formatCurrency(tx.linkedPayout!.netAmount)}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium ml-auto ${
                    RECON_STYLES[tx.linkedPayout!.reconciliationStatus] ||
                    RECON_STYLES.unreconciled
                  }`}
                >
                  {tx.linkedPayout!.reconciliationStatus}
                </span>
              </div>
            </div>
          )}

          {/* Linked Bank Transaction */}
          {hasBankTx && (
            <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
              <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Linked Bank Transaction
              </h4>
              <div className="flex items-center gap-6 text-xs">
                <span className="text-gray-500">{formatDate(tx.linkedBankTransaction!.date)}</span>
                <span className="text-gray-700 truncate max-w-[200px]">{tx.linkedBankTransaction!.description}</span>
                <span className="font-medium text-gray-800">{formatCurrency(tx.linkedBankTransaction!.amount)}</span>
                {tx.linkedBankTransaction!.institutionName && (
                  <span className="text-gray-400">{tx.linkedBankTransaction!.institutionName}</span>
                )}
                {tx.linkedBankTransaction!.accountName && (
                  <span className="text-gray-400">{tx.linkedBankTransaction!.accountName}</span>
                )}
              </div>
            </div>
          )}

          {/* Collapsible metadata section */}
          <div className="flex items-center gap-4 pt-1">
            <div className="flex items-center gap-3 text-[10px] text-gray-400">
              <span
                className={`px-2 py-0.5 rounded-full font-medium ${
                  RECON_STYLES[tx.reconciliationStatus] || RECON_STYLES.unreconciled
                }`}
              >
                {tx.reconciliationStatus}
              </span>
              {tx.rawSourceId && (
                <span className="font-mono">{tx.rawSourceId.length > 16 ? tx.rawSourceId.slice(0, 16) + "..." : tx.rawSourceId}</span>
              )}
              {hasImport && (
                <span>{tx.import!.source} &middot; {formatDateTime(tx.import!.importedAt)}</span>
              )}
            </div>

            {(hasAudit || hasRaw) && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMore(!showMore);
                }}
                className="text-[10px] text-indigo-500 hover:text-indigo-700 font-medium ml-auto"
              >
                {showMore ? "Less" : "More"}
              </button>
            )}
          </div>

          {/* Expanded metadata */}
          {showMore && (
            <div className="space-y-3 pt-1">
              {hasAudit && (
                <div>
                  <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                    Change History
                  </h4>
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-gray-400 border-b border-gray-100">
                          <th className="px-3 py-1.5 font-medium">Field</th>
                          <th className="px-3 py-1.5 font-medium">Old</th>
                          <th className="px-3 py-1.5 font-medium">New</th>
                          <th className="px-3 py-1.5 font-medium">Reason</th>
                          <th className="px-3 py-1.5 font-medium">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tx.auditLogs.map((log) => (
                          <tr key={log.id} className="border-t border-gray-50">
                            <td className="px-3 py-1.5 text-gray-700 font-medium">{log.field}</td>
                            <td className="px-3 py-1.5 text-red-500 line-through">{log.oldValue || "—"}</td>
                            <td className="px-3 py-1.5 text-emerald-600">{log.newValue || "—"}</td>
                            <td className="px-3 py-1.5 text-gray-400">{log.reason || "—"}</td>
                            <td className="px-3 py-1.5 text-gray-400">{formatDateTime(log.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {hasRaw && (
                <div>
                  <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                    Raw Import Data
                  </h4>
                  <pre className="p-3 bg-gray-900 text-gray-300 text-[10px] rounded-lg overflow-x-auto max-h-48 leading-relaxed">
                    {parsedRaw}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </td>
  );
}

export default function TransactionsPage() {
  const [activeTab, setActiveTab] = useState<TransactionsTab>("transactions");
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
      {/* Tab Bar */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab("transactions")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "transactions"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          }`}
        >
          Transactions
        </button>
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
          onClick={() => setActiveTab("menu-aliases")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "menu-aliases"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          }`}
        >
          Menu Aliases
        </button>
      </div>

      {/* Tab: Manual Entry */}
      {activeTab === "manual-entry" && <ManualEntryPanel />}

      {/* Tab: Categories */}
      {activeTab === "categories" && <CategoriesPanel />}

      {/* Tab: Vendor Aliases */}
      {activeTab === "vendor-aliases" && <VendorAliasesPanel />}

      {/* Tab: Menu Aliases */}
      {activeTab === "menu-aliases" && <MenuItemAliasesPanel />}

      {/* Tab: Transactions */}
      {activeTab === "transactions" && <>
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
                  <th className="px-4 py-3 font-medium">Payment</th>
                  <th className="px-4 py-3 font-medium">Order Type</th>
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
                        <td className="px-4 py-2.5 text-gray-600 text-xs">
                          {getPaymentMethod(tx) || "-"}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600 text-xs capitalize">
                          {getOrderType(tx) || "-"}
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
      </>}
    </div>
  );
}
