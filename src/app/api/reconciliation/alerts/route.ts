import { NextRequest, NextResponse } from "next/server";
import { getReconAlerts, resolveReconAlert } from "@/lib/db/config-db";

/**
 * GET /api/reconciliation/alerts
 * Returns active (unresolved) alerts.
 */
export async function GET() {
  const alerts = getReconAlerts(false);
  return NextResponse.json({
    alerts: alerts.map((a) => ({
      id: a.id,
      type: a.type,
      severity: a.severity,
      message: a.message,
      platform: a.platform,
      resolved: a.resolved === 1,
      createdAt: a.created_at,
    })),
  });
}

/**
 * PATCH /api/reconciliation/alerts
 * Resolve an alert by ID.
 */
export async function PATCH(request: NextRequest) {
  try {
    const { alertId } = await request.json();

    if (!alertId) {
      return NextResponse.json(
        { error: "alertId is required" },
        { status: 400 }
      );
    }

    resolveReconAlert(Number(alertId));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to resolve alert" },
      { status: 500 }
    );
  }
}
