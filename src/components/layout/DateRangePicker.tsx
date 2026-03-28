"use client";

import { useMemo, useCallback, useState, useEffect, useRef } from "react";
import { useDateRange } from "@/contexts/DateRangeContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PresetDef = {
  label: string;
  getRange: () => { start: Date | null; end: Date | null };
};

type PresetGroup = {
  title: string;
  presets: PresetDef[];
};

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function toDateStr(d: Date) {
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
  const diff = day === 0 ? 6 : day - 1;
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

// Previous period helpers — return { start, end } for completed periods

function prevWeek(): { start: Date; end: Date } {
  const mon = mondayOfWeek();
  const prevMon = new Date(mon);
  prevMon.setDate(prevMon.getDate() - 7);
  const prevSun = new Date(prevMon);
  prevSun.setDate(prevSun.getDate() + 6);
  return { start: prevMon, end: prevSun };
}

function prevMonth(): { start: Date; end: Date } {
  const d = new Date();
  const start = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const end = new Date(d.getFullYear(), d.getMonth(), 0); // day 0 = last day of prev month
  return { start, end };
}

function prevQuarter(): { start: Date; end: Date } {
  const d = new Date();
  const currentQStart = Math.floor(d.getMonth() / 3) * 3;
  const prevQStart = currentQStart - 3;
  const year = prevQStart < 0 ? d.getFullYear() - 1 : d.getFullYear();
  const month = ((prevQStart % 12) + 12) % 12;
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 3, 0);
  return { start, end };
}

function prevYear(): { start: Date; end: Date } {
  const y = new Date().getFullYear() - 1;
  return { start: new Date(y, 0, 1), end: new Date(y, 11, 31) };
}

// Seasonal helpers

function seasonRange(
  startMonth: number,
  endMonth: number
): { start: Date; end: Date } {
  const now = new Date();
  const year = now.getMonth() >= startMonth ? now.getFullYear() : now.getFullYear() - 1;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, endMonth + 1, 0); // last day of endMonth
  return { start, end };
}

function winterRange(): { start: Date; end: Date } {
  const now = new Date();
  // Winter = Dec 1 – Feb 28/29
  // If we're in Dec, winter started this Dec
  // If we're in Jan/Feb, winter started last Dec
  // If we're Mar+, use the most recent completed winter (last Dec → this Feb)
  let decYear: number;
  if (now.getMonth() === 11) {
    // December — current winter
    decYear = now.getFullYear();
  } else if (now.getMonth() <= 1) {
    // Jan or Feb — winter started last Dec
    decYear = now.getFullYear() - 1;
  } else {
    // Mar–Nov — most recent completed winter
    decYear = now.getFullYear() - 1;
  }
  const start = new Date(decYear, 11, 1); // Dec 1
  const end = new Date(decYear + 1, 2, 0); // Last day of Feb
  return { start, end };
}

function taxYear(offset: number): { start: Date; end: Date } {
  const y = new Date().getFullYear() - offset;
  return { start: new Date(y, 0, 1), end: new Date(y, 11, 31) };
}

// ---------------------------------------------------------------------------
// Open date (fetched once from settings)
// ---------------------------------------------------------------------------

let _openDate: string | null = null;

function formatOpenDate(): string {
  if (!_openDate) return "";
  const d = new Date(_openDate + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Preset definitions
// ---------------------------------------------------------------------------

const QUICK_PRESETS: PresetDef[] = [
  { label: "7D", getRange: () => ({ start: daysAgo(7), end: null }) },
  { label: "30D", getRange: () => ({ start: daysAgo(30), end: null }) },
  { label: "90D", getRange: () => ({ start: daysAgo(90), end: null }) },
  { label: "YTD", getRange: () => ({ start: startOfYear(), end: null }) },
  { label: "All", getRange: () => ({ start: null, end: null }) },
];

function buildDropdownGroups(hasOpenDate: boolean): PresetGroup[] {
  const now = new Date();
  const currentYear = now.getFullYear();

  const rolling: PresetDef[] = [
    { label: "Yesterday", getRange: () => ({ start: daysAgo(1), end: null }) },
    {
      label: "Last 2 Weeks",
      getRange: () => ({ start: daysAgo(14), end: null }),
    },
    {
      label: "Last 6 Months",
      getRange: () => ({ start: daysAgo(180), end: null }),
    },
    {
      label: "Last Year",
      getRange: () => ({ start: daysAgo(365), end: null }),
    },
  ];
  if (hasOpenDate) {
    rolling.push({
      label: `Since Open (${formatOpenDate()})`,
      getRange: () => ({
        start: _openDate ? new Date(_openDate + "T00:00:00") : null,
        end: null,
      }),
    });
  }

  const thisPeriod: PresetDef[] = [
    {
      label: "This Week",
      getRange: () => ({ start: mondayOfWeek(), end: null }),
    },
    {
      label: "This Month",
      getRange: () => ({ start: startOfMonth(), end: null }),
    },
    {
      label: "This Quarter",
      getRange: () => ({ start: startOfQuarter(), end: null }),
    },
  ];

  const previousPeriod: PresetDef[] = [
    {
      label: "Last Week",
      getRange: () => {
        const r = prevWeek();
        return { start: r.start, end: r.end };
      },
    },
    {
      label: "Last Month",
      getRange: () => {
        const r = prevMonth();
        return { start: r.start, end: r.end };
      },
    },
    {
      label: "Last Quarter",
      getRange: () => {
        const r = prevQuarter();
        return { start: r.start, end: r.end };
      },
    },
    {
      label: "Last Year",
      getRange: () => {
        const r = prevYear();
        return { start: r.start, end: r.end };
      },
    },
  ];

  const seasonal: PresetDef[] = [
    {
      label: "Spring (Mar–May)",
      getRange: () => {
        const r = seasonRange(2, 4);
        return { start: r.start, end: r.end };
      },
    },
    {
      label: "Summer (Jun–Aug)",
      getRange: () => {
        const r = seasonRange(5, 7);
        return { start: r.start, end: r.end };
      },
    },
    {
      label: "Fall (Sep–Nov)",
      getRange: () => {
        const r = seasonRange(8, 10);
        return { start: r.start, end: r.end };
      },
    },
    {
      label: "Winter (Dec–Feb)",
      getRange: () => {
        const r = winterRange();
        return { start: r.start, end: r.end };
      },
    },
    {
      label: "Holiday Season (Nov–Dec)",
      getRange: () => {
        // Use current year if Nov has started, else prev year
        const year =
          now.getMonth() >= 10 ? now.getFullYear() : now.getFullYear() - 1;
        return {
          start: new Date(year, 10, 1),
          end: new Date(year, 11, 31),
        };
      },
    },
  ];

  const fiscal: PresetDef[] = [
    {
      label: `Tax Year ${currentYear - 1}`,
      getRange: () => {
        const r = taxYear(1);
        return { start: r.start, end: r.end };
      },
    },
    {
      label: `Tax Year ${currentYear - 2}`,
      getRange: () => {
        const r = taxYear(2);
        return { start: r.start, end: r.end };
      },
    },
    {
      label: `Tax Year ${currentYear - 3}`,
      getRange: () => {
        const r = taxYear(3);
        return { start: r.start, end: r.end };
      },
    },
  ];

  return [
    { title: "Rolling", presets: rolling },
    { title: "This Period", presets: thisPeriod },
    { title: "Previous Period", presets: previousPeriod },
    { title: "Seasonal", presets: seasonal },
    { title: "Fiscal", presets: fiscal },
  ];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DateRangePicker() {
  const { startDate, endDate, setDateRange, minDate, maxDate } = useDateRange();
  const [lastClicked, setLastClicked] = useState<string | null>(null);
  const [hasOpenDate, setHasOpenDate] = useState(!!_openDate);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch open date
  useEffect(() => {
    if (_openDate) return;
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

  // Click-outside & Escape to close
  useEffect(() => {
    if (!isOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  // Build dropdown groups (memoized on hasOpenDate)
  const dropdownGroups = useMemo(
    () => buildDropdownGroups(hasOpenDate),
    [hasOpenDate]
  );

  // Flatten all presets for active detection
  const allPresets = useMemo(() => {
    const flat: PresetDef[] = [...QUICK_PRESETS];
    for (const group of dropdownGroups) {
      flat.push(...group.presets);
    }
    return flat;
  }, [dropdownGroups]);

  // Detect which preset is active
  const activePreset = useMemo(() => {
    if (!startDate && !endDate) return "All";

    const today = todayStr();
    const matches: string[] = [];

    for (const preset of allPresets) {
      if (preset.label === "All") continue;
      const { start, end } = preset.getRange();
      if (!start) continue;

      const expectedStart = toDateStr(start);
      const expectedEnd = end ? toDateStr(end) : today;

      if (startDate === expectedStart && endDate === expectedEnd) {
        matches.push(preset.label);
      }
    }

    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    if (lastClicked && matches.includes(lastClicked)) return lastClicked;
    return matches[matches.length - 1];
  }, [startDate, endDate, lastClicked, allPresets]);

  // Is the active preset in the dropdown (not a quick button)?
  const activeInDropdown = useMemo(() => {
    if (!activePreset) return false;
    return !QUICK_PRESETS.some((p) => p.label === activePreset);
  }, [activePreset]);

  // Apply a preset
  const applyPreset = useCallback(
    (preset: PresetDef) => {
      setLastClicked(preset.label);
      const { start, end } = preset.getRange();
      if (start === null) {
        setDateRange("", "");
      } else {
        setDateRange(toDateStr(start), end ? toDateStr(end) : todayStr());
      }
    },
    [setDateRange]
  );

  // Button styling
  const btnBase = "px-2.5 py-1.5 text-xs rounded-md border transition-colors font-medium";
  const btnActive = "bg-indigo-600 text-white border-indigo-600";
  const btnInactive = "border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700";

  const quickBtnClass = (label: string) =>
    `${btnBase} ${activePreset === label ? btnActive : btnInactive}`;

  const moreBtnClass = isOpen
    ? `${btnBase} ${btnActive}`
    : activeInDropdown
      ? `${btnBase} bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-700`
      : `${btnBase} ${btnInactive}`;

  const dropdownItemClass = (label: string) =>
    `w-full text-left px-2 py-1.5 text-xs rounded-md transition-colors ${
      activePreset === label
        ? "bg-indigo-600 text-white"
        : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
    }`;

  const inputClass = "border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-lg px-2 py-1.5 text-sm text-gray-700 dark:text-gray-200 w-[130px]";

  return (
    <div className="flex flex-wrap items-center gap-2 lg:gap-3 min-w-0">
        {/* Date inputs */}
        <div className="flex items-center gap-2 shrink-0">
          <label className="text-xs text-gray-500 dark:text-gray-400">From</label>
          <input
            type="date"
            value={startDate || minDate || ""}
            min={minDate}
            max={endDate || maxDate}
            onChange={(e) => setDateRange(e.target.value, endDate)}
            className={inputClass}
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label className="text-xs text-gray-500 dark:text-gray-400">To</label>
          <input
            type="date"
            value={endDate || maxDate || ""}
            min={startDate || minDate}
            max={maxDate}
            onChange={(e) => setDateRange(startDate, e.target.value)}
            className={inputClass}
          />
        </div>

        {/* Quick preset buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {QUICK_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => applyPreset(p)}
              className={quickBtnClass(p.label)}
            >
              {p.label}
            </button>
          ))}

          {/* More dropdown */}
          <div ref={dropdownRef} className="relative">
            <button
              onClick={() => setIsOpen((v) => !v)}
              className={moreBtnClass}
            >
              More ▾
            </button>

            {isOpen && (
              <div className="absolute top-full right-0 mt-1 z-50 w-72 max-h-96 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-2">
                {dropdownGroups.map((group, gi) => (
                  <div
                    key={group.title}
                    className={
                      gi > 0 ? "border-t border-gray-100 dark:border-gray-700 pt-2 mt-2" : ""
                    }
                  >
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-2 py-1">
                      {group.title}
                    </div>
                    {group.presets.map((preset) => (
                      <button
                        key={preset.label}
                        onClick={() => {
                          applyPreset(preset);
                          setIsOpen(false);
                        }}
                        className={dropdownItemClass(preset.label)}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
    </div>
  );
}
