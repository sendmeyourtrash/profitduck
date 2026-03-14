/**
 * In-process auto-sync scheduler.
 * Uses setInterval + globalThis to persist across hot-reloads.
 * Runs syncSquareFees() on the configured interval when enabled.
 */

import { syncSquareFees } from "./square-sync";
import { isAutoSyncEnabled, getLastSyncAt, setLastSyncAt } from "./settings";

const globalStore = globalThis as unknown as {
  __syncScheduler?: ReturnType<typeof setInterval>;
  __isSyncing?: boolean;
};

/**
 * Start the auto-sync scheduler. Clears any existing interval first.
 */
export function startScheduler(intervalHours: number = 24): void {
  stopScheduler();
  const intervalMs = intervalHours * 60 * 60 * 1000;

  console.log(
    `[Scheduler] Starting auto-sync every ${intervalHours}h`
  );

  globalStore.__syncScheduler = setInterval(async () => {
    // Check if still enabled
    const enabled = await isAutoSyncEnabled();
    if (!enabled) {
      console.log("[Scheduler] Auto-sync disabled, skipping");
      return;
    }

    // Prevent concurrent syncs
    if (globalStore.__isSyncing) {
      console.log("[Scheduler] Sync already running, skipping");
      return;
    }

    globalStore.__isSyncing = true;
    try {
      // Incremental: only fetch since last sync (with 1-day buffer)
      const lastSync = await getLastSyncAt();
      let startDate: string | undefined;
      if (lastSync) {
        const d = new Date(lastSync);
        d.setDate(d.getDate() - 1);
        startDate = d.toISOString();
      }

      console.log("[Scheduler] Running auto-sync...", startDate ? `since ${startDate}` : "full sync");
      const result = await syncSquareFees(startDate);
      await setLastSyncAt(new Date().toISOString());
      console.log("[Scheduler] Auto-sync complete:", {
        enriched: result.enriched,
        totalPayments: result.totalPayments,
      });
    } catch (error) {
      console.error(
        "[Scheduler] Auto-sync failed:",
        error instanceof Error ? error.message : error
      );
    } finally {
      globalStore.__isSyncing = false;
    }
  }, intervalMs);
}

/**
 * Stop the auto-sync scheduler.
 */
export function stopScheduler(): void {
  if (globalStore.__syncScheduler) {
    clearInterval(globalStore.__syncScheduler);
    globalStore.__syncScheduler = undefined;
    console.log("[Scheduler] Stopped auto-sync");
  }
}

/**
 * Check if the scheduler is currently running.
 */
export function isSchedulerRunning(): boolean {
  return !!globalStore.__syncScheduler;
}

/**
 * Check if a sync is currently in progress.
 */
export function isSyncInProgress(): boolean {
  return !!globalStore.__isSyncing;
}

/**
 * Set/clear the syncing flag (used by manual sync to prevent overlap).
 */
export function setSyncInProgress(v: boolean): void {
  globalStore.__isSyncing = v;
}
