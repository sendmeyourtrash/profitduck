"use client";

import dynamic from "next/dynamic";

const MenuCategoriesPanel = dynamic(() => import("@/components/panels/MenuCategoriesPanel"), { ssr: false });

export default function MenuCategoriesPage() {
  return <MenuCategoriesPanel />;
}
