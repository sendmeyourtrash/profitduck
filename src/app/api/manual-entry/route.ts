import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";

const DB_DIR = path.join(process.cwd(), "databases");

function openBankDb() {
  return new Database(path.join(DB_DIR, "bank.db"));
}

function ensureTransactionsTable(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT, original_date TEXT, account_type TEXT, account_name TEXT DEFAULT 'Manual Entry',
    account_number TEXT, institution_name TEXT, name TEXT, custom_name TEXT,
    amount REAL, description TEXT, category TEXT, note TEXT,
    ignored_from TEXT, tax_deductible TEXT, transaction_tags TEXT,
    source TEXT
  )`);
}

/**
 * POST /api/manual-entry
 * Create a manual transaction entry in bank.db.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, amount, type, category, description } = body;

    if (!date || amount === undefined || !type) {
      return NextResponse.json(
        { error: "Missing required fields: date, amount, type" },
        { status: 400 }
      );
    }

    const validTypes = ["income", "expense", "fee", "adjustment"];
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

    // Insert into bank.db transactions table with source='manual'
    // Expenses are positive amounts, income/deposits are negative
    const bankAmount = type === "expense" ? Math.abs(parsedAmount) : -Math.abs(parsedAmount);
    const db = openBankDb();
    ensureTransactionsTable(db);
    try {
      const result = db.prepare(
        `INSERT INTO transactions (date, name, description, amount, category, account_name, note, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'manual')`
      ).run(
        date,
        description || "Manual Entry",
        description || "Manual Entry",
        bankAmount,
        category || "Manual",
        "Manual Entry",
        `manual_entry:${type}`
      );
      return NextResponse.json({
        transaction: {
          id: result.lastInsertRowid,
          date,
          amount: parsedAmount,
          type,
          category,
          description,
          isManual: true,
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
 * GET /api/manual-entry
 * List manual entries.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  const db = openBankDb();
  ensureTransactionsTable(db);
  try {
    const transactions = db.prepare(
      `SELECT id, date, name as description, amount, category, note
       FROM transactions WHERE source = 'manual'
       ORDER BY date DESC LIMIT ? OFFSET ?`
    ).all(limit, offset) as {
      id: number; date: string; description: string; amount: string; category: string; note: string;
    }[];

    const countRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM transactions WHERE source = 'manual'`
    ).get() as { cnt: number };

    return NextResponse.json({
      transactions: transactions.map((t) => ({
        id: String(t.id),
        date: t.date,
        amount: parseFloat(t.amount) || 0,
        type: t.note?.startsWith("manual_entry:") ? t.note.split(":")[1] : "expense",
        category: t.category,
        description: t.description,
        isManual: true,
      })),
      total: countRow.cnt,
    });
  } finally {
    db.close();
  }
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

  const db = openBankDb();
  ensureTransactionsTable(db);
  try {
    const row = db.prepare(
      "SELECT id FROM transactions WHERE id = ? AND source = 'manual'"
    ).get(Number(id));

    if (!row) {
      return NextResponse.json(
        { error: "Manual entry not found" },
        { status: 404 }
      );
    }

    db.prepare("DELETE FROM transactions WHERE id = ? AND source = 'manual'").run(Number(id));
    return NextResponse.json({ success: true });
  } finally {
    db.close();
  }
}
