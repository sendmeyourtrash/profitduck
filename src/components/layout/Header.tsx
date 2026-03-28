"use client";

import { usePathname } from "next/navigation";
import DateRangePicker from "./DateRangePicker";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard Overview",
  "/dashboard/revenue": "Revenue Analytics",
  "/dashboard/expenses": "Expense Analytics",
  "/dashboard/platforms": "Platform Performance",
  "/dashboard/menu": "Menu Performance",
  "/health-report": "Business Health Report",
  "/sales": "Sales",
  "/bank": "Bank Activity",
  "/settings": "Import & Settings",
  "/menu-aliases": "Menu Aliases",
};

const DATE_PICKER_PATHS = new Set([
  "/dashboard",
  "/dashboard/revenue",
  "/dashboard/expenses",
  "/dashboard/platforms",
  "/dashboard/menu",
  "/health-report",
  "/sales",
  "/bank",
]);

export default function Header() {
  const pathname = usePathname();
  let title = pageTitles[pathname] || "Dashboard";

  // Dynamic route handling
  if (pathname.startsWith("/dashboard/expenses/category/")) {
    const category = decodeURIComponent(pathname.split("/").pop() || "");
    title = `${category} — Expenses`;
  } else if (pathname.startsWith("/dashboard/expenses/vendor/")) {
    const vendor = decodeURIComponent(pathname.split("/").pop() || "");
    title = `${vendor} — Expenses`;
  } else if (pathname.startsWith("/dashboard/platforms/")) {
    const platformSlug = decodeURIComponent(pathname.split("/").pop() || "");
    const platformLabels: Record<string, string> = {
      square: "Square (In-Store)",
      doordash: "DoorDash",
      ubereats: "Uber Eats",
      grubhub: "Grubhub",
    };
    title = `${platformLabels[platformSlug] || platformSlug} — Platform Detail`;
  }

  const showDatePicker =
    DATE_PICKER_PATHS.has(pathname) ||
    pathname.startsWith("/dashboard/expenses/category/") ||
    pathname.startsWith("/dashboard/expenses/vendor/") ||
    pathname.startsWith("/dashboard/platforms/");

  return (
    <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 lg:px-6 py-3 lg:py-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 hidden lg:block shrink-0">{title}</h2>
        {showDatePicker && <DateRangePicker />}
      </div>
    </header>
  );
}
