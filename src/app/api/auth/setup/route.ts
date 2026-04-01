import { NextRequest, NextResponse } from "next/server";
import { isPasswordSet, setupPassword, createSessionToken, buildSessionCookie } from "@/lib/services/auth";

export async function POST(request: NextRequest) {
  try {
    if (isPasswordSet()) {
      return NextResponse.json({ error: "Password already configured" }, { status: 403 });
    }
    const { password } = await request.json();
    if (typeof password !== "string" || !password) {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }
    setupPassword(password);
    const token = createSessionToken();
    const response = NextResponse.json({ success: true });
    response.headers.set("Set-Cookie", buildSessionCookie(token));
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("at least 8") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
