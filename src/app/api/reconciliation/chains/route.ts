import { NextRequest, NextResponse } from "next/server";
import {
  buildReconciliationChains,
  getReconciliationSummary,
} from "@/lib/services/reconciliation";

/**
 * GET /api/reconciliation/chains
 * Returns reconciliation chains with optional filters.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform") || undefined;
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  const startDate = start ? new Date(start) : undefined;
  const endDate = end ? new Date(end) : undefined;

  const [chains, summary] = await Promise.all([
    buildReconciliationChains(platform, startDate, endDate),
    getReconciliationSummary(),
  ]);

  return NextResponse.json({ chains, summary });
}
