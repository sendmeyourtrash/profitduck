"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";

const ClosedDaysPanel = dynamic(() => import("@/components/panels/ClosedDaysPanel"), {
  loading: () => (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
    </div>
  ),
});

export default function BusinessPage() {
  const [openDate, setOpenDate] = useState("");
  const [openDateSaving, setOpenDateSaving] = useState(false);
  const [openDateSaved, setOpenDateSaved] = useState(false);
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [timezoneSaving, setTimezoneSaving] = useState(false);
  const [timezoneSaved, setTimezoneSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.settings?.restaurant_open_date) setOpenDate(data.settings.restaurant_open_date);
        if (data.settings?.timezone) setTimezone(data.settings.timezone);
      })
      .catch(() => {});
  }, []);

  async function saveOpenDate() {
    setOpenDateSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "restaurant_open_date", value: openDate }),
      });
      setOpenDateSaved(true);
    } catch {
      // ignore
    } finally {
      setOpenDateSaving(false);
    }
  }

  async function saveTimezone() {
    setTimezoneSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "timezone", value: timezone }),
      });
      setTimezoneSaved(true);
    } catch {
      // ignore
    } finally {
      setTimezoneSaving(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Business Info</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">General information about your restaurant</p>
        </div>

        <div className="flex items-end gap-3">
          <div className="flex-1 max-w-xs">
            <label htmlFor="openDate" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Restaurant Open Date
            </label>
            <input
              id="openDate"
              type="date"
              value={openDate}
              onChange={(e) => { setOpenDate(e.target.value); setOpenDateSaved(false); }}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <button
            onClick={saveOpenDate}
            disabled={openDateSaving || !openDate}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          >
            {openDateSaving ? "Saving..." : openDateSaved ? "Saved ✓" : "Save"}
          </button>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Used in reports to provide context for profit calculations.
        </p>

        <div className="flex items-end gap-3 pt-3 border-t border-gray-100 dark:border-gray-700">
          <div className="flex-1 max-w-xs">
            <label htmlFor="timezone" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Timezone
            </label>
            <select
              id="timezone"
              value={timezone}
              onChange={(e) => { setTimezone(e.target.value); setTimezoneSaved(false); }}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="America/New_York">Eastern Time (New York)</option>
              <option value="America/Chicago">Central Time (Chicago)</option>
              <option value="America/Denver">Mountain Time (Denver)</option>
              <option value="America/Los_Angeles">Pacific Time (Los Angeles)</option>
              <option value="America/Anchorage">Alaska Time</option>
              <option value="Pacific/Honolulu">Hawaii Time</option>
              <option value="UTC">UTC</option>
            </select>
          </div>
          <button
            onClick={saveTimezone}
            disabled={timezoneSaving}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          >
            {timezoneSaving ? "Saving..." : timezoneSaved ? "Saved ✓" : "Save"}
          </button>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          All dates and times are displayed in this timezone. Affects charts, reports, and date filtering.
        </p>
      </div>

      <ClosedDaysPanel />
    </div>
  );
}
