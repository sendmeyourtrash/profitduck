"use client";

import dynamic from "next/dynamic";

const MenuModifiersPanel = dynamic(() => import("@/components/panels/MenuModifiersPanel"), { ssr: false });

export default function MenuModifiersPage() {
  return <MenuModifiersPanel />;
}
