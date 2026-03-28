import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  syncSquareCatalog,
  previewCatalogSync,
} from "@/lib/services/square-catalog-sync";
import {
  createProgressCallback,
  completeProgress,
  failProgress,
} from "@/lib/services/progress";
import { isSquareConfigured } from "@/lib/services/square-api";

/**
 * GET /api/square/catalog
 * Preview what a catalog sync would do without writing anything.
 */
export async function GET() {
  try {
    const preview = await previewCatalogSync();
    return NextResponse.json(preview);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to preview catalog";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/square/catalog
 * Sync Square catalog categories and item mappings.
 * Returns { operationId } immediately; progress via /api/progress/:id.
 */
export async function POST() {
  try {
    // Pre-check: fail fast if no token
    if (!isSquareConfigured()) {
      return NextResponse.json(
        { error: "Square is not connected. Add your token in Settings first." },
        { status: 400 }
      );
    }

    const operationId = randomUUID();
    const onProgress = createProgressCallback(operationId);

    // Run async — small delay so SSE client has time to connect
    setTimeout(async () => {
      try {
        const result = await syncSquareCatalog(onProgress);
        completeProgress(operationId, {
          message: `Catalog sync complete: ${result.categoriesCreated} categories created, ${result.itemsMapped} items mapped`,
          ...result,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Catalog sync failed";
        failProgress(operationId, message);
      }
    }, 100);

    return NextResponse.json({ operationId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start catalog sync";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
