"use client";

import { useState } from "react";

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  info?: string;
  trend?: { value: number; label: string };
  variant?: "default" | "success" | "danger" | "warning";
}

const variantStyles = {
  default: "bg-white",
  success: "bg-emerald-50 border-emerald-200",
  danger: "bg-red-50 border-red-200",
  warning: "bg-amber-50 border-amber-200",
};

export default function StatCard({
  title,
  value,
  subtitle,
  info,
  trend,
  variant = "default",
}: StatCardProps) {
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div
      className={`rounded-xl border border-gray-200 p-6 ${variantStyles[variant]}`}
    >
      <div className="flex items-center gap-1.5">
        <p className="text-sm font-medium text-gray-500">{title}</p>
        {info && (
          <div className="relative">
            <button
              type="button"
              onMouseEnter={() => setShowInfo(true)}
              onMouseLeave={() => setShowInfo(false)}
              onClick={() => setShowInfo(!showInfo)}
              className="text-gray-400 hover:text-gray-600 transition-colors text-xs leading-none"
              aria-label={`Info about ${title}`}
            >
              ⓘ
            </button>
            {showInfo && (
              <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 px-3 py-2 bg-gray-800 text-white text-xs rounded-lg shadow-lg leading-relaxed">
                {info}
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
              </div>
            )}
          </div>
        )}
      </div>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      {subtitle && (
        <p className="text-xs text-gray-400 mt-1">{subtitle}</p>
      )}
      {trend && (
        <p
          className={`text-xs mt-2 ${
            trend.value >= 0 ? "text-emerald-600" : "text-red-600"
          }`}
        >
          {trend.value >= 0 ? "↑" : "↓"} {Math.abs(trend.value)}%{" "}
          {trend.label}
        </p>
      )}
    </div>
  );
}
