import { NextResponse } from "next/server";
import {
  initializePlaidFromDb,
  clearPlaidCredentials,
} from "@/lib/services/plaid-api";

export async function POST() {
  try {
    await initializePlaidFromDb();
    await clearPlaidCredentials();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to disconnect" },
      { status: 500 }
    );
  }
}
