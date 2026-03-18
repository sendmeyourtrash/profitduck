import PlatformNav from "@/components/layout/PlatformNav";

export default function PlatformsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <PlatformNav />
      {children}
    </div>
  );
}
