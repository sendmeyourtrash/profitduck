"use client";

/**
 * StatTile — headline stat tile used on the mortgage tool pages.
 *
 * Differs from the global StatCard in that it's smaller, accepts an icon,
 * supports an aria-live region for results that update as the user types,
 * and has a variant for "not yet configured" prompts.
 */

import type { ReactNode } from "react";

interface StatTileProps {
  label: string;
  value: string;
  subtitle?: string;
  icon?: string;
  variant?: "default" | "success" | "danger" | "warning" | "neutral";
  /** If true, mark the value region as aria-live="polite" so screen readers
   *  announce changes as inputs are typed elsewhere on the page. */
  liveRegion?: boolean;
  /** Optional footer action (e.g. "Configure →" link). */
  action?: ReactNode;
}

const variantClasses: Record<NonNullable<StatTileProps["variant"]>, string> = {
  default: "bg-white dark:bg-gray-800",
  success:
    "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50",
  danger:
    "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50",
  warning:
    "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50",
  neutral: "bg-gray-50 dark:bg-gray-800/60",
};

const valueColor: Record<NonNullable<StatTileProps["variant"]>, string> = {
  default: "text-gray-900 dark:text-gray-100",
  success: "text-emerald-700 dark:text-emerald-300",
  danger: "text-red-700 dark:text-red-300",
  warning: "text-amber-700 dark:text-amber-300",
  neutral: "text-gray-700 dark:text-gray-200",
};

export default function StatTile({
  label,
  value,
  subtitle,
  icon,
  variant = "default",
  liveRegion,
  action,
}: StatTileProps) {
  return (
    <div
      className={`rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-4 ${variantClasses[variant]}`}
    >
      <div className="flex items-center gap-2 mb-1">
        {icon && (
          <span aria-hidden="true" className="text-lg leading-none">
            {icon}
          </span>
        )}
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 truncate">
          {label}
        </p>
      </div>
      <p
        className={`text-xl font-bold ${valueColor[variant]}`}
        aria-live={liveRegion ? "polite" : undefined}
      >
        {value}
      </p>
      {subtitle && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
          {subtitle}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
