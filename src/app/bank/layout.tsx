import TabNav from "@/components/layout/TabNav";

const TABS = [
  { href: "/bank/transactions", label: "Transactions" },
  { href: "/bank/aliases", label: "Transaction Aliases" },
  { href: "/bank/manual-entry", label: "Manual Entry" },
];

export default function BankLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <TabNav tabs={TABS} />
      {children}
    </div>
  );
}
