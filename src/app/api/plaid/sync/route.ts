import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  initializePlaidFromDb,
  isPlaidConfigured,
} from "@/lib/services/plaid-api";
import { syncPlaidTransactions } from "@/lib/services/plaid-sync";
import {
  createProgressCallback,
  completeProgress,
  failProgress,
} from "@/lib/services/progress";
import {
  isPlaidSyncInProgress,
  setPlaidSyncInProgress,
} from "@/lib/services/scheduler";

export async function POST() {
  try {
    await initializePlaidFromDb();

    if (!isPlaidConfigured()) {
      return NextResponse.json(
        { error: "Plaid is not configured. Connect your bank account in Settings." },
        { status: 400 }
      );
    }

    if (isPlaidSyncInProgress()) {
      return NextResponse.json(
        { error: "A Plaid sync is already in progress." },
        { status: 409 }
      );
    }

    const operationId = uuidv4();
    const onProgress = createProgressCallback(operationId);

    setPlaidSyncInProgress(true);

    // Fire and forget — client polls /api/progress/[operationId]
    syncPlaidTransactions(onProgress)
      .then((result) => {
        completeProgress(operationId, result);
      })
      .catch((error) => {
        failProgress(
          operationId,
          error instanceof Error ? error.message : "Plaid sync failed"
        );
      })
      .finally(() => {
        setPlaidSyncInProgress(false);
      });

    return NextResponse.json({ operationId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start sync" },
      { status: 500 }
    );
  }
}
