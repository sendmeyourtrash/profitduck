"use client";

import dynamic from "next/dynamic";

const SalesManualEntryPanel = dynamic(() => import("@/components/panels/SalesManualEntryPanel"), { ssr: false });

export default function SalesManualEntryPage() {
  return <SalesManualEntryPanel />;
}
