"use client";

import dynamic from "next/dynamic";

const ManualEntryPanel = dynamic(() => import("@/components/panels/ManualEntryPanel"), { ssr: false });

export default function BankManualEntryPage() {
  return <ManualEntryPanel />;
}
