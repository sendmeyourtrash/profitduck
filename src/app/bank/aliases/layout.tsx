import TabNav from "@/components/layout/TabNav";

const TABS = [
  { href: "/bank/aliases/vendor-aliases", label: "Vendor Aliases" },
  { href: "/bank/aliases/categories", label: "Categories" },
];

export default function AliasesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <TabNav tabs={TABS} variant="pills" />
      {children}
    </div>
  );
}
