/**
 * In-memory progress store for tracking long-running operations
 * (file imports, API syncs). Used with the SSE endpoint at /api/progress/[id].
 */

export interface ProgressState {
  phase: string;
  current: number;
  total: number;
  message: string;
  done: boolean;
  result?: unknown;
  error?: string;
}

export type ProgressCallback = (progress: {
  phase: string;
  current: number;
  total: number;
  message: string;
}) => void;

const AUTO_CLEANUP_MS = 5 * 60 * 1000; // 5 minutes

// Use globalThis to ensure the progress store is shared across all API routes
// in Next.js dev mode (Turbopack can create separate module instances per route).
const globalStore = globalThis as unknown as {
  __progressStore?: Map<string, ProgressState>;
};

if (!globalStore.__progressStore) {
  globalStore.__progressStore = new Map<string, ProgressState>();
}

const store = globalStore.__progressStore;

export function setProgress(id: string, state: ProgressState) {
  store.set(id, state);
  if (state.done) {
    setTimeout(() => store.delete(id), AUTO_CLEANUP_MS);
  }
}

export function getProgress(id: string): ProgressState | undefined {
  return store.get(id);
}

/**
 * Create a ProgressCallback that writes to the store for a given operation ID.
 */
export function createProgressCallback(operationId: string): ProgressCallback {
  return ({ phase, current, total, message }) => {
    setProgress(operationId, { phase, current, total, message, done: false });
  };
}

/**
 * Mark an operation as complete with its result.
 */
export function completeProgress(operationId: string, result: unknown) {
  setProgress(operationId, {
    phase: "done",
    current: 1,
    total: 1,
    message: "Complete",
    done: true,
    result,
  });
}

/**
 * Mark an operation as failed with an error message.
 */
export function failProgress(operationId: string, error: string) {
  setProgress(operationId, {
    phase: "error",
    current: 0,
    total: 0,
    message: error,
    done: true,
    error,
  });
}
