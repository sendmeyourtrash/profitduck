"use client";

import { useEffect, useState, useCallback } from "react";

const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface ClosedDay {
  id: string;
  date: string;
  reason: string | null;
  autoDetected: boolean;
}

interface DetectedDay {
  date: string;
  dayOfWeek: string;
}

export default function ClosedDaysPanel() {
  const [closedDays, setClosedDays] = useState<ClosedDay[]>([]);
  const [detectedDays, setDetectedDays] = useState<DetectedDay[]>([]);
  const [loading, setLoading] = useState(false);
  const [addDate, setAddDate] = useState("");
  const [addReason, setAddReason] = useState("");

  const fetchClosedDays = useCallback(async (detect = false) => {
    setLoading(true);
    const url = detect ? "/api/closed-days?detect=true" : "/api/closed-days";
    const res = await fetch(url);
    const data = await res.json();
    setClosedDays(
      (data.closedDays || []).map((cd: ClosedDay) => ({
        ...cd,
        date: new Date(cd.date).toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
      }))
    );
    if (detect && data.detected) setDetectedDays(data.detected);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchClosedDays();
  }, [fetchClosedDays]);

  const addClosedDay = async (date: string, reason?: string, autoDetected?: boolean) => {
    await fetch("/api/closed-days", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, reason, autoDetected }),
    });
    fetchClosedDays();
    setDetectedDays((prev) => prev.filter((d) => d.date !== date));
  };

  const removeClosedDay = async (date: string) => {
    await fetch("/api/closed-days", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date }),
    });
    fetchClosedDays();
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-500">
          Closed Days Management
        </h3>
        <button
          onClick={() => fetchClosedDays(true)}
          disabled={loading}
          className="px-3 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? "Detecting..." : "Auto-detect Closed Days"}
        </button>
      </div>

      {/* Auto-detected candidates */}
      {detectedDays.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-amber-700 mb-2">
            Detected {detectedDays.length} potential closed days
          </h4>
          <div className="max-h-64 overflow-y-auto border border-amber-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-amber-50">
                <tr className="text-left text-gray-500 border-b border-amber-200">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Day</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {detectedDays.map((d) => (
                  <tr key={d.date} className="border-b border-amber-100">
                    <td className="px-3 py-2 text-gray-800">{d.date}</td>
                    <td className="px-3 py-2 text-gray-600">{d.dayOfWeek}</td>
                    <td className="px-3 py-2 text-right space-x-2">
                      <button
                        onClick={() => addClosedDay(d.date, undefined, true)}
                        className="text-xs px-2 py-1 bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setDetectedDays((prev) => prev.filter((x) => x.date !== d.date))}
                        className="text-xs px-2 py-1 bg-gray-100 text-gray-500 rounded hover:bg-gray-200"
                      >
                        Dismiss
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={async () => {
                for (const d of detectedDays) {
                  await addClosedDay(d.date, undefined, true);
                }
                setDetectedDays([]);
                fetchClosedDays();
              }}
              className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
            >
              Confirm All ({detectedDays.length})
            </button>
            <button
              onClick={() => setDetectedDays([])}
              className="text-xs px-3 py-1.5 bg-gray-200 text-gray-600 rounded-lg hover:bg-gray-300"
            >
              Dismiss All
            </button>
          </div>
        </div>
      )}

      {/* Add closed day manually */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 mb-2">Add Closed Day</h4>
        <div className="flex gap-2 items-end">
          <div>
            <label className="text-xs text-gray-500">Date</label>
            <input
              type="date"
              value={addDate}
              onChange={(e) => setAddDate(e.target.value)}
              className="block mt-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs text-gray-500">Reason (optional)</label>
            <input
              type="text"
              value={addReason}
              onChange={(e) => setAddReason(e.target.value)}
              placeholder="Holiday, maintenance..."
              className="block mt-1 w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <button
            onClick={() => {
              if (addDate) {
                addClosedDay(addDate, addReason || undefined);
                setAddDate("");
                setAddReason("");
              }
            }}
            disabled={!addDate}
            className="px-3 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      {/* Confirmed closed days */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 mb-2">
          Confirmed Closed Days ({closedDays.length})
        </h4>
        {closedDays.length === 0 ? (
          <p className="text-gray-400 text-sm py-4 text-center">
            No closed days configured. Click &ldquo;Auto-detect&rdquo; to find days with zero income.
          </p>
        ) : (
          <div className="max-h-80 overflow-y-auto border border-gray-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="text-left text-gray-500 border-b">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Day</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {closedDays.map((cd) => {
                  const d = new Date(cd.date + "T12:00:00-05:00");
                  return (
                    <tr key={cd.id} className="border-b border-gray-50">
                      <td className="px-3 py-2 text-gray-800">{cd.date}</td>
                      <td className="px-3 py-2 text-gray-600">{DOW_NAMES[d.getDay()]}</td>
                      <td className="px-3 py-2 text-gray-600">{cd.reason || "-"}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${cd.autoDetected ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                          {cd.autoDetected ? "auto" : "manual"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => removeClosedDay(cd.date)}
                          className="text-xs px-2 py-1 bg-red-100 text-red-600 rounded hover:bg-red-200"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
