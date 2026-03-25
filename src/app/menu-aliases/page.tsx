"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

const MenuItemAliasesPanel = dynamic(
  () => import("@/components/panels/MenuItemAliasesPanel"),
  { ssr: false }
);
const MenuCategoryAliasesPanel = dynamic(
  () => import("@/components/panels/MenuCategoryAliasesPanel"),
  { ssr: false }
);
const MenuModifiersPanel = dynamic(
  () => import("@/components/panels/MenuModifiersPanel"),
  { ssr: false }
);

const TABS = [
  { key: "items", label: "Menu Items", description: "Map old or renamed menu items to their current names for accurate analytics." },
  { key: "categories", label: "Categories", description: "Merge or rename menu categories (e.g. 'Menu - Sweet Crêpes' → 'Sweet Crêpes')." },
  { key: "modifiers", label: "Modifiers", description: "View modifier usage — add-ons like 'Banana', 'Hot', 'Large 12oz'." },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function MenuAliasesPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("items");

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex gap-6">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab description */}
      <p className="text-xs text-gray-400 dark:text-gray-500">
        {TABS.find((t) => t.key === activeTab)?.description}
      </p>

      {/* Tab content */}
      {activeTab === "items" && <MenuItemAliasesPanel />}
      {activeTab === "categories" && <MenuCategoryAliasesPanel />}
      {activeTab === "modifiers" && <MenuModifiersPanel />}
    </div>
  );
}
