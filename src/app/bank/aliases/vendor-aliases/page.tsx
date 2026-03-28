"use client";

import dynamic from "next/dynamic";

const VendorAliasesPanel = dynamic(() => import("@/components/panels/VendorAliasesPanel"), { ssr: false });

export default function VendorAliasesPage() {
  return <VendorAliasesPanel />;
}
