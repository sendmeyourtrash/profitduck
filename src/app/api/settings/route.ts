import { NextRequest, NextResponse } from "next/server";
import {
  getAllSettingsMasked,
  setSetting,
  deleteSetting,
  SETTING_KEYS,
} from "@/lib/services/settings";
import {
  setSquareToken,
  clearSquareToken,
  validateToken,
  initializeTokenFromDb,
  isSquareConfigured,
  SquareApiError,
} from "@/lib/services/square-api";
import {
  startScheduler,
  stopScheduler,
  isSchedulerRunning,
} from "@/lib/services/scheduler";

/**
 * GET /api/settings
 * Returns all settings with sensitive values masked.
 */
export async function GET() {
  try {
    await initializeTokenFromDb();
    const settings = await getAllSettingsMasked();
    return NextResponse.json({
      settings,
      squareConfigured: isSquareConfigured(),
      schedulerRunning: isSchedulerRunning(),
    });
  } catch (error) {
    console.error("[Settings API] GET error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/settings
 * Set a setting value.
 * Body: { key: string, value: string }
 *
 * For square_api_token: validates the token before saving.
 * For auto_sync_enabled: starts/stops the scheduler.
 */
export async function POST(request: NextRequest) {
  try {
    const { key, value } = await request.json();

    if (typeof key !== "string" || typeof value !== "string") {
      return NextResponse.json(
        { error: "key and value are required strings" },
        { status: 400 }
      );
    }

    // Square API token — validate first
    if (key === SETTING_KEYS.SQUARE_API_TOKEN) {
      try {
        const result = await validateToken(value.trim());
        await setSquareToken(value.trim());
        return NextResponse.json({
          success: true,
          merchantName: result.merchantName,
        });
      } catch (err) {
        if (err instanceof SquareApiError) {
          return NextResponse.json(
            { error: err.message, code: err.code },
            { status: 401 }
          );
        }
        throw err;
      }
    }

    // Auto-sync toggle
    if (key === SETTING_KEYS.AUTO_SYNC_ENABLED) {
      await setSetting(key, value);
      if (value === "true") {
        startScheduler(24);
      } else {
        stopScheduler();
      }
      return NextResponse.json({ success: true, schedulerRunning: isSchedulerRunning() });
    }

    // Generic setting
    await setSetting(key, value);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/settings
 * Remove a setting.
 * Body: { key: string }
 */
export async function DELETE(request: NextRequest) {
  try {
    const { key } = await request.json();

    if (typeof key !== "string") {
      return NextResponse.json({ error: "key is required" }, { status: 400 });
    }

    // If deleting Square token, also clear runtime
    if (key === SETTING_KEYS.SQUARE_API_TOKEN) {
      await clearSquareToken();
    }

    // If deleting auto-sync, stop scheduler
    if (key === SETTING_KEYS.AUTO_SYNC_ENABLED) {
      stopScheduler();
    }

    await deleteSetting(key);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
