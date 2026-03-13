import { NextRequest, NextResponse } from "next/server";
import {
  reconcileMatch,
  unreconcileMatch,
} from "@/lib/services/reconciliation";

export async function POST(request: NextRequest) {
  try {
    const { payoutId, bankTransactionId } = await request.json();

    if (!payoutId || !bankTransactionId) {
      return NextResponse.json(
        { error: "payoutId and bankTransactionId are required" },
        { status: 400 }
      );
    }

    await reconcileMatch(payoutId, bankTransactionId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to reconcile",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { payoutId } = await request.json();

    if (!payoutId) {
      return NextResponse.json(
        { error: "payoutId is required" },
        { status: 400 }
      );
    }

    await unreconcileMatch(payoutId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to unreconcile",
      },
      { status: 500 }
    );
  }
}
