import { NextRequest, NextResponse } from "next/server";
import { getReconMatches, getReconSummary } from "@/lib/db/config-db";

/**
 * GET /api/reconciliation/chains
 * Returns reconciliation matches (L1→L3 chains) with optional platform filter.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform") || undefined;

  const matches = getReconMatches(platform);
  const summary = getReconSummary();

  return NextResponse.json({ chains: matches, summary });
}
