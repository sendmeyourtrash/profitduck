import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  matchLevel1ToLevel2,
  resetReconciliationLinks,
  findL2L3Suggestions,
  autoMatchL2L3,
  runAlertScan,
  getReconciliationSummary,
  runCrossSourceDedup,
  resetDuplicateLinks,
  normalizeCategories,
} from "@/lib/services/reconciliation";
import {
  setProgress,
  completeProgress,
  failProgress,
} from "@/lib/services/progress";

const TOTAL_STEPS = 8;

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
  // Step 1: Reset stale links (including duplicate chains)
  setProgress(operationId, {
    phase: "reset",
    current: 1,
    total: TOTAL_STEPS,
    message: "Resetting stale reconciliation links…",
    done: false,
  });
  const resetStats = await resetReconciliationLinks();
  const dupLinksReset = await resetDuplicateLinks();

  // Step 2: Cross-source dedup (mark duplicates in DB)
  setProgress(operationId, {
    phase: "cross_source_dedup",
    current: 2,
    total: TOTAL_STEPS,
    message: "Marking cross-source duplicates…",
    done: false,
  });
  const dedupResult = await runCrossSourceDedup();

  // Step 3: L1→L2 matching
  setProgress(operationId, {
    phase: "l1l2",
    current: 3,
    total: TOTAL_STEPS,
    message: "Matching orders → payouts (L1→L2)…",
    done: false,
  });
  const l1l2Result = await matchLevel1ToLevel2();

  // Step 4: L2→L3 auto-matching
  setProgress(operationId, {
    phase: "l2l3",
    current: 4,
    total: TOTAL_STEPS,
    message: "Auto-matching payouts → bank deposits (L2→L3)…",
    done: false,
  });
  const l2l3AutoMatched = await autoMatchL2L3(0.9);

  // Step 5: L2→L3 suggestions
  setProgress(operationId, {
    phase: "suggestions",
    current: 5,
    total: TOTAL_STEPS,
    message: "Finding remaining L2→L3 suggestions…",
    done: false,
  });
  const l2l3Suggestions = await findL2L3Suggestions();

  // Step 6: Alert scan
  setProgress(operationId, {
    phase: "alerts",
    current: 6,
    total: TOTAL_STEPS,
    message: "Scanning for alerts…",
    done: false,
  });
  const newAlerts = await runAlertScan();

  // Step 7: Vendor & category normalization (using existing rule engine)
  setProgress(operationId, {
    phase: "normalize",
    current: 7,
    total: TOTAL_STEPS,
    message: "Normalizing vendors and categories…",
    done: false,
  });
  // Vendor alias resolution
  const { applyAliasesToVendors } = await import(
    "@/lib/services/vendor-aliases"
  );
  const vendorsUpdated = await applyAliasesToVendors();
  // Category normalization + auto-categorization
  const normResult = await normalizeCategories();

  // Step 8: Summary
  setProgress(operationId, {
    phase: "summary",
    current: 8,
    total: TOTAL_STEPS,
    message: "Building summary…",
    done: false,
  });
  const summary = await getReconciliationSummary();

  // Done — attach result
  completeProgress(operationId, {
    resetStats,
    dupLinksReset,
    dedupResult,
    l1l2: l1l2Result,
    l2l3AutoMatched,
    l2l3PendingSuggestions: l2l3Suggestions.length,
    newAlerts,
    vendorsUpdated,
    normResult,
    summary,
  });
}
