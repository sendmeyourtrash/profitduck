"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const PLATFORMS = [
  { slug: "overview", label: "Overview", href: "/dashboard/platforms" },
  { slug: "analytics", label: "Analytics", href: "/dashboard/platforms/analytics" },
];

export default function PlatformNav() {
  const pathname = usePathname();

  const activeSlug =
    pathname === "/dashboard/platforms"
      ? "overview"
      : PLATFORMS.find((p) => p.slug !== "overview" && pathname.startsWith(p.href))?.slug || "overview";

  return (
    <nav className="flex gap-1 bg-gray-100 rounded-lg p-1">
      {PLATFORMS.map((p) => {
        const isActive = p.slug === activeSlug;
        return (
          <Link
            key={p.slug}
            href={p.href}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              isActive
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}
