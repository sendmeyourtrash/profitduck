import { prisma } from "../../db/prisma";

/**
 * Auto-categorize an expense based on categorization rules.
 * Checks rules in priority order: vendor_match > keyword_match > description_match.
 * Returns the matched category ID or null.
 */
export async function autoCategorize(
  vendorName: string,
  description?: string | null,
  category?: string | null
): Promise<string | null> {
  const rules = await prisma.categorizationRule.findMany({
    orderBy: { priority: "desc" },
    include: { category: true },
  });

  for (const rule of rules) {
    let matched = false;

    switch (rule.type) {
      case "vendor_match":
        matched = vendorName.toLowerCase() === rule.pattern.toLowerCase();
        break;
      case "keyword_match":
        try {
          const regex = new RegExp(rule.pattern, "i");
          matched =
            regex.test(vendorName) ||
            (description ? regex.test(description) : false) ||
            (category ? regex.test(category) : false);
        } catch {
          matched = false;
        }
        break;
      case "description_match":
        try {
          const regex = new RegExp(rule.pattern, "i");
          matched = description ? regex.test(description) : false;
        } catch {
          matched = false;
        }
        break;
      case "category_match":
        // Match against the raw category string from source CSV
        matched = category
          ? category.toLowerCase() === rule.pattern.toLowerCase()
          : false;
        break;
    }

    if (matched) {
      // Increment hit count
      await prisma.categorizationRule.update({
        where: { id: rule.id },
        data: { hitCount: { increment: 1 } },
      });
      return rule.categoryId;
    }
  }

  return null;
}

/**
 * Learn from a manual categorization: create an auto_learned rule
 * for the vendor so future expenses from the same vendor are auto-categorized.
 */
export async function learnFromCategorization(
  vendorName: string,
  categoryId: string
) {
  // Check if a vendor_match rule already exists for this vendor
  const existing = await prisma.categorizationRule.findFirst({
    where: {
      type: "vendor_match",
      pattern: vendorName,
    },
  });

  if (existing) {
    // Update the existing rule to point to the new category
    await prisma.categorizationRule.update({
      where: { id: existing.id },
      data: { categoryId, createdFrom: "auto_learned" },
    });
  } else {
    // Create a new auto-learned rule
    await prisma.categorizationRule.create({
      data: {
        type: "vendor_match",
        pattern: vendorName,
        categoryId,
        priority: 10,
        createdFrom: "auto_learned",
      },
    });
  }
}

/**
 * Run auto-categorization on all uncategorized expenses.
 * First tries rule-based matching, then falls back to raw category string matching.
 * Returns the number of expenses categorized.
 */
export async function runAutoCategorization(): Promise<number> {
  const uncategorized = await prisma.expense.findMany({
    where: { expenseCategoryId: null },
    include: { vendor: true },
  });

  let categorized = 0;

  for (const expense of uncategorized) {
    // Try rule-based categorization first
    let categoryId = await autoCategorize(
      expense.vendor?.name || "",
      expense.notes,
      expense.category
    );

    // If no rule matched, try matching by raw category string
    if (!categoryId && expense.category) {
      categoryId = await matchByRawCategory(expense.category);
    }

    if (categoryId) {
      await prisma.expense.update({
        where: { id: expense.id },
        data: { expenseCategoryId: categoryId },
      });
      categorized++;
    }
  }

  return categorized;
}

/**
 * Match a raw category string (from CSV) to an ExpenseCategory.
 * Uses the CATEGORY_MAP to find the best match.
 */
async function matchByRawCategory(
  rawCategory: string
): Promise<string | null> {
  const normalized = rawCategory.toLowerCase().trim();

  // Find which ExpenseCategory this raw category maps to
  for (const [expenseCatName, rawCats] of Object.entries(CATEGORY_MAP)) {
    if (rawCats.some((rc) => rc.toLowerCase() === normalized)) {
      const cat = await prisma.expenseCategory.findFirst({
        where: { name: expenseCatName },
      });
      if (cat) return cat.id;
    }
  }

  return null;
}

/**
 * Ensure all default categories exist and create category_match rules
 * so expenses are automatically linked based on their raw CSV category string.
 * Returns the list of categories.
 */
export async function ensureCategoriesAndRules() {
  const defaults = getDefaultCategories();

  for (const cat of defaults) {
    // Upsert category
    let existing = await prisma.expenseCategory.findFirst({
      where: { name: cat.name },
    });

    if (!existing) {
      existing = await prisma.expenseCategory.create({
        data: {
          name: cat.name,
          color: cat.color,
          icon: cat.icon,
        },
      });
    }

    // Create category_match rules for each mapped raw category
    if (cat.rawCategories) {
      for (const rawCat of cat.rawCategories) {
        const ruleExists = await prisma.categorizationRule.findFirst({
          where: {
            type: "category_match",
            pattern: rawCat,
            categoryId: existing.id,
          },
        });

        if (!ruleExists) {
          await prisma.categorizationRule.create({
            data: {
              type: "category_match",
              pattern: rawCat,
              categoryId: existing.id,
              priority: 5,
              createdFrom: "auto_learned",
            },
          });
        }
      }
    }
  }
}

/**
 * Map from ExpenseCategory names to raw CSV category strings.
 * Used for auto-linking expenses based on their source data category.
 */
const CATEGORY_MAP: Record<string, string[]> = {
  "Groceries & Ingredients": ["Groceries", "Food & Drink"],
  Shopping: ["Shopping"],
  "Rent & Utilities": ["Rent", "Bills & Utilities"],
  "Marketing & Advertising": ["Ads"],
  "Payroll & Salary": ["Salary"],
  Insurance: ["Insurance"],
  "Software & Tech": ["Software & Tech"],
  "Permits & Licenses": ["Permits"],
  "Auto & Transport": ["Auto & Transport"],
  "Construction & Maintenance": ["Construction", "Home & Garden"],
  Security: ["Security"],
  Taxes: ["Taxes"],
  "Dining & Drinks": ["Dining & Drinks"],
  "Fees & Charges": ["Fees"],
  Other: [],
};

/**
 * Get default expense categories to seed.
 * These are tailored to match the actual categories from Rocket Money CSV data.
 */
export function getDefaultCategories() {
  return [
    {
      name: "Groceries & Ingredients",
      color: "#ef4444",
      icon: "food",
      rawCategories: ["Groceries", "Food & Drink"],
    },
    {
      name: "Shopping",
      color: "#f59e0b",
      icon: "shopping",
      rawCategories: ["Shopping"],
    },
    {
      name: "Rent & Utilities",
      color: "#3b82f6",
      icon: "building",
      rawCategories: ["Rent", "Bills & Utilities"],
    },
    {
      name: "Marketing & Advertising",
      color: "#8b5cf6",
      icon: "megaphone",
      rawCategories: ["Ads"],
    },
    {
      name: "Payroll & Salary",
      color: "#10b981",
      icon: "people",
      rawCategories: ["Salary"],
    },
    {
      name: "Insurance",
      color: "#6366f1",
      icon: "shield",
      rawCategories: ["Insurance"],
    },
    {
      name: "Software & Tech",
      color: "#ec4899",
      icon: "computer",
      rawCategories: ["Software & Tech"],
    },
    {
      name: "Permits & Licenses",
      color: "#14b8a6",
      icon: "briefcase",
      rawCategories: ["Permits"],
    },
    {
      name: "Auto & Transport",
      color: "#f97316",
      icon: "truck",
      rawCategories: ["Auto & Transport"],
    },
    {
      name: "Construction & Maintenance",
      color: "#84cc16",
      icon: "tools",
      rawCategories: ["Construction", "Home & Garden"],
    },
    {
      name: "Security",
      color: "#06b6d4",
      icon: "lock",
      rawCategories: ["Security"],
    },
    {
      name: "Taxes",
      color: "#dc2626",
      icon: "receipt",
      rawCategories: ["Taxes"],
    },
    {
      name: "Dining & Drinks",
      color: "#a78bfa",
      icon: "dining",
      rawCategories: ["Dining & Drinks"],
    },
    {
      name: "Fees & Charges",
      color: "#9ca3af",
      icon: "receipt",
      rawCategories: ["Fees"],
    },
    {
      name: "Other",
      color: "#6b7280",
      icon: "misc",
      rawCategories: [],
    },
  ];
}
