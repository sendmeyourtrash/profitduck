"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/contexts/ThemeContext";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: "📊" },
  { href: "/health-report", label: "Health Report", icon: "🏥" },
  { href: "/tax", label: "Tax Center", icon: "💰" },
  { href: "/dashboard/expenses", label: "Expenses", icon: "📉" },
  { href: "/dashboard/platforms", label: "Platforms", icon: "🏪" },
  { href: "/sales", label: "Sales", icon: "🛒" },
  { href: "/bank", label: "Bank Activity", icon: "🏦" },
  { href: "/menu-aliases", label: "Menu Aliases", icon: "🏷️" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();

  return (
    <aside className="w-64 bg-gray-900 text-white flex flex-col h-screen sticky top-0 overflow-y-auto">
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
      <div className="p-4 border-t border-gray-700 flex items-center justify-between">
        <span className="text-xs text-gray-500">Profit Duck v1.0</span>
        <button
          onClick={toggleTheme}
          className="text-gray-400 hover:text-white transition-colors p-1 rounded"
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
        </button>
      </div>
    </aside>
  );
}
