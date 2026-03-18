import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { syncSquareFees, getLastSyncDate } from "@/lib/services/square-sync";
import {
  createProgressCallback,
  completeProgress,
  failProgress,
  setProgress,
} from "@/lib/services/progress";

/**
 * POST /api/square/sync
 * Sync Square payments into sales.db with full item details.
 * Returns { operationId } immediately; progress streamed via /api/progress/:id.
 */
export async function POST(request: NextRequest) {
  try {
    let startDate: string | undefined;
    let endDate: string | undefined;

    try {
      const body = await request.json();
      startDate = body.startDate;
      endDate = body.endDate;
    } catch {
      // No body — full sync
    }

    // Default: sync from last known date
    if (!startDate) {
      const lastDate = getLastSyncDate();
      if (lastDate) {
        startDate = lastDate + "T00:00:00Z";
      }
    }

    const operationId = randomUUID();
    setProgress(operationId, {
      phase: "starting",
      current: 0,
      total: 0,
      message: "Starting Square API sync...",
      done: false,
    });

    const onProgress = createProgressCallback(operationId);

    syncSquareFees(startDate, endDate, onProgress)
      .then((result) => {
        completeProgress(operationId, result);
      })
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        console.error("[Square Sync API] Error:", message);
        failProgress(operationId, message);
      });

    return NextResponse.json({ operationId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Square Sync API] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/square/sync
 * Get the last sync date.
 */
export async function GET() {
  const lastDate = getLastSyncDate();
  return NextResponse.json({ lastSyncDate: lastDate });
}
