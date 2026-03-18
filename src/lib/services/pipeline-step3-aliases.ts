/**
 * Pipeline Step 3: Apply Aliases
 * ===============================
 *
 * Reads alias rules from categories.db and applies them to order_items
 * in sales.db, populating display_name and display_category columns.
 *
 * This step is idempotent — re-running it will re-apply all aliases
 * from scratch, so it's safe to call after changing alias rules.
 *
 * Pipeline:
 *   Step 1: Source → Vendor DB (raw + cleanup)
 *   Step 2: Vendor DB → Unified DB (normalize)
 *   Step 3: Apply aliases (categories.db → sales.db order_items) ← THIS
 *
 * @see PIPELINE.md — Full documentation
 */

import Database from "better-sqlite3";
import path from "path";

const DB_DIR = path.join(process.cwd(), "databases");

export interface AliasResult {
  itemAliasesApplied: number;
  categoryAliasesApplied: number;
  totalItems: number;
}

/**
 * Apply all menu item and category aliases to order_items in sales.db.
 *
 * 1. Reset all display_name/display_category to raw values
 * 2. Apply menu_item_aliases (exact match on item_name → display_name)
 * 3. Apply menu_category_aliases (exact match on category → display_category)
 */
export function step3ApplyAliases(): AliasResult {
  const salesDb = new Database(path.join(DB_DIR, "sales.db"));
  const catDb = new Database(path.join(DB_DIR, "categories.db"), { readonly: true });

  try {
    // 1. Reset display columns to raw values
    salesDb.prepare(`
      UPDATE order_items SET
        display_name = TRIM(item_name),
        display_category = TRIM(category)
    `).run();

    const totalItems = (salesDb.prepare("SELECT COUNT(*) as cnt FROM order_items").get() as { cnt: number }).cnt;

    // 2. Apply menu item aliases
    const itemAliases = catDb.prepare(
      "SELECT pattern, match_type, display_name FROM menu_item_aliases"
    ).all() as { pattern: string; match_type: string; display_name: string }[];

    let itemAliasesApplied = 0;
    for (const alias of itemAliases) {
      const pattern = alias.pattern.trim();
      const displayName = alias.display_name.trim();

      let result;
      if (alias.match_type === "exact") {
        result = salesDb.prepare(
          "UPDATE order_items SET display_name = ? WHERE TRIM(item_name) = ? AND display_name != ?"
        ).run(displayName, pattern, displayName);
      } else if (alias.match_type === "starts_with") {
        result = salesDb.prepare(
          "UPDATE order_items SET display_name = ? WHERE TRIM(item_name) LIKE ? AND display_name != ?"
        ).run(displayName, `${pattern}%`, displayName);
      } else if (alias.match_type === "contains") {
        result = salesDb.prepare(
          "UPDATE order_items SET display_name = ? WHERE TRIM(item_name) LIKE ? AND display_name != ?"
        ).run(displayName, `%${pattern}%`, displayName);
      }

      if (result && result.changes > 0) {
        itemAliasesApplied += result.changes;
      }
    }

    // 3. Apply menu category aliases
    const catAliases = catDb.prepare(
      "SELECT pattern, match_type, display_name FROM menu_category_aliases"
    ).all() as { pattern: string; match_type: string; display_name: string }[];

    let categoryAliasesApplied = 0;
    for (const alias of catAliases) {
      const pattern = alias.pattern.trim();
      const displayName = alias.display_name.trim();

      let result;
      if (alias.match_type === "exact") {
        result = salesDb.prepare(
          "UPDATE order_items SET display_category = ? WHERE TRIM(category) = ? AND display_category != ?"
        ).run(displayName, pattern, displayName);
      } else if (alias.match_type === "starts_with") {
        result = salesDb.prepare(
          "UPDATE order_items SET display_category = ? WHERE TRIM(category) LIKE ? AND display_category != ?"
        ).run(displayName, `${pattern}%`, displayName);
      } else if (alias.match_type === "contains") {
        result = salesDb.prepare(
          "UPDATE order_items SET display_category = ? WHERE TRIM(category) LIKE ? AND display_category != ?"
        ).run(displayName, `%${pattern}%`, displayName);
      }

      if (result && result.changes > 0) {
        categoryAliasesApplied += result.changes;
      }
    }

    // 4. Update denormalized display_categories on orders table (for fast filtering)
    salesDb.prepare(`
      UPDATE orders SET display_categories = (
        SELECT GROUP_CONCAT(DISTINCT oi.display_category)
        FROM order_items oi
        WHERE oi.order_id = orders.order_id AND oi.platform = orders.platform
        AND oi.display_category IS NOT NULL AND oi.display_category != ''
      )
    `).run();

    return { itemAliasesApplied, categoryAliasesApplied, totalItems };
  } finally {
    salesDb.close();
    catDb.close();
  }
}
