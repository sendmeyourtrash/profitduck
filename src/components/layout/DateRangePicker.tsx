"use client";

import { useMemo } from "react";
import { useDateRange } from "@/contexts/DateRangeContext";

const PRESETS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "YTD", days: -1 },
  { label: "1Y", days: 365 },
  { label: "All", days: 0 },
] as const;

export default function DateRangePicker() {
  const { startDate, endDate, setDateRange, minDate, maxDate } = useDateRange();

  // Determine which preset is active (if any)
  const activePreset = useMemo(() => {
    if (!startDate && !endDate) return "All";

    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];

    // Only match presets when endDate is today
    if (endDate !== todayStr) return null;

    for (const preset of PRESETS) {
      if (preset.days <= 0) continue; // skip All/YTD for numeric match
      const expected = new Date(now);
      expected.setDate(expected.getDate() - preset.days);
      if (startDate === expected.toISOString().split("T")[0]) return preset.label;
    }

    // Check YTD
    const ytdStart = new Date(now.getFullYear(), 0, 1)
      .toISOString()
      .split("T")[0];
    if (startDate === ytdStart) return "YTD";

    return null;
  }, [startDate, endDate]);

  const applyPreset = (days: number) => {
    if (days === 0) {
      // All
      setDateRange("", "");
    } else if (days === -1) {
      // YTD
      const now = new Date();
      const ytd = new Date(now.getFullYear(), 0, 1);
      setDateRange(
        ytd.toISOString().split("T")[0],
        now.toISOString().split("T")[0]
      );
    } else {
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - days);
      setDateRange(
        start.toISOString().split("T")[0],
        now.toISOString().split("T")[0]
      );
    }
  };

  return (
    <div className="flex items-center gap-3">
      {/* From / To date inputs */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500">From</label>
        <input
          type="date"
          value={startDate}
          min={minDate}
          max={endDate || maxDate}
          onChange={(e) => setDateRange(e.target.value, endDate)}
          className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-700"
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500">To</label>
        <input
          type="date"
          value={endDate}
          min={startDate || minDate}
          max={maxDate}
          onChange={(e) => setDateRange(startDate, e.target.value)}
          className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-700"
        />
      </div>

      {/* Preset buttons */}
      <div className="flex gap-1">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => applyPreset(preset.days)}
            className={`px-2.5 py-1.5 text-xs rounded-md border transition-colors font-medium ${
              activePreset === preset.label
                ? "bg-indigo-600 text-white border-indigo-600"
                : "border-gray-200 text-gray-600 hover:bg-gray-100"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
