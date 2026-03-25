"use client";

import { DateRangeProvider } from "@/contexts/DateRangeContext";
import { ThemeProvider } from "@/contexts/ThemeContext";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <DateRangeProvider>{children}</DateRangeProvider>
    </ThemeProvider>
  );
}
