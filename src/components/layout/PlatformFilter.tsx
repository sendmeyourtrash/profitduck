"use client";

const PLATFORMS = [
  { slug: "all", label: "All" },
  { slug: "square", label: "Square" },
  { slug: "doordash", label: "DoorDash" },
  { slug: "ubereats", label: "Uber Eats" },
  { slug: "grubhub", label: "Grubhub" },
];

interface PlatformFilterProps {
  selected: string[];
  onChange: (platforms: string[]) => void;
}

export default function PlatformFilter({ selected, onChange }: PlatformFilterProps) {
  const isAll = selected.length === 0;

  const toggle = (slug: string) => {
    if (slug === "all") {
      onChange([]);
      return;
    }
    const next = selected.includes(slug)
      ? selected.filter((s) => s !== slug)
      : [...selected, slug];
    // If all 4 selected, reset to "All"
    if (next.length === PLATFORMS.length - 1) {
      onChange([]);
    } else {
      onChange(next);
    }
  };

  return (
    <div className="flex gap-1.5">
      {PLATFORMS.map((p) => {
        const active = p.slug === "all" ? isAll : selected.includes(p.slug);
        return (
          <button
            key={p.slug}
            onClick={() => toggle(p.slug)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              active
                ? "bg-indigo-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
