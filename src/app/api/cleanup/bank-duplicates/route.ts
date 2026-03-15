import { NextResponse } from "next/server";
import { runBankTransactionCleanup } from "@/lib/services/cleanup-bank-duplicates";

/**
 * POST /api/cleanup/bank-duplicates
 * One-time cleanup: link expenses to bank transactions + remove cross-source duplicates.
 */
export async function POST() {
  try {
    const result = await runBankTransactionCleanup();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Cleanup API] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
