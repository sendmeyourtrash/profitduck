import TabNav from "@/components/layout/TabNav";

const TABS = [
  { href: "/sales/menu/items", label: "Menu Items" },
  { href: "/sales/menu/categories", label: "Categories" },
  { href: "/sales/menu/modifiers", label: "Modifiers" },
];

export default function MenuLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <TabNav tabs={TABS} variant="pills" />
      {children}
    </div>
  );
}
