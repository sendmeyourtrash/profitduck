"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PlatformDetailRedirect({
  params,
}: {
  params: Promise<{ platform: string }>;
}) {
  const { platform } = use(params);
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams({ platform });
    router.replace(`/dashboard/platforms?${params.toString()}`);
  }, [platform, router]);

  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
    </div>
  );
}
