import { NextRequest, NextResponse } from "next/server";

/**
 * API authentication middleware.
 *
 * When API_KEY env var is set, all /api/ routes require a matching
 * x-api-key header. When API_KEY is not set, all routes are open
 * (local development mode).
 */
export function middleware(request: NextRequest) {
  const apiKey = process.env.API_KEY;

  // No API_KEY configured = open access (local dev)
  if (!apiKey) {
    return NextResponse.next();
  }

  const requestKey = request.headers.get("x-api-key");

  if (requestKey !== apiKey) {
    return NextResponse.json(
      { error: "Unauthorized — invalid or missing x-api-key header" },
      { status: 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
