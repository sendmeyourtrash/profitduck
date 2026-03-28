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
  const [ignoredDates, setIgnoredDates] = useState<string[]>([]);
  const [ignoredDow, setIgnoredDow] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [addDate, setAddDate] = useState("");
  const [addReason, setAddReason] = useState("");
  const [showIgnored, setShowIgnored] = useState(false);

  const fetchClosedDays = useCallback(async (detect = false) => {
    setLoading(true);
    const url = detect ? "/api/closed-days?detect=true" : "/api/closed-days";
    const res = await fetch(url);
    const data = await res.json();
    setClosedDays(
      (data.closedDays || []).map((cd: ClosedDay) => ({
        ...cd,
        date: cd.date,
      }))
    );
    setIgnoredDates(data.ignoredDates || []);
    setIgnoredDow(data.ignoredDow || []);
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

  const ignoreDate = async (date: string) => {
    await fetch("/api/closed-days", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ignore", date }),
    });
    setDetectedDays((prev) => prev.filter((d) => d.date !== date));
    setIgnoredDates((prev) => [date, ...prev]);
  };

  const unignoreDate = async (date: string) => {
    await fetch("/api/closed-days", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unignore", date }),
    });
    setIgnoredDates((prev) => prev.filter((d) => d !== date));
  };

  const toggleDow = async (dow: number) => {
    const next = ignoredDow.includes(dow)
      ? ignoredDow.filter((d) => d !== dow)
      : [...ignoredDow, dow];
    setIgnoredDow(next);
    await fetch("/api/closed-days", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-ignored-dow", days: next }),
    });
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
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

      {/* Ignore by day-of-week */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Ignore Days of Week</h4>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Auto-detect will skip these days entirely.</p>
        <div className="flex gap-1.5 flex-wrap">
          {DOW_NAMES.map((name, i) => (
            <button
              key={i}
              onClick={() => toggleDow(i)}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${
                ignoredDow.includes(i)
                  ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border border-orange-300 dark:border-orange-700"
                  : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
            >
              {name.slice(0, 3)}
            </button>
          ))}
        </div>
      </div>

      {/* Auto-detected candidates */}
      {detectedDays.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-amber-700 dark:text-amber-400 mb-2">
            Detected {detectedDays.length} potential closed days
          </h4>
          <div className="max-h-64 overflow-y-auto border border-amber-200 dark:border-amber-800 rounded-lg">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-amber-50 dark:bg-amber-900/20">
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-amber-200 dark:border-amber-800">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Day</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {detectedDays.map((d) => (
                  <tr key={d.date} className="border-b border-amber-100 dark:border-amber-900/30">
                    <td className="px-3 py-2 text-gray-800 dark:text-gray-200">{d.date}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{d.dayOfWeek}</td>
                    <td className="px-3 py-2 text-right space-x-2">
                      <button
                        onClick={() => addClosedDay(d.date, undefined, true)}
                        className="text-xs px-2 py-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded hover:bg-emerald-200 dark:hover:bg-emerald-900/50"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => ignoreDate(d.date)}
                        className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                      >
                        Ignore
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
              onClick={async () => {
                for (const d of detectedDays) {
                  await ignoreDate(d.date);
                }
                setDetectedDays([]);
              }}
              className="text-xs px-3 py-1.5 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              Ignore All
            </button>
          </div>
        </div>
      )}

      {/* Add closed day manually */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Add Closed Day</h4>
        <div className="flex gap-2 items-end">
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400">Date</label>
            <input
              type="date"
              value={addDate}
              onChange={(e) => setAddDate(e.target.value)}
              className="block mt-1 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs text-gray-500 dark:text-gray-400">Reason (optional)</label>
            <input
              type="text"
              value={addReason}
              onChange={(e) => setAddReason(e.target.value)}
              placeholder="Holiday, maintenance..."
              className="block mt-1 w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-indigo-500 focus:border-indigo-500"
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
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Confirmed Closed Days ({closedDays.length})
        </h4>
        {closedDays.length === 0 ? (
          <p className="text-gray-400 dark:text-gray-500 text-sm py-4 text-center">
            No closed days configured. Click &ldquo;Auto-detect&rdquo; to find days with zero income.
          </p>
        ) : (
          <div className="max-h-80 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800">
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Day</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {closedDays.map((cd) => {
                  const d = new Date(cd.date + "T12:00:00");
                  return (
                    <tr key={cd.id} className="border-b border-gray-50 dark:border-gray-700/50">
                      <td className="px-3 py-2 text-gray-800 dark:text-gray-200">{cd.date}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{DOW_NAMES[d.getDay()]}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{cd.reason || "-"}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${cd.autoDetected ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400" : "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"}`}>
                          {cd.autoDetected ? "auto" : "manual"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => removeClosedDay(cd.date)}
                          className="text-xs px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50"
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

      {/* Ignored dates (expandable) */}
      {ignoredDates.length > 0 && (
        <div>
          <button
            onClick={() => setShowIgnored(!showIgnored)}
            className="text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
          >
            {showIgnored ? "Hide" : "Show"} Ignored Dates ({ignoredDates.length})
          </button>
          {showIgnored && (
            <div className="mt-2 max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800">
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Day</th>
                    <th className="px-3 py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {ignoredDates.map((date) => {
                    const d = new Date(date + "T12:00:00");
                    return (
                      <tr key={date} className="border-b border-gray-50 dark:border-gray-700/50">
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{date}</td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{DOW_NAMES[d.getDay()]}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => unignoreDate(date)}
                            className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                          >
                            Unignore
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
      )}
    </div>
  );
}
