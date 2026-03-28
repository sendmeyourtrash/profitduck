import TabNav from "@/components/layout/TabNav";

const TABS = [
  { href: "/sales/orders", label: "Orders" },
  { href: "/sales/menu", label: "Menu" },
  { href: "/sales/manual-entry", label: "Manual Entry" },
];

export default function SalesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <TabNav tabs={TABS} />
      {children}
    </div>
  );
}
