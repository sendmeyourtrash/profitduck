"use client";

import { useEffect, useState } from "react";

interface ImportRecord {
  id: string;
  source: string;
  fileName: string;
  importedAt: string;
  rowsProcessed: number;
  rowsFailed: number;
  status: string;
  errorMessage: string | null;
}

export default function ImportsPage() {
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/imports")
      .then((r) => r.json())
      .then((data) => setImports(data.imports))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (imports.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg">No imports yet</p>
        <p className="mt-2">Upload your first file to see import history.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr className="text-left text-gray-500">
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3 font-medium">Source</th>
            <th className="px-4 py-3 font-medium">File Name</th>
            <th className="px-4 py-3 font-medium text-right">
              Rows Processed
            </th>
            <th className="px-4 py-3 font-medium text-right">Failed</th>
            <th className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {imports.map((imp) => (
            <tr
              key={imp.id}
              className="border-t border-gray-100 hover:bg-gray-50"
            >
              <td className="px-4 py-2.5 text-gray-600">
                {new Date(imp.importedAt).toLocaleString()}
              </td>
              <td className="px-4 py-2.5">
                <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                  {imp.source}
                </span>
              </td>
              <td className="px-4 py-2.5 text-gray-800">{imp.fileName}</td>
              <td className="px-4 py-2.5 text-right text-gray-600">
                {imp.rowsProcessed}
              </td>
              <td className="px-4 py-2.5 text-right">
                {imp.rowsFailed > 0 ? (
                  <span className="text-red-600">{imp.rowsFailed}</span>
                ) : (
                  <span className="text-gray-400">0</span>
                )}
              </td>
              <td className="px-4 py-2.5">
                <span
                  className={`px-2 py-0.5 rounded-full text-xs ${
                    imp.status === "completed"
                      ? "bg-emerald-100 text-emerald-700"
                      : imp.status === "failed"
                        ? "bg-red-100 text-red-700"
                        : imp.status === "processing"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {imp.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
