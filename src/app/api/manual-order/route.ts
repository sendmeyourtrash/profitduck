import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";

const DB_DIR = path.join(process.cwd(), "databases");

function openSalesDb() {
  return new Database(path.join(DB_DIR, "sales.db"));
}

/**
 * POST /api/manual-order
 * Create a manual order entry in sales.db.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, platform, grossSales, tax, tip, fees, items, description, diningOption } = body;

    if (!date || grossSales === undefined) {
      return NextResponse.json(
        { error: "Missing required fields: date, grossSales" },
        { status: 400 }
      );
    }

    const parsedGross = parseFloat(grossSales);
    if (isNaN(parsedGross)) {
      return NextResponse.json({ error: "grossSales must be a valid number" }, { status: 400 });
    }

    const parsedTax = parseFloat(tax) || 0;
    const parsedTip = parseFloat(tip) || 0;
    const parsedFees = parseFloat(fees) || 0;
    const netSales = parsedGross - Math.abs(parsedFees);
    const orderId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const db = openSalesDb();
    try {
      const result = db.prepare(
        `INSERT INTO orders (
          date, time, platform, order_id, gross_sales, tax, tip, net_sales,
          order_status, items, item_count, fees_total, dining_option,
          commission_fee, processing_fee, delivery_fee, marketing_fee,
          marketing_total, refunds_total, adjustments_total, other_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        date,
        null, // time
        platform || "manual",
        orderId,
        parsedGross,
        parsedTax,
        parsedTip,
        netSales,
        "completed",
        items || description || "Manual Order",
        items ? items.split("|").length : 1,
        -Math.abs(parsedFees),
        diningOption || null,
        0, 0, 0, 0, // commission, processing, delivery, marketing fees
        0, 0, 0, 0  // marketing_total, refunds, adjustments, other
      );

      return NextResponse.json({
        order: {
          id: result.lastInsertRowid,
          date,
          platform: platform || "manual",
          orderId,
          grossSales: parsedGross,
          tax: parsedTax,
          tip: parsedTip,
          fees: parsedFees,
          netSales,
        },
      });
    } finally {
      db.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/manual-order
 * List manual orders.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  const db = openSalesDb();
  try {
    const orders = db.prepare(
      `SELECT id, date, platform, order_id, gross_sales, tax, tip, net_sales,
              fees_total, items, dining_option
       FROM orders WHERE order_id LIKE 'manual-%'
       ORDER BY date DESC LIMIT ? OFFSET ?`
    ).all(limit, offset) as {
      id: number; date: string; platform: string; order_id: string;
      gross_sales: number; tax: number; tip: number; net_sales: number;
      fees_total: number; items: string; dining_option: string;
    }[];

    const countRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM orders WHERE order_id LIKE 'manual-%'`
    ).get() as { cnt: number };

    return NextResponse.json({
      orders: orders.map((o) => ({
        id: String(o.id),
        date: o.date,
        platform: o.platform,
        orderId: o.order_id,
        grossSales: o.gross_sales,
        tax: o.tax,
        tip: o.tip,
        netSales: o.net_sales,
        fees: Math.abs(o.fees_total || 0),
        items: o.items,
        diningOption: o.dining_option,
      })),
      total: countRow.cnt,
    });
  } finally {
    db.close();
  }
}

/**
 * DELETE /api/manual-order
 * Delete a manual order.
 */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const db = openSalesDb();
  try {
    const row = db.prepare(
      "SELECT id FROM orders WHERE id = ? AND order_id LIKE 'manual-%'"
    ).get(Number(id));

    if (!row) {
      return NextResponse.json({ error: "Manual order not found" }, { status: 404 });
    }

    db.prepare("DELETE FROM orders WHERE id = ?").run(Number(id));
    return NextResponse.json({ success: true });
  } finally {
    db.close();
  }
}
