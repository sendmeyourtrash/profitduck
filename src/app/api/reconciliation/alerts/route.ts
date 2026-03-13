import { NextRequest, NextResponse } from "next/server";
import { getActiveAlerts, resolveAlert } from "@/lib/services/reconciliation";

/**
 * GET /api/reconciliation/alerts
 * Returns active (unresolved) alerts with optional filters.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || undefined;
  const severity = searchParams.get("severity") || undefined;
  const platform = searchParams.get("platform") || undefined;

  const alerts = await getActiveAlerts({ type, severity, platform });

  return NextResponse.json({ alerts });
}

/**
 * PATCH /api/reconciliation/alerts
 * Resolve an alert by ID.
 */
export async function PATCH(request: NextRequest) {
  try {
    const { alertId, resolvedBy } = await request.json();

    if (!alertId) {
      return NextResponse.json(
        { error: "alertId is required" },
        { status: 400 }
      );
    }

    await resolveAlert(alertId, resolvedBy || "manual");
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to resolve alert",
      },
      { status: 500 }
    );
  }
}
