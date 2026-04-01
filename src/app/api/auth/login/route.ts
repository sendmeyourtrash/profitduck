import { NextRequest, NextResponse } from "next/server";
import { verifyLogin, isPasswordSet, createSessionToken, buildSessionCookie } from "@/lib/services/auth";

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();
    if (typeof password !== "string" || !password) {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }
    if (!isPasswordSet()) {
      return NextResponse.json({ error: "No password configured. Complete setup first.", needsSetup: true }, { status: 403 });
    }
    if (!verifyLogin(password)) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    const token = createSessionToken();
    const response = NextResponse.json({ success: true });
    response.headers.set("Set-Cookie", buildSessionCookie(token));
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
