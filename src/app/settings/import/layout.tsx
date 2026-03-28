import TabNav from "@/components/layout/TabNav";

const TABS = [
  { href: "/settings/import/upload", label: "Upload" },
  { href: "/settings/import/history", label: "History" },
  { href: "/settings/import/reconciliation", label: "Reconciliation" },
];

export default function ImportLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <TabNav tabs={TABS} variant="pills" />
      {children}
    </div>
  );
}
