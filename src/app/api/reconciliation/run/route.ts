import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  matchLevel1ToLevel2,
  resetReconciliationLinks,
  findL2L3Suggestions,
  autoMatchL2L3,
  runAlertScan,
  getReconciliationSummary,
} from "@/lib/services/reconciliation";
import {
  setProgress,
  completeProgress,
  failProgress,
} from "@/lib/services/progress";

const TOTAL_STEPS = 6;

/**
 * POST /api/reconciliation/run
 * Returns an operationId immediately and runs reconciliation in the background
 * with progress updates streamed via SSE at /api/progress/[operationId].
 */
export async function POST() {
  const operationId = `recon-${randomUUID().slice(0, 8)}`;

  // Seed initial progress so the SSE endpoint has something to send immediately
  setProgress(operationId, {
    phase: "starting",
    current: 0,
    total: TOTAL_STEPS,
    message: "Starting reconciliation…",
    done: false,
  });

  // Fire-and-forget: run reconciliation in background
  runReconciliation(operationId).catch((error) => {
    failProgress(
      operationId,
      error instanceof Error ? error.message : "Reconciliation failed"
    );
  });

  return NextResponse.json({ operationId });
}

async function runReconciliation(operationId: string) {
  // Step 1: Reset stale links
  setProgress(operationId, {
    phase: "reset",
    current: 1,
    total: TOTAL_STEPS,
    message: "Resetting stale reconciliation links…",
    done: false,
  });
  const resetStats = await resetReconciliationLinks();

  // Step 2: L1→L2 matching
  setProgress(operationId, {
    phase: "l1l2",
    current: 2,
    total: TOTAL_STEPS,
    message: "Matching orders → payouts (L1→L2)…",
    done: false,
  });
  const l1l2Result = await matchLevel1ToLevel2();

  // Step 3: L2→L3 auto-matching
  setProgress(operationId, {
    phase: "l2l3",
    current: 3,
    total: TOTAL_STEPS,
    message: "Auto-matching payouts → bank deposits (L2→L3)…",
    done: false,
  });
  const l2l3AutoMatched = await autoMatchL2L3(0.9);

  // Step 4: L2→L3 suggestions
  setProgress(operationId, {
    phase: "suggestions",
    current: 4,
    total: TOTAL_STEPS,
    message: "Finding remaining L2→L3 suggestions…",
    done: false,
  });
  const l2l3Suggestions = await findL2L3Suggestions();

  // Step 5: Alert scan
  setProgress(operationId, {
    phase: "alerts",
    current: 5,
    total: TOTAL_STEPS,
    message: "Scanning for alerts…",
    done: false,
  });
  const newAlerts = await runAlertScan();

  // Step 6: Summary
  setProgress(operationId, {
    phase: "summary",
    current: 6,
    total: TOTAL_STEPS,
    message: "Building summary…",
    done: false,
  });
  const summary = await getReconciliationSummary();

  // Done — attach result
  completeProgress(operationId, {
    resetStats,
    l1l2: l1l2Result,
    l2l3AutoMatched,
    l2l3PendingSuggestions: l2l3Suggestions.length,
    newAlerts,
    summary,
  });
}
