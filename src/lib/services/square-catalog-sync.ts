/**
 * Square Catalog Sync Service
 * ===========================
 *
 * Pulls the Square Catalog (categories + items) and syncs them into
 * Profit Duck's menu categories system.
 *
 * Square's catalog has:
 *  - CatalogCategory: the real menu groupings defined in Square Dashboard
 *  - CatalogItem: each menu item, linked to one or more categories
 *  - CatalogItemVariation: sizes/options (Regular, Large) — what order
 *    line items actually reference via catalog_object_id
 *
 * This service:
 *  1. Fetches the full catalog from Square
 *  2. Creates/updates menu_categories from catalog categories
 *  3. Maps menu items to categories based on catalog item→category links
 *  4. Uses display_name (after aliases) to connect catalog items to our data
 */

import { randomUUID } from "crypto";
import {
  fetchCatalog,
  SquareCatalogCategory,
  SquareCatalogItem,
} from "./square-api";
import {
  getAllMenuCategories,
  getCategoryBySquareCatalogId,
  createMenuCategoryFromCatalog,
  assignItemToCategoryFromCatalog,
  getItemCategoryMappings,
} from "../db/sales-db";
import { ProgressCallback } from "./progress";

export interface CatalogSyncResult {
  categoriesCreated: number;
  categoriesSkipped: number;
  itemsMapped: number;
  itemsSkipped: number;
  unmappedItems: string[];
}

/**
 * Sync Square catalog categories and item mappings.
 *
 * - Creates menu_categories for each Square catalog category (skips if already exists)
 * - Maps items to categories using catalog data + matching against display_name in order_items
 * - Does NOT overwrite manually assigned categories — only fills in unmapped items
 */
export async function syncSquareCatalog(
  onProgress?: ProgressCallback
): Promise<CatalogSyncResult> {
  console.log("[Catalog Sync] Starting Square catalog sync...");

  // Fetch the full catalog
  onProgress?.({
    phase: "fetching",
    current: 0,
    total: 0,
    message: "Fetching Square catalog...",
  });

  const catalog = await fetchCatalog(onProgress);

  // Filter to top-level or MENU_CATEGORY categories (skip nested size/option categories)
  const realCategories = catalog.categories.filter(
    (c) => c.isTopLevel || c.categoryType === "MENU_CATEGORY"
  );

  console.log(
    `[Catalog Sync] ${realCategories.length} real categories (of ${catalog.categories.length} total)`
  );

  // Step 1: Create menu categories from catalog
  onProgress?.({
    phase: "creating",
    current: 0,
    total: realCategories.length,
    message: "Creating menu categories from catalog...",
  });

  let categoriesCreated = 0;
  let categoriesSkipped = 0;

  // Build a map of square_catalog_id → our menu_category id
  const squareToCategoryId = new Map<string, string>();

  for (const cat of realCategories) {
    const existing = getCategoryBySquareCatalogId(cat.id);
    if (existing) {
      squareToCategoryId.set(cat.id, existing.id);
      categoriesSkipped++;
    } else {
      // Check if a category with the same name exists (user created it manually)
      const allCats = getAllMenuCategories();
      const byName = allCats.find(
        (c) => c.name.toLowerCase() === cat.name.toLowerCase()
      );
      if (byName) {
        // Link existing category to Square catalog ID
        squareToCategoryId.set(cat.id, byName.id);
        categoriesSkipped++;
      } else {
        const id = randomUUID();
        createMenuCategoryFromCatalog(id, cat.name, cat.id, categoriesCreated);
        squareToCategoryId.set(cat.id, id);
        categoriesCreated++;
      }
    }
  }

  console.log(
    `[Catalog Sync] Categories: ${categoriesCreated} created, ${categoriesSkipped} already existed`
  );

  // Step 2: Map items to categories
  onProgress?.({
    phase: "syncing",
    current: 0,
    total: catalog.items.length,
    message: "Mapping items to categories...",
  });

  // Get existing mappings — don't overwrite manual assignments
  const existingMappings = new Set(
    getItemCategoryMappings().map((m) => m.display_name.toLowerCase())
  );

  // Get all unique display_names from order_items to match against
  const Database = (await import("better-sqlite3")).default;
  const path = await import("path");
  const salesDb = new Database(
    path.join(process.cwd(), "databases", "sales.db"),
    { readonly: true }
  );
  const displayNames = salesDb
    .prepare(
      "SELECT DISTINCT COALESCE(display_name, item_name) as name FROM order_items WHERE event_type = 'Payment' AND qty > 0"
    )
    .all() as { name: string }[];
  salesDb.close();

  // Build a lookup: lowercase item name → display_name
  const nameToDisplayName = new Map<string, string>();
  for (const row of displayNames) {
    if (row.name) nameToDisplayName.set(row.name.toLowerCase(), row.name);
  }

  let itemsMapped = 0;
  let itemsSkipped = 0;
  const unmappedItems: string[] = [];

  for (const item of catalog.items) {
    // Find which of our categories this item belongs to
    const categoryId = item.categoryIds
      .map((cid) => squareToCategoryId.get(cid))
      .find((id) => id !== undefined);

    if (!categoryId) {
      unmappedItems.push(item.name);
      continue;
    }

    // Match catalog item name to a display_name in our data
    const displayName = nameToDisplayName.get(item.name.toLowerCase());
    if (!displayName) {
      // Item exists in catalog but not in our sales data — skip
      itemsSkipped++;
      continue;
    }

    // Skip if already manually mapped
    if (existingMappings.has(displayName.toLowerCase())) {
      itemsSkipped++;
      continue;
    }

    assignItemToCategoryFromCatalog(
      randomUUID(),
      displayName,
      categoryId,
      item.id
    );
    itemsMapped++;
  }

  console.log(
    `[Catalog Sync] Items: ${itemsMapped} mapped, ${itemsSkipped} skipped, ${unmappedItems.length} unmapped`
  );

  return {
    categoriesCreated,
    categoriesSkipped,
    itemsMapped,
    itemsSkipped,
    unmappedItems,
  };
}

/**
 * Get a preview of what catalog sync would do without writing anything.
 */
export async function previewCatalogSync(
  onProgress?: ProgressCallback
): Promise<{
  categories: { name: string; exists: boolean; squareId: string }[];
  itemMappings: { itemName: string; categoryName: string; alreadyMapped: boolean }[];
}> {
  const catalog = await fetchCatalog(onProgress);

  const realCategories = catalog.categories.filter(
    (c) => c.isTopLevel || c.categoryType === "MENU_CATEGORY"
  );

  const allCats = getAllMenuCategories();
  const existingNames = new Set(allCats.map((c) => c.name.toLowerCase()));
  const existingSquareIds = new Set(
    allCats.filter((c) => (c as Record<string, unknown>).square_catalog_id).map((c) => (c as Record<string, unknown>).square_catalog_id as string)
  );

  const categories = realCategories.map((cat) => ({
    name: cat.name,
    exists:
      existingNames.has(cat.name.toLowerCase()) ||
      existingSquareIds.has(cat.id),
    squareId: cat.id,
  }));

  // Build category name lookup
  const catNameMap = new Map<string, string>();
  for (const cat of realCategories) {
    catNameMap.set(cat.id, cat.name);
  }

  const existingMappings = new Set(
    getItemCategoryMappings().map((m) => m.display_name.toLowerCase())
  );

  const itemMappings = catalog.items
    .filter((item) => item.categoryIds.length > 0)
    .map((item) => {
      const catName =
        item.categoryIds
          .map((cid) => catNameMap.get(cid))
          .find((n) => n !== undefined) || "Unknown";
      return {
        itemName: item.name,
        categoryName: catName,
        alreadyMapped: existingMappings.has(item.name.toLowerCase()),
      };
    });

  return { categories, itemMappings };
}
