import type { ReactNode } from "react";
import { MortgageToolProvider } from "@/contexts/MortgageToolContext";
import SubNav from "@/components/mortgage/SubNav";

export const metadata = {
  title: "Mortgage Calculator — Profit Duck",
  description:
    "Interactive mortgage calculator with amortization, tax savings, rent-vs-buy, transportation and lifestyle cost modeling.",
};

export default function MortgageToolLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <MortgageToolProvider>
      <div className="space-y-5">
        {/* Header */}
        <header>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Mortgage Calculator
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Model the full cost of homeownership, not just the mortgage. Every
            section you fill in updates the overview automatically.
          </p>
        </header>

        {/* Sub-nav tabs */}
        <SubNav />

        {/* Page content */}
        <main id="main-content">{children}</main>

        {/* Footer disclaimer */}
        <footer className="pt-4 border-t border-gray-200/50 dark:border-gray-700/50">
          <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
            Estimates only. Calculations use 2024/2025 federal tax rules,
            a $750k mortgage interest cap, and the $10k SALT cap. Actual tax
            liability depends on filing status, credits, brackets, and
            individual circumstances. Consult a licensed mortgage broker and
            tax professional before making financial decisions. All data is
            stored in your browser only — nothing is sent to a server.
          </p>
        </footer>
      </div>
    </MortgageToolProvider>
  );
}
