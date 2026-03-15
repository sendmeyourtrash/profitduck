import { NextResponse } from "next/server";
import { deduplicatePayouts } from "@/lib/services/reconciliation/cleanup-duplicates";

/**
 * POST /api/reconciliation/cleanup
 * One-time data cleanup: backfill platformPayoutId and remove duplicate payouts.
 */
export async function POST() {
  try {
    const result = await deduplicatePayouts();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Cleanup failed",
      },
      { status: 500 }
    );
  }
}
