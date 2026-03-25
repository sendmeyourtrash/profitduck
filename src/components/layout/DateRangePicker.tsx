"use client";

import { useMemo, useCallback, useState, useEffect } from "react";
import { useDateRange } from "@/contexts/DateRangeContext";

type Preset = { label: string; getStart: () => Date | null };

function toDateStr(d: Date) {
  // Use local date components instead of UTC-based toISOString()
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayStr() {
  return toDateStr(new Date());
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function mondayOfWeek(): Date {
  const d = new Date();
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1; // offset to Monday
  d.setDate(d.getDate() - diff);
  return d;
}

function startOfMonth(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfQuarter(): Date {
  const d = new Date();
  const qMonth = Math.floor(d.getMonth() / 3) * 3;
  return new Date(d.getFullYear(), qMonth, 1);
}

function startOfYear(): Date {
  return new Date(new Date().getFullYear(), 0, 1);
}

// openDate is set dynamically after fetching from settings
let _openDate: string | null = null;

const ROLLING: Preset[] = [
  { label: "1D", getStart: () => daysAgo(1) },
  { label: "7D", getStart: () => daysAgo(7) },
  { label: "30D", getStart: () => daysAgo(30) },
  { label: "90D", getStart: () => daysAgo(90) },
  { label: "1Y", getStart: () => daysAgo(365) },
  { label: "Open", getStart: () => _openDate ? new Date(_openDate + "T00:00:00") : null },
  { label: "All", getStart: () => null },
];

const CALENDAR: Preset[] = [
  { label: "1W", getStart: mondayOfWeek },
  { label: "1M", getStart: startOfMonth },
  { label: "1Q", getStart: startOfQuarter },
  { label: "YTD", getStart: startOfYear },
];

const ALL_PRESETS = [...ROLLING, ...CALENDAR];

export default function DateRangePicker() {
  const { startDate, endDate, setDateRange, minDate, maxDate } = useDateRange();
  const [lastClicked, setLastClicked] = useState<string | null>(null);
  const [hasOpenDate, setHasOpenDate] = useState(!!_openDate);

  useEffect(() => {
    if (_openDate) return; // already fetched
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        const od = data?.settings?.restaurant_open_date;
        if (od) {
          _openDate = od;
          setHasOpenDate(true);
        }
      })
      .catch(() => {});
  }, []);

  const activePreset = useMemo(() => {
    if (!startDate && !endDate) return "All";

    const today = todayStr();
    if (endDate !== today) return null;

    // Find all matching presets
    const matches: string[] = [];
    for (const preset of ALL_PRESETS) {
      if (preset.label === "All") continue;
      const expected = preset.getStart();
      if (expected && startDate === toDateStr(expected)) matches.push(preset.label);
    }

    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    // Multiple matches (e.g. 1Q and YTD in Q1) — prefer last clicked
    if (lastClicked && matches.includes(lastClicked)) return lastClicked;
    return matches[matches.length - 1];
  }, [startDate, endDate, lastClicked]);

  const applyPreset = useCallback(
    (preset: Preset) => {
      setLastClicked(preset.label);
      const start = preset.getStart();
      if (start === null) {
        setDateRange("", "");
      } else {
        setDateRange(toDateStr(start), todayStr());
      }
    },
    [setDateRange]
  );

  const btnClass = (label: string) =>
    `px-2.5 py-1.5 text-xs rounded-md border transition-colors font-medium ${
      activePreset === label
        ? "bg-indigo-600 text-white border-indigo-600"
        : "border-gray-200 text-gray-600 hover:bg-gray-100"
    }`;

  return (
    <div className="flex items-center gap-3">
      {/* From / To date inputs */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500">From</label>
        <input
          type="date"
          value={startDate || minDate || ""}
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
          value={endDate || maxDate || ""}
          min={startDate || minDate}
          max={maxDate}
          onChange={(e) => setDateRange(startDate, e.target.value)}
          className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-700"
        />
      </div>

      {/* Preset buttons */}
      <div className="flex items-center gap-1">
        {ROLLING.filter((p) => p.label !== "Open" || hasOpenDate).map((p) => (
          <button key={p.label} onClick={() => applyPreset(p)} className={btnClass(p.label)}>
            {p.label}
          </button>
        ))}
        <div className="w-px h-5 bg-gray-300 mx-1" />
        {CALENDAR.map((p) => (
          <button key={p.label} onClick={() => applyPreset(p)} className={btnClass(p.label)}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
