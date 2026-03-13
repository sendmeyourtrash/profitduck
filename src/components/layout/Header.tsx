"use client";

import { usePathname } from "next/navigation";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard Overview",
  "/dashboard/revenue": "Revenue Analytics",
  "/dashboard/expenses": "Expense Analytics",
  "/dashboard/platforms": "Platform Performance",
  "/upload": "Import Data",
  "/health-report": "Business Health Report",
  "/reconciliation": "Reconciliation",
  "/transactions": "All Transactions",
  "/imports": "Import History",
};

export default function Header() {
  const pathname = usePathname();
  const title = pageTitles[pathname] || "Dashboard";

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4">
      <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
    </header>
  );
}
