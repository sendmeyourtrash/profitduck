"use client";

import dynamic from "next/dynamic";

const MenuItemAliasesPanel = dynamic(() => import("@/components/panels/MenuItemAliasesPanel"), { ssr: false });

export default function MenuItemsPage() {
  return <MenuItemAliasesPanel />;
}
