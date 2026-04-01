import { NextRequest, NextResponse } from "next/server";
import { isPasswordSet, verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/services/auth";

export async function GET(request: NextRequest) {
  const passwordSet = isPasswordSet();
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authenticated = sessionToken ? verifySessionToken(sessionToken) : false;
  return NextResponse.json({ passwordSet, authenticated });
}
