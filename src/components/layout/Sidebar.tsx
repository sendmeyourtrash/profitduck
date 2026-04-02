"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "@/contexts/ThemeContext";

const navGroups = [
  {
    label: "Insights",
    items: [
      { href: "/dashboard", label: "Overview", icon: "📊" },
      { href: "/health-report", label: "Health Report", icon: "🏥" },
    ],
  },
  {
    label: "Analytics",
    items: [
      { href: "/dashboard/platforms", label: "Platforms", icon: "🏪" },
      { href: "/dashboard/menu", label: "Menu", icon: "🍽️" },
      { href: "/dashboard/expenses", label: "Expenses", icon: "📉" },
    ],
  },
  {
    label: "Data",
    items: [
      { href: "/sales", label: "Sales", icon: "🛒" },
      { href: "/bank", label: "Bank Activity", icon: "🏦" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/tax", label: "Tax Center", icon: "💰" },
      { href: "/settings", label: "Settings", icon: "⚙️" },
    ],
  },
];

// Flat list for active detection and mobile
const navItems = navGroups.flatMap((g) => g.items);

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const activeItem = navItems.find(
    (item) => pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))
  );

  return (
    <>
      {/* ── Desktop sidebar (xl+) ── */}
      <aside className="hidden lg:flex w-64 bg-gray-900 text-white flex-col h-screen sticky top-0 overflow-y-auto">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="Profit Duck" width={72} height={72} className="rounded-lg" />
            <div>
              <h1 className="text-xl font-bold tracking-tight">Profit Duck</h1>
              <p className="text-xs text-gray-400">Restaurant Dashboard</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-4">
          {navGroups.map((group) => (
            <div key={group.label}>
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold px-3 mb-1">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
                  return (
                    <Link key={item.href} href={item.href}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                        isActive ? "bg-indigo-600 text-white" : "text-gray-300 hover:bg-gray-800 hover:text-white"
                      }`}>
                      <span className="text-lg">{item.icon}</span>
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 flex items-center justify-between">
          <span className="text-xs text-gray-500">Profit Duck v1.0</span>
          <div className="flex items-center gap-1">
          <button onClick={handleLogout} className="text-gray-400 hover:text-white transition-colors p-1 rounded"
            title="Sign out">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3-3l3-3m0 0l-3-3m3 3H9" />
            </svg>
          </button>
          <button onClick={toggleTheme} className="text-gray-400 hover:text-white transition-colors p-1 rounded"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
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
        </div>
      </aside>

      {/* ── Mobile/tablet top bar (below xl) ── */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-gray-900 text-white">
        <div className="flex items-center justify-between px-4 h-14">
          {/* Logo + current page */}
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="Profit Duck" width={32} height={32} className="rounded-md" />
            <span className="text-sm font-semibold">{activeItem?.label || "Profit Duck"}</span>
          </div>

          {/* Right: theme toggle + hamburger */}
          <div className="flex items-center gap-2">
            <button onClick={toggleTheme} className="text-gray-400 hover:text-white transition-colors p-1.5 rounded"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
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
            <button onClick={() => setMobileOpen(!mobileOpen)}
              className="text-gray-300 hover:text-white p-1.5 rounded transition-colors">
              {mobileOpen ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Dropdown menu */}
        {mobileOpen && (
          <>
            {/* Backdrop */}
            <div className="fixed inset-0 top-14 bg-black/40 z-40" onClick={() => setMobileOpen(false)} />
            {/* Menu */}
            <div className="absolute top-14 right-3 left-3 bg-gray-800 rounded-2xl shadow-2xl border border-gray-700/50 p-2 z-50 animate-in fade-in slide-in-from-top-2">
              <nav className="space-y-0.5">
                {navItems.map((item) => {
                  const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
                  return (
                    <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
                        isActive ? "bg-indigo-600 text-white" : "text-gray-300 hover:bg-gray-700 hover:text-white"
                      }`}>
                      <span className="text-lg">{item.icon}</span>
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
                <button onClick={() => { setMobileOpen(false); handleLogout(); }}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors w-full">
                  <span className="text-lg">🚪</span>
                  <span>Sign out</span>
                </button>
              </nav>
            </div>
          </>
        )}
      </div>

      {/* Spacer is handled in layout.tsx */}
    </>
  );
}
