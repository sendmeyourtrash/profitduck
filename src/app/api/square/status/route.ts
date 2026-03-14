import { NextRequest, NextResponse } from "next/server";
import {
  isSquareConfigured,
  setSquareToken,
  clearSquareToken,
  validateToken,
  initializeTokenFromDb,
  SquareApiError,
} from "@/lib/services/square-api";

/**
 * GET /api/square/status
 * Check if the Square API token is configured.
 */
export async function GET() {
  await initializeTokenFromDb();
  const configured = isSquareConfigured();
  return NextResponse.json({ configured });
}

/**
 * POST /api/square/status
 * Set or clear the Square API token at runtime.
 * Body: { token: string } to set, or { action: "disconnect" } to clear.
 * Validates the token against Square's API before accepting it.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Disconnect
    if (body.action === "disconnect") {
      await clearSquareToken();
      return NextResponse.json({ configured: false });
    }

    const { token } = body;

    if (typeof token !== "string" || !token.trim()) {
      return NextResponse.json(
        { error: "Token is required" },
        { status: 400 }
      );
    }

    // Validate against Square API before storing
    try {
      const result = await validateToken(token.trim());
      await setSquareToken(token);
      return NextResponse.json({
        configured: true,
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
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
