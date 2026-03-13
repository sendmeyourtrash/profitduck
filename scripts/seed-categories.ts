/**
 * Seed expense categories, create auto-categorization rules,
 * and link existing expenses to their categories.
 *
 * Run with: npx tsx scripts/seed-categories.ts
 */
import { prisma } from "../src/lib/db/prisma";
import {
  ensureCategoriesAndRules,
  getDefaultCategories,
} from "../src/lib/services/categorization";

async function main() {
  console.log("=== Category Seeding & Expense Linking ===\n");

  // 1. Seed categories and create category_match rules
  console.log("Seeding categories and rules...");
  await ensureCategoriesAndRules();
  console.log("  Done.\n");

  // 2. Auto-link expenses based on raw category strings
  console.log("Auto-linking expenses to categories...");
  const defaults = getDefaultCategories();
  let totalLinked = 0;

  for (const cat of defaults) {
    if (!cat.rawCategories || cat.rawCategories.length === 0) continue;

    const expCat = await prisma.expenseCategory.findFirst({
      where: { name: cat.name },
    });
    if (!expCat) continue;

    for (const rawCat of cat.rawCategories) {
      const result = await prisma.expense.updateMany({
        where: {
          category: rawCat,
          expenseCategoryId: null,
        },
        data: {
          expenseCategoryId: expCat.id,
        },
      });
      if (result.count > 0) {
        console.log(
          `  Linked ${result.count} expenses to "${cat.name}" (raw: "${rawCat}")`
        );
        totalLinked += result.count;
      }
    }
  }
  console.log(`  Total linked: ${totalLinked}\n`);

  // 3. Verify
  console.log("=== Results ===\n");
  const categories = await prisma.expenseCategory.findMany({
    include: {
      _count: { select: { expenses: true, rules: true } },
    },
    orderBy: { name: "asc" },
  });

  for (const c of categories) {
    const pad = c.name.padEnd(30);
    console.log(
      `  ${pad} ${c._count.expenses} expenses, ${c._count.rules} rules`
    );
  }

  const linked = await prisma.expense.count({
    where: { expenseCategoryId: { not: null } },
  });
  const unlinked = await prisma.expense.count({
    where: { expenseCategoryId: null },
  });
  console.log(`\n  Linked: ${linked}, Unlinked: ${unlinked}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
