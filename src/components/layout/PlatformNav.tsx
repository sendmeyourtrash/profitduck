"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const PLATFORMS = [
  { slug: "overview", label: "Overview", href: "/dashboard/platforms" },
  { slug: "square", label: "Square", href: "/dashboard/platforms/square" },
  { slug: "doordash", label: "DoorDash", href: "/dashboard/platforms/doordash" },
  { slug: "ubereats", label: "Uber Eats", href: "/dashboard/platforms/ubereats" },
  { slug: "grubhub", label: "Grubhub", href: "/dashboard/platforms/grubhub" },
];

export default function PlatformNav() {
  const pathname = usePathname();

  const activeSlug =
    pathname === "/dashboard/platforms"
      ? "overview"
      : PLATFORMS.find((p) => p.href === pathname)?.slug || "overview";

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
