"use client";

/**
 * SubNav — top-of-page tab bar linking all sub-pages of the mortgage tool.
 *
 * Behavior:
 *   - Uses Next.js <Link> for client-side navigation (fast switching).
 *   - Horizontal scroll on mobile (below lg).
 *   - Shows a dot indicator on sections the user has already configured.
 *   - Active tab is visually highlighted and marked aria-current.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMortgageTool } from "@/contexts/MortgageToolContext";

interface TabDef {
  href: string;
  label: string;
  icon: string;
  configuredKey?:
    | "incomeConfigured"
    | "locationConfigured"
    | "transportationConfigured"
    | "rentVsBuyConfigured"
    | "scenariosConfigured";
}

const TABS: TabDef[] = [
  { href: "/tools/mortgage", label: "Overview", icon: "🏠" },
  {
    href: "/tools/mortgage/income",
    label: "Income & Tax",
    icon: "💵",
    configuredKey: "incomeConfigured",
  },
  {
    href: "/tools/mortgage/location",
    label: "Location",
    icon: "📍",
    configuredKey: "locationConfigured",
  },
  {
    href: "/tools/mortgage/transportation",
    label: "Transport",
    icon: "🚗",
    configuredKey: "transportationConfigured",
  },
  {
    href: "/tools/mortgage/rent-vs-buy",
    label: "Rent vs Buy",
    icon: "⚖️",
    configuredKey: "rentVsBuyConfigured",
  },
  {
    href: "/tools/mortgage/scenarios",
    label: "Scenarios",
    icon: "📊",
    configuredKey: "scenariosConfigured",
  },
  {
    href: "/tools/mortgage/amortization",
    label: "Amortization",
    icon: "📅",
  },
];

export default function SubNav() {
  const pathname = usePathname();
  const { state } = useMortgageTool();

  return (
    <nav
      aria-label="Mortgage calculator sections"
      className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-1.5"
    >
      <ul className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide">
        {TABS.map((tab) => {
          const isActive =
            tab.href === "/tools/mortgage"
              ? pathname === tab.href
              : pathname === tab.href || pathname?.startsWith(tab.href);
          const isConfigured =
            tab.configuredKey && (state as unknown as Record<string, boolean>)[tab.configuredKey];
          return (
            <li key={tab.href} className="shrink-0">
              <Link
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  isActive
                    ? "bg-indigo-600 text-white"
                    : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                }`}
              >
                <span aria-hidden="true">{tab.icon}</span>
                <span>{tab.label}</span>
                {isConfigured && !isActive && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-emerald-500"
                    aria-label="Configured"
                    title="Configured"
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
