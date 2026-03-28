"use client";

import dynamic from "next/dynamic";

const CategoriesPanel = dynamic(() => import("@/components/panels/CategoriesPanel"), { ssr: false });

export default function CategoriesPage() {
  return <CategoriesPanel />;
}
