import { NextRequest, NextResponse } from "next/server";

// Hardcoded — can't import from auth.ts because middleware runs in Edge runtime
const SESSION_COOKIE_NAME = "pd_session";

/**
 * Authentication middleware.
 *
 * Two auth methods:
 *   1. Session cookie (pd_session) — browser login flow
 *   2. x-api-key header — Chrome extension / programmatic access
 *
 * Route access:
 *   /login, /setup, /api/auth/* — always open
 *   /api/*                      — session cookie OR x-api-key
 *   /*                          — session cookie, redirect to /login if missing
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow: auth pages, auth API, static assets
  if (
    pathname === "/login" ||
    pathname === "/setup" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname === "/icon.png" ||
    pathname === "/logo.png"
  ) {
    return NextResponse.next();
  }

  const apiKey = process.env.API_KEY;
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const requestApiKey = request.headers.get("x-api-key");

  // API routes: accept session cookie OR x-api-key
  if (pathname.startsWith("/api/")) {
    if (sessionToken) return NextResponse.next();
    if (apiKey && requestApiKey === apiKey) return NextResponse.next();
    // No API_KEY configured and no session = open access (local dev without setup)
    if (!apiKey) return NextResponse.next();

    return NextResponse.json(
      { error: "Unauthorized — invalid or missing credentials" },
      { status: 401 }
    );
  }

  // Page requests: require session cookie
  if (sessionToken) return NextResponse.next();

  // No session — redirect to login
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
