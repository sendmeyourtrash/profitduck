import TabNav from "@/components/layout/TabNav";

const TABS = [
  { href: "/settings/business", label: "Business" },
  { href: "/settings/import", label: "Import" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <TabNav tabs={TABS} />
      {children}
    </div>
  );
}
