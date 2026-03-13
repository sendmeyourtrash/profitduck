import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

/**
 * POST /api/manual-entry
 * Create a manual transaction entry.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, amount, type, category, description, sourcePlatform } = body;

    // Validate required fields
    if (!date || amount === undefined || !type) {
      return NextResponse.json(
        { error: "Missing required fields: date, amount, type" },
        { status: 400 }
      );
    }

    const validTypes = ["income", "expense", "fee", "payout", "adjustment"];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount)) {
      return NextResponse.json(
        { error: "Amount must be a valid number" },
        { status: 400 }
      );
    }

    const transaction = await prisma.transaction.create({
      data: {
        date: new Date(date),
        amount: parsedAmount,
        type,
        sourcePlatform: sourcePlatform || "manual",
        category: category || null,
        description: description || null,
        isManual: true,
        rawData: JSON.stringify({ manualEntry: true, ...body }),
      },
    });

    // If it's an expense, also create an expense record
    if (type === "expense" && description) {
      let vendor = await prisma.vendor.findUnique({
        where: { name: description },
      });
      if (!vendor) {
        vendor = await prisma.vendor.create({
          data: { name: description, category: category || null },
        });
      }
      await prisma.expense.create({
        data: {
          vendorId: vendor.id,
          amount: Math.abs(parsedAmount),
          date: new Date(date),
          category: category || null,
          notes: "Manual entry",
        },
      });
    }

    return NextResponse.json({ transaction });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/manual-entry
 * List manual entries.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where: { isManual: true },
      orderBy: { date: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.transaction.count({ where: { isManual: true } }),
  ]);

  return NextResponse.json({ transactions, total });
}

/**
 * DELETE /api/manual-entry
 * Delete a manual entry.
 */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const tx = await prisma.transaction.findUnique({ where: { id } });
  if (!tx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!tx.isManual) {
    return NextResponse.json(
      { error: "Can only delete manual entries" },
      { status: 403 }
    );
  }

  await prisma.transaction.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
