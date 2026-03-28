"use client";

import { useState, useEffect } from "react";

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

export default function ImportHistoryPage() {
  const [importHistory, setImportHistory] = useState<ImportRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/imports")
      .then((r) => r.json())
      .then((data) => setImportHistory(data.imports || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      ) : importHistory.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <p className="text-lg">No imports yet</p>
          <p className="mt-2 text-sm">Upload your first file to see import history.</p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/50">
            <tr className="text-left text-gray-500 dark:text-gray-400">
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
              <tr key={imp.id} className="border-t border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                  {new Date(imp.importedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  <span className="text-gray-400 dark:text-gray-500 ml-1 text-xs">
                    {new Date(imp.importedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                    {imp.source}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200 max-w-[200px] truncate">{imp.fileName}</td>
                <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{imp.rowsProcessed.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right">
                  {imp.rowsSkipped > 0 ? (
                    <span className="text-amber-600 dark:text-amber-400">{imp.rowsSkipped.toLocaleString()}</span>
                  ) : (
                    <span className="text-gray-400 dark:text-gray-500">0</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {imp.rowsFailed > 0 ? (
                    <span className="text-red-600 dark:text-red-400">{imp.rowsFailed}</span>
                  ) : (
                    <span className="text-gray-400 dark:text-gray-500">0</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${
                    imp.status === "completed"
                      ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                      : imp.status === "failed"
                        ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                        : imp.status === "processing"
                          ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
                          : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
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
  );
}
