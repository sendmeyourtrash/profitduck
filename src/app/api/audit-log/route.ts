import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

/**
 * GET /api/audit-log
 * Retrieve audit log entries for an entity or all.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const entityType = searchParams.get("entityType");
  const entityId = searchParams.get("entityId");
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return NextResponse.json({ logs, total });
}

/**
 * POST /api/audit-log/edit
 * Edit a record and log the change in the audit trail.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { entityType, entityId, field, newValue, reason } = body;

    if (!entityType || !entityId || !field || newValue === undefined) {
      return NextResponse.json(
        { error: "entityType, entityId, field, and newValue required" },
        { status: 400 }
      );
    }

    // Get old value and update
    let oldValue: string | null = null;

    switch (entityType) {
      case "transaction": {
        const tx = await prisma.transaction.findUnique({
          where: { id: entityId },
        });
        if (!tx)
          return NextResponse.json({ error: "Not found" }, { status: 404 });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        oldValue = String((tx as any)[field] ?? "");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updateData: any = {};
        if (field === "amount") {
          updateData[field] = parseFloat(newValue);
        } else if (field === "date") {
          updateData[field] = new Date(newValue);
        } else {
          updateData[field] = newValue;
        }

        await prisma.transaction.update({
          where: { id: entityId },
          data: updateData,
        });
        break;
      }

      case "expense": {
        const exp = await prisma.expense.findUnique({
          where: { id: entityId },
        });
        if (!exp)
          return NextResponse.json({ error: "Not found" }, { status: 404 });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        oldValue = String((exp as any)[field] ?? "");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updateData: any = {};
        if (field === "amount") {
          updateData[field] = parseFloat(newValue);
        } else if (field === "date") {
          updateData[field] = new Date(newValue);
        } else {
          updateData[field] = newValue;
        }

        await prisma.expense.update({
          where: { id: entityId },
          data: updateData,
        });
        break;
      }

      case "payout": {
        const pay = await prisma.payout.findUnique({
          where: { id: entityId },
        });
        if (!pay)
          return NextResponse.json({ error: "Not found" }, { status: 404 });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        oldValue = String((pay as any)[field] ?? "");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updateData: any = {};
        if (["netAmount", "grossAmount", "fees"].includes(field)) {
          updateData[field] = parseFloat(newValue);
        } else if (field === "payoutDate") {
          updateData[field] = new Date(newValue);
        } else {
          updateData[field] = newValue;
        }

        await prisma.payout.update({
          where: { id: entityId },
          data: updateData,
        });
        break;
      }

      case "bankTransaction": {
        const bt = await prisma.bankTransaction.findUnique({
          where: { id: entityId },
        });
        if (!bt)
          return NextResponse.json({ error: "Not found" }, { status: 404 });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        oldValue = String((bt as any)[field] ?? "");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updateData: any = {};
        if (field === "amount") {
          updateData[field] = parseFloat(newValue);
        } else if (field === "date") {
          updateData[field] = new Date(newValue);
        } else {
          updateData[field] = newValue;
        }

        await prisma.bankTransaction.update({
          where: { id: entityId },
          data: updateData,
        });
        break;
      }

      default:
        return NextResponse.json(
          { error: "Unknown entity type" },
          { status: 400 }
        );
    }

    // Create audit log entry
    const auditEntry = await prisma.auditLog.create({
      data: {
        entityType,
        entityId,
        field,
        oldValue,
        newValue: String(newValue),
        reason: reason || null,
        actor: "user",
        transactionId: entityType === "transaction" ? entityId : null,
      },
    });

    return NextResponse.json({ auditEntry, oldValue, newValue });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
