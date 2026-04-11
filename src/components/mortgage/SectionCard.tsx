"use client";

/**
 * SectionCard — standard page-level card used across the mortgage tool.
 *
 * Follows the Profit Duck design system:
 *   rounded-2xl, border border-gray-200/50 dark:border-gray-700/50,
 *   bg-white dark:bg-gray-800, p-6 (or p-5 for compact).
 */

import type { ReactNode } from "react";

interface SectionCardProps {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  /** Use `p-5` instead of `p-6` for internal cards on busy layouts. */
  compact?: boolean;
  /** Override the element (default `<section>`). */
  as?: "section" | "div";
  className?: string;
}

export default function SectionCard({
  title,
  description,
  action,
  children,
  compact,
  as: Tag = "section",
  className = "",
}: SectionCardProps) {
  return (
    <Tag
      className={`bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 ${
        compact ? "p-5" : "p-6"
      } ${className}`}
    >
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            {title && (
              <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                {title}
              </h2>
            )}
            {description && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                {description}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </Tag>
  );
}
