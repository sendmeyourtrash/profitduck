import { NextRequest, NextResponse } from "next/server";
import { updateReconMatch, unmatchReconMatch } from "@/lib/db/config-db";

export async function POST(request: NextRequest) {
  try {
    const { matchId, bankTxId, bankDate, bankAmount } = await request.json();

    if (!matchId || !bankTxId) {
      return NextResponse.json(
        { error: "matchId and bankTxId are required" },
        { status: 400 }
      );
    }

    updateReconMatch(Number(matchId), Number(bankTxId), bankDate, Number(bankAmount));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to match" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { matchId } = await request.json();

    if (!matchId) {
      return NextResponse.json(
        { error: "matchId is required" },
        { status: 400 }
      );
    }

    unmatchReconMatch(Number(matchId));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to unmatch" },
      { status: 500 }
    );
  }
}
