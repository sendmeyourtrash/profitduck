"use client";

import { useEffect, useRef } from "react";
import type { ProgressState } from "@/components/ui/ProgressBar";

/**
 * Subscribe to SSE progress updates for a long-running operation.
 * Uses the /api/progress/[id] endpoint.
 */
export function useProgressStream(
  operationId: string | null,
  onUpdate: (progress: ProgressState) => void,
  onDone: (progress: ProgressState) => void
) {
  const onUpdateRef = useRef(onUpdate);
  const onDoneRef = useRef(onDone);
  onUpdateRef.current = onUpdate;
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!operationId) return;

    const eventSource = new EventSource(`/api/progress/${operationId}`);

    eventSource.onmessage = (event) => {
      try {
        receivedMessage = true;
        const progress: ProgressState = JSON.parse(event.data);
        if (progress.done) {
          onDoneRef.current(progress);
          eventSource.close();
        } else {
          onUpdateRef.current(progress);
        }
      } catch {
        // ignore parse errors
      }
    };

    let receivedMessage = false;

    eventSource.onerror = () => {
      eventSource.close();
      // If we never received any message, the connection failed entirely —
      // notify the caller so the UI doesn't stay stuck in a loading state.
      if (!receivedMessage) {
        onDoneRef.current({
          phase: "error",
          current: 0,
          total: 0,
          message: "Lost connection to sync progress",
          done: true,
          error: "Lost connection to sync progress. The sync may still be running in the background.",
        });
      }
    };

    return () => {
      eventSource.close();
    };
  }, [operationId]);
}
