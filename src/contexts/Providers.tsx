"use client";

import { DateRangeProvider } from "@/contexts/DateRangeContext";

export default function Providers({ children }: { children: React.ReactNode }) {
  return <DateRangeProvider>{children}</DateRangeProvider>;
}
