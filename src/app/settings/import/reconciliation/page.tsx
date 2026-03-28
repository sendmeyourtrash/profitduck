"use client";

import dynamic from "next/dynamic";

const ReconciliationPanel = dynamic(() => import("@/components/panels/ReconciliationPanel"), {
  loading: () => (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
    </div>
  ),
});

export default function ReconciliationPage() {
  return <ReconciliationPanel />;
}
