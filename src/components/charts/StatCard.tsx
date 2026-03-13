"use client";

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
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
  trend,
  variant = "default",
}: StatCardProps) {
  return (
    <div
      className={`rounded-xl border border-gray-200 p-6 ${variantStyles[variant]}`}
    >
      <p className="text-sm font-medium text-gray-500">{title}</p>
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
