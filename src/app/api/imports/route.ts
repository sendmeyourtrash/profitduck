import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  const [imports, total] = await Promise.all([
    prisma.import.findMany({
      orderBy: { importedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.import.count(),
  ]);

  return NextResponse.json({ imports, total });
}
