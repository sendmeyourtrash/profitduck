import { NextRequest, NextResponse } from "next/server";
import { exchangePublicToken, PlaidApiError } from "@/lib/services/plaid-api";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const publicToken = body.public_token;

    if (!publicToken) {
      return NextResponse.json(
        { error: "Missing public_token" },
        { status: 400 }
      );
    }

    const result = await exchangePublicToken(publicToken);
    return NextResponse.json({
      success: true,
      institutionName: result.institutionName,
      accountName: result.accountName,
    });
  } catch (error) {
    if (error instanceof PlaidApiError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 401 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Token exchange failed" },
      { status: 500 }
    );
  }
}
