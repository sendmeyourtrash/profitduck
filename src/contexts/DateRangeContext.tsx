"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

interface DateRangeContextValue {
  startDate: string; // "YYYY-MM-DD" or ""
  endDate: string; // "YYYY-MM-DD" or ""
  setDateRange: (start: string, end: string) => void;
  minDate: string | undefined;
  maxDate: string | undefined;
}

const DateRangeContext = createContext<DateRangeContextValue | null>(null);

function defaultRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 30);
  return {
    startDate: start.toISOString().split("T")[0],
    endDate: now.toISOString().split("T")[0],
  };
}

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const defaults = defaultRange();
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [minDate, setMinDate] = useState<string | undefined>();
  const [maxDate, setMaxDate] = useState<string | undefined>();

  // Fetch the data range bounds once on mount
  useEffect(() => {
    fetch("/api/data-range")
      .then((r) => r.json())
      .then((data) => {
        if (data.dateRange?.min)
          setMinDate(data.dateRange.min.split("T")[0]);
        if (data.dateRange?.max)
          setMaxDate(data.dateRange.max.split("T")[0]);
      })
      .catch(() => {});
  }, []);

  const setDateRange = useCallback((start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
  }, []);

  return (
    <DateRangeContext.Provider
      value={{ startDate, endDate, setDateRange, minDate, maxDate }}
    >
      {children}
    </DateRangeContext.Provider>
  );
}

export function useDateRange(): DateRangeContextValue {
  const ctx = useContext(DateRangeContext);
  if (!ctx)
    throw new Error("useDateRange must be used within DateRangeProvider");
  return ctx;
}
