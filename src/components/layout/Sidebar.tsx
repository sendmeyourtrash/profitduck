"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: "📊" },
  { href: "/analytics", label: "Analytics", icon: "📈" },
  { href: "/health-report", label: "Health Report", icon: "🏥" },
  { href: "/dashboard/expenses", label: "Expenses", icon: "📉" },
  { href: "/dashboard/platforms", label: "Platforms", icon: "🏪" },
  { href: "/transactions", label: "Transactions", icon: "📋" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-gray-900 text-white flex flex-col min-h-screen">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="Profit Duck"
            width={72}
            height={72}
            className="rounded-lg"
          />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Profit Duck</h1>
            <p className="text-xs text-gray-400">Restaurant Dashboard</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-indigo-600 text-white"
                  : "text-gray-300 hover:bg-gray-800 hover:text-white"
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-gray-700 text-xs text-gray-500">
        Profit Duck v1.0
      </div>
    </aside>
  );
}
