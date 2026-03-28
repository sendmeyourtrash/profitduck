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
    <nav className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1 overflow-x-auto scrollbar-hide">
      {PLATFORMS.map((p) => {
        const isActive = p.slug === activeSlug;
        return (
          <Link
            key={p.slug}
            href={p.href}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              isActive
                ? "bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}
