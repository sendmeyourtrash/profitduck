import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  learnFromCategorization,
  runAutoCategorization,
} from "@/lib/services/categorization";

/**
 * GET /api/categorization-rules
 * List all categorization rules.
 */
export async function GET() {
  const rules = await prisma.categorizationRule.findMany({
    include: { category: true },
    orderBy: { priority: "desc" },
  });

  return NextResponse.json({ rules });
}

/**
 * POST /api/categorization-rules
 * Create a new rule or learn from categorization.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // If action=learn, create an auto-learned rule
    if (body.action === "learn") {
      const { vendorName, categoryId } = body;
      if (!vendorName || !categoryId) {
        return NextResponse.json(
          { error: "vendorName and categoryId required" },
          { status: 400 }
        );
      }
      await learnFromCategorization(vendorName, categoryId);
      return NextResponse.json({ success: true });
    }

    // If action=run, run auto-categorization on all expenses
    if (body.action === "run") {
      const categorized = await runAutoCategorization();
      return NextResponse.json({ categorized });
    }

    // Otherwise create a manual rule
    const { type, pattern, categoryId, priority } = body;
    if (!type || !pattern || !categoryId) {
      return NextResponse.json(
        { error: "type, pattern, and categoryId required" },
        { status: 400 }
      );
    }

    const rule = await prisma.categorizationRule.create({
      data: {
        type,
        pattern,
        categoryId,
        priority: priority || 0,
        createdFrom: "manual",
      },
      include: { category: true },
    });

    return NextResponse.json({ rule });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/categorization-rules
 * Delete a rule.
 */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  await prisma.categorizationRule.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
