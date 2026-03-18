/**
 * Category Normalization — Merges raw bank aggregator category names
 * to canonical ExpenseCategory names.
 *
 * This is data-driven: it reads the existing ExpenseCategory records
 * and maps raw category strings to the closest canonical match.
 * No hardcoded vendor names — only category name mapping.
 *
 * Also creates an "Opening Costs" category for transfer:funding records
 * and runs the existing auto-categorization rule engine.
 */

import { prisma } from "../../db/prisma";

interface NormalizeResult {
  categoriesMerged: number;
  openingCostsCreated: boolean;
  fundingRecordsTagged: number;
  autoCategorized: number;
}

/**
 * Build a mapping from raw category names to canonical ExpenseCategory names.
 * Uses fuzzy matching: if a raw category is a substring of (or contains) a
 * canonical name, it maps to that canonical name.
 */
async function buildCategoryMap(): Promise<Map<string, string>> {
  const categories = await prisma.expenseCategory.findMany({
    select: { name: true },
  });
  const canonicalNames = categories.map((c) => c.name);

  // Get all distinct raw categories from the primary source
  const rawCategories = await prisma.$queryRawUnsafe<{ category: string }[]>(`
    SELECT DISTINCT category FROM transactions
    WHERE type = 'expense' AND category IS NOT NULL
      AND category NOT LIKE 'transfer:%'
      AND duplicate_of_id IS NULL
  `);

  const map = new Map<string, string>();

  for (const { category: raw } of rawCategories) {
    const rawLower = raw.toLowerCase().trim();

    // Exact match
    const exact = canonicalNames.find(
      (c) => c.toLowerCase() === rawLower
    );
    if (exact) {
      if (exact !== raw) map.set(raw, exact); // Only map if different
      continue;
    }

    // Substring match: raw is contained in canonical or vice versa
    const substring = canonicalNames.find(
      (c) =>
        c.toLowerCase().includes(rawLower) ||
        rawLower.includes(c.toLowerCase())
    );
    if (substring) {
      map.set(raw, substring);
      continue;
    }

    // Special known merges (short RM names → full canonical names)
    const knownMerges: Record<string, string> = {
      ads: "Marketing & Advertising",
      salary: "Payroll & Salary",
      permits: "Permits & Licenses",
      rent: "Rent & Utilities",
    };
    const merged = knownMerges[rawLower];
    if (merged && canonicalNames.includes(merged)) {
      map.set(raw, merged);
    }
  }

  return map;
}

/**
 * Normalize categories on canonical transactions.
 */
export async function normalizeCategories(): Promise<NormalizeResult> {
  const result: NormalizeResult = {
    categoriesMerged: 0,
    openingCostsCreated: false,
    fundingRecordsTagged: 0,
    autoCategorized: 0,
  };

  // Step 1: Create "Opening Costs" category if it doesn't exist
  const existing = await prisma.expenseCategory.findFirst({
    where: { name: "Opening Costs" },
  });
  if (!existing) {
    await prisma.expenseCategory.create({
      data: {
        name: "Opening Costs",
        color: "#8B5CF6", // purple
        icon: "🏗️",
      },
    });
    result.openingCostsCreated = true;
  }

  // Step 2: Tag transfer:funding records as "Opening Costs"
  const fundingUpdate = await prisma.transaction.updateMany({
    where: {
      category: "transfer:funding",
      type: "expense",
      duplicateOfId: null,
    },
    data: { category: "Opening Costs" },
  });
  result.fundingRecordsTagged = fundingUpdate.count;

  // Step 3: Build category map and merge raw categories to canonical names
  const categoryMap = await buildCategoryMap();

  for (const [raw, canonical] of categoryMap) {
    const updated = await prisma.transaction.updateMany({
      where: {
        category: raw,
        type: "expense",
        duplicateOfId: null,
      },
      data: { category: canonical },
    });
    result.categoriesMerged += updated.count;
  }

  // Step 4: Run auto-categorization on expenses using the rule engine
  try {
    const { runAutoCategorization } = await import("../categorization");
    const autoResult = await runAutoCategorization();
    result.autoCategorized = autoResult;
  } catch {
    // Categorization module may not be available in all contexts
  }

  return result;
}
