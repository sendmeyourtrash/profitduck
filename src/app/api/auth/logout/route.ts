import { NextResponse } from "next/server";
import { buildLogoutCookie } from "@/lib/services/auth";

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.headers.set("Set-Cookie", buildLogoutCookie());
  return response;
}
