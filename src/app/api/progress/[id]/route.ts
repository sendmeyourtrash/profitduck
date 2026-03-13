import { NextRequest } from "next/server";
import { getProgress } from "@/lib/services/progress";

const POLL_INTERVAL_MS = 300;
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * GET /api/progress/:id
 * Server-Sent Events stream for tracking operation progress.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const startTime = Date.now();
      let lastJson = "";

      const send = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      const poll = async () => {
        while (Date.now() - startTime < TIMEOUT_MS) {
          const progress = getProgress(id);

          if (progress) {
            const json = JSON.stringify(progress);
            // Only send if changed
            if (json !== lastJson) {
              lastJson = json;
              send(json);
            }

            if (progress.done) {
              controller.close();
              return;
            }
          }

          await new Promise((resolve) =>
            setTimeout(resolve, POLL_INTERVAL_MS)
          );
        }

        // Timeout
        send(
          JSON.stringify({
            phase: "error",
            current: 0,
            total: 0,
            message: "Operation timed out",
            done: true,
            error: "Operation timed out",
          })
        );
        controller.close();
      };

      poll().catch(() => {
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
