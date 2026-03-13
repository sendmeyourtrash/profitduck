"use client";

import { useEffect, useState, useCallback } from "react";
import { formatCurrency } from "@/lib/utils/format";
import FilterBar, {
  FilterState,
  emptyFilters,
} from "@/components/filters/FilterBar";

interface Transaction {
  id: string;
  date: string;
  amount: number;
  type: string;
  sourcePlatform: string;
  category: string;
  description: string;
  isManual: boolean;
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [page, setPage] = useState(0);
  const limit = 50;

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
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className="border-t border-gray-100 hover:bg-gray-50"
                  >
                    <td className="px-4 py-2.5 text-gray-600">
                      {new Date(tx.date).toLocaleDateString()}
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
                ))}
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
