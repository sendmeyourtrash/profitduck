import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { syncSquareFees, getLastSyncStatus } from "@/lib/services/square-sync";
import { isSquareConfigured, initializeTokenFromDb } from "@/lib/services/square-api";
import {
  createProgressCallback,
  completeProgress,
  failProgress,
} from "@/lib/services/progress";
import { isAutoSyncEnabled, getLastSyncAt, setLastSyncAt } from "@/lib/services/settings";
import { isSyncInProgress, setSyncInProgress } from "@/lib/services/scheduler";

/**
 * GET /api/sync
 * Returns sync status information.
 */
export async function GET() {
  await initializeTokenFromDb();

  const [lastSync, autoSync, lastSyncAt] = await Promise.all([
    getLastSyncStatus(),
    isAutoSyncEnabled(),
    getLastSyncAt(),
  ]);

  return NextResponse.json({
    lastSync,
    autoSyncEnabled: autoSync,
    lastSyncAt,
    squareConfigured: isSquareConfigured(),
    syncing: isSyncInProgress(),
  });
}

/**
 * POST /api/sync
 * Trigger a manual data sync. Returns operationId for SSE progress tracking.
 */
export async function POST() {
  await initializeTokenFromDb();

  if (!isSquareConfigured()) {
    return NextResponse.json(
      { error: "No Square API token configured. Add one in Settings first." },
      { status: 400 }
    );
  }

  if (isSyncInProgress()) {
    return NextResponse.json(
      { error: "A sync is already in progress. Please wait for it to finish." },
      { status: 409 }
    );
  }

  // Incremental sync: only fetch payments since last successful sync
  // (with 1-day overlap buffer to catch edge cases around timing)
  const lastSync = await getLastSyncAt();
  let startDate: string | undefined;
  if (lastSync) {
    const d = new Date(lastSync);
    d.setDate(d.getDate() - 1); // 1-day buffer
    startDate = d.toISOString();
  }

  const operationId = uuidv4();
  const onProgress = createProgressCallback(operationId);

  // Fire and forget — progress tracked via SSE
  setSyncInProgress(true);
  syncSquareFees(startDate, undefined, onProgress)
    .then(async (result) => {
      await setLastSyncAt(new Date().toISOString());
      completeProgress(operationId, result);
    })
    .catch((error) => {
      const msg = error instanceof Error ? error.message : "Sync failed";
      failProgress(operationId, msg);
    })
    .finally(() => {
      setSyncInProgress(false);
    });

  return NextResponse.json({ operationId });
}
