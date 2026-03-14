import { NextResponse } from "next/server";
import { getPlaidStatus } from "@/lib/services/plaid-api";

export async function GET() {
  try {
    const status = await getPlaidStatus();
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get Plaid status" },
      { status: 500 }
    );
  }
}
