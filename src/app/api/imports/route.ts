import { NextRequest, NextResponse } from "next/server";
import { getImports } from "@/lib/db/config-db";
import { getCategoriesDb } from "@/lib/db/config-db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");
  const source = searchParams.get("source");

  const imports = getImports(source || undefined, limit, offset);

  // Count total
  const db = getCategoriesDb();
  let total: number;
  if (source) {
    const row = db.prepare("SELECT COUNT(*) as cnt FROM imports WHERE source = ?").get(source) as { cnt: number };
    total = row?.cnt || 0;
  } else {
    const row = db.prepare("SELECT COUNT(*) as cnt FROM imports").get() as { cnt: number };
    total = row?.cnt || 0;
  }

  return NextResponse.json({
    imports: imports.map((i) => ({
      id: String(i.id),
      fileName: i.filename,
      source: i.source,
      status: i.status,
      rowsProcessed: i.records_count,
      rowsFailed: 0,
      rowsSkipped: 0,
      importedAt: i.created_at,
      dateRangeStart: i.date_range_start,
      dateRangeEnd: i.date_range_end,
    })),
    total,
  });
}
