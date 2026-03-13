import { NextResponse } from "next/server";
import { matchLevel1ToLevel2 } from "@/lib/services/reconciliation";
import { findL2L3Suggestions, autoMatchL2L3 } from "@/lib/services/reconciliation";
import { runAlertScan } from "@/lib/services/reconciliation";
import { getReconciliationSummary } from "@/lib/services/reconciliation";

/**
 * POST /api/reconciliation/run
 * Triggers the full reconciliation engine:
 * 1. Match L1 (orders) → L2 (payouts)
 * 2. Auto-match high-confidence L2 → L3 (bank)
 * 3. Run alert scan
 */
export async function POST() {
  try {
    // 1. L1-L2 matching
    const l1l2Result = await matchLevel1ToLevel2();

    // 2. L2-L3 auto-matching (confidence >= 0.9)
    const l2l3AutoMatched = await autoMatchL2L3(0.9);

    // 3. Remaining L2-L3 suggestions
    const l2l3Suggestions = await findL2L3Suggestions();

    // 4. Alert scan
    const newAlerts = await runAlertScan();

    // 5. Updated summary
    const summary = await getReconciliationSummary();

    return NextResponse.json({
      l1l2: l1l2Result,
      l2l3AutoMatched,
      l2l3PendingSuggestions: l2l3Suggestions.length,
      newAlerts,
      summary,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Reconciliation failed",
      },
      { status: 500 }
    );
  }
}
