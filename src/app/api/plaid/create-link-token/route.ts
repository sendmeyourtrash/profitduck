import { NextResponse } from "next/server";
import { createLinkToken, PlaidApiError } from "@/lib/services/plaid-api";

export async function POST() {
  try {
    const linkToken = await createLinkToken();
    return NextResponse.json({ link_token: linkToken });
  } catch (error) {
    if (error instanceof PlaidApiError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create link token" },
      { status: 500 }
    );
  }
}
