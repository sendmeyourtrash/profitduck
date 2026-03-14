"use client";

export interface ProgressState {
  phase: string;
  current: number;
  total: number;
  message: string;
  done: boolean;
  result?: unknown;
  error?: string;
}

export function ProgressBar({
  progress,
  color = "indigo",
}: {
  progress: ProgressState;
  color?: "indigo" | "blue";
}) {
  const pct = progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : -1; // -1 = indeterminate
  const isIndeterminate = pct < 0;
  const colorClasses = color === "blue" ? "bg-blue-600" : "bg-indigo-600";
  const trackClasses = color === "blue" ? "bg-blue-100" : "bg-indigo-100";

  return (
    <div className="space-y-2">
      <div className={`w-full ${trackClasses} rounded-full h-2 overflow-hidden`}>
        {isIndeterminate ? (
          <div
            className={`h-full ${colorClasses} rounded-full animate-progress-indeterminate`}
            style={{ width: "40%" }}
          />
        ) : (
          <div
            className={`h-full ${colorClasses} rounded-full transition-all duration-300 ease-out`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{progress.message}</p>
        {!isIndeterminate && (
          <p className="text-xs font-medium text-gray-600">{pct}%</p>
        )}
      </div>
    </div>
  );
}
