import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  ensureCategoriesAndRules,
  getDefaultCategories,
} from "@/lib/services/categorization";

/**
 * GET /api/expense-categories
 * List all expense categories with expense counts.
 * Auto-seeds categories and links expenses on first access.
 */
export async function GET() {
  let categories = await prisma.expenseCategory.findMany({
    include: {
      _count: { select: { expenses: true, rules: true } },
      children: true,
    },
    orderBy: { name: "asc" },
  });

  // Seed defaults if no categories exist
  if (categories.length === 0) {
    await ensureCategoriesAndRules();

    // Auto-link existing expenses based on raw category strings
    await autoLinkExpenses();

    categories = await prisma.expenseCategory.findMany({
      include: {
        _count: { select: { expenses: true, rules: true } },
        children: true,
      },
      orderBy: { name: "asc" },
    });
  }

  return NextResponse.json({ categories });
}

/**
 * POST /api/expense-categories
 * Create a new expense category.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, color, icon, parentId } = body;

    if (!name) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    const category = await prisma.expenseCategory.create({
      data: {
        name,
        color: color || null,
        icon: icon || null,
        parentId: parentId || null,
      },
    });

    return NextResponse.json({ category });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/expense-categories
 * Update an expense category.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, color, icon } = body;

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    const category = await prisma.expenseCategory.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(color !== undefined ? { color } : {}),
        ...(icon !== undefined ? { icon } : {}),
      },
    });

    return NextResponse.json({ category });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Auto-link expenses to ExpenseCategory based on their raw category strings.
 * Maps CSV categories like "Shopping", "Groceries" to the structured ExpenseCategory entries.
 */
async function autoLinkExpenses() {
  const defaults = getDefaultCategories();

  for (const cat of defaults) {
    if (!cat.rawCategories || cat.rawCategories.length === 0) continue;

    // Find the ExpenseCategory
    const expCat = await prisma.expenseCategory.findFirst({
      where: { name: cat.name },
    });
    if (!expCat) continue;

    // Link all expenses that have matching raw categories
    for (const rawCat of cat.rawCategories) {
      await prisma.expense.updateMany({
        where: {
          category: rawCat,
          expenseCategoryId: null,
        },
        data: {
          expenseCategoryId: expCat.id,
        },
      });
    }
  }
}
