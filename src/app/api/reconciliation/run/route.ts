import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { runReconciliation } from "@/lib/services/reconciliation";
import {
  setProgress,
  completeProgress,
  failProgress,
} from "@/lib/services/progress";

/**
 * POST /api/reconciliation/run
 * Returns an operationId immediately and runs reconciliation in the background.
 */
export async function POST() {
  const operationId = `recon-${randomUUID().slice(0, 8)}`;

  setProgress(operationId, {
    phase: "starting",
    current: 0,
    total: 3,
    message: "Starting reconciliation...",
    done: false,
  });

  // Run in background
  (async () => {
    try {
      setProgress(operationId, {
        phase: "matching",
        current: 1,
        total: 3,
        message: "Matching orders to bank deposits...",
        done: false,
      });

      const result = runReconciliation();

      setProgress(operationId, {
        phase: "complete",
        current: 3,
        total: 3,
        message: "Reconciliation complete",
        done: false,
      });

      completeProgress(operationId, result);
    } catch (error) {
      failProgress(
        operationId,
        error instanceof Error ? error.message : "Reconciliation failed"
      );
    }
  })();

  return NextResponse.json({ operationId });
}
