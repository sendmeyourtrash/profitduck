"use client";

/**
 * SummaryRow — key/value row used on the overview page to show breakdowns.
 *
 * Renders as a two-column row with a label on the left and a value on the
 * right. Optional `emphasized` prop bolds the value and thickens the border
 * for totals rows.
 */

import type { ReactNode } from "react";

interface SummaryRowProps {
  label: string;
  value: ReactNode;
  subtle?: boolean;
  emphasized?: boolean;
  /** Tone color applied to the value. */
  tone?: "default" | "success" | "danger" | "warning" | "muted";
}

const toneClass: Record<NonNullable<SummaryRowProps["tone"]>, string> = {
  default: "text-gray-800 dark:text-gray-100",
  success: "text-emerald-600 dark:text-emerald-400",
  danger: "text-red-600 dark:text-red-400",
  warning: "text-amber-600 dark:text-amber-400",
  muted: "text-gray-500 dark:text-gray-400",
};

export default function SummaryRow({
  label,
  value,
  subtle,
  emphasized,
  tone = "default",
}: SummaryRowProps) {
  return (
    <div
      className={`flex items-center justify-between gap-3 py-2 ${
        emphasized ? "border-t border-gray-200/60 dark:border-gray-700/50 mt-1 pt-3" : ""
      }`}
    >
      <span
        className={`text-sm ${
          subtle
            ? "text-gray-500 dark:text-gray-400"
            : emphasized
              ? "font-medium text-gray-800 dark:text-gray-100"
              : "text-gray-600 dark:text-gray-300"
        }`}
      >
        {label}
      </span>
      <span
        className={`text-sm ${emphasized ? "font-bold" : "font-medium"} ${toneClass[tone]}`}
      >
        {value}
      </span>
    </div>
  );
}
