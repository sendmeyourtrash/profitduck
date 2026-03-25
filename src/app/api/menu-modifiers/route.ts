/**
 * Menu Modifiers API — reads modifier data from sales.db order_items.
 * Splits comma-separated modifier strings and aggregates usage stats.
 */
import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";

const DB_DIR = path.join(process.cwd(), "databases");

function openDb(name: string) {
  return new Database(path.join(DB_DIR, name), { readonly: true });
}

export async function GET() {
  const salesDb = openDb("sales.db");

  try {
    // Get all modifier strings with their item context
    const rows = salesDb.prepare(
      `SELECT item_name, display_name, modifiers, COUNT(*) as cnt,
              ROUND(SUM(gross_sales), 2) as revenue
       FROM order_items
       WHERE length(modifiers) > 0 AND event_type = 'Payment'
       GROUP BY item_name, modifiers
       ORDER BY cnt DESC`
    ).all() as {
      item_name: string; display_name: string; modifiers: string;
      cnt: number; revenue: number;
    }[];

    // Split and aggregate individual modifiers
    const modifierMap = new Map<string, {
      count: number;
      revenue: number;
      items: Map<string, number>;
    }>();

    for (const row of rows) {
      const mods = row.modifiers.split(",").map((m: string) => m.trim()).filter(Boolean);
      for (const mod of mods) {
        const existing = modifierMap.get(mod);
        const itemName = row.display_name || row.item_name;
        if (existing) {
          existing.count += row.cnt;
          existing.revenue += row.revenue;
          existing.items.set(itemName, (existing.items.get(itemName) || 0) + row.cnt);
        } else {
          const items = new Map<string, number>();
          items.set(itemName, row.cnt);
          modifierMap.set(mod, { count: row.cnt, revenue: row.revenue, items });
        }
      }
    }

    // Build response
    const modifiers = [...modifierMap.entries()]
      .map(([name, data]) => ({
        name,
        count: data.count,
        revenue: Math.round(data.revenue * 100) / 100,
        itemCount: data.items.size,
        topItems: [...data.items.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([item, count]) => ({ item, count })),
      }))
      .sort((a, b) => b.count - a.count);

    // Summary stats
    const totalWithMods = salesDb.prepare(
      `SELECT COUNT(*) as cnt FROM order_items WHERE length(modifiers) > 0 AND event_type = 'Payment'`
    ).get() as { cnt: number };
    const totalItems = salesDb.prepare(
      `SELECT COUNT(*) as cnt FROM order_items WHERE event_type = 'Payment'`
    ).get() as { cnt: number };

    // Top modifier combos (full strings, not split)
    const topCombos = salesDb.prepare(
      `SELECT modifiers, COUNT(*) as cnt, display_name as item
       FROM order_items
       WHERE length(modifiers) > 0 AND event_type = 'Payment'
       GROUP BY modifiers, display_name
       ORDER BY cnt DESC
       LIMIT 15`
    ).all() as { modifiers: string; cnt: number; item: string }[];

    return NextResponse.json({
      modifiers,
      totalModifiers: modifiers.length,
      totalItemsWithMods: totalWithMods.cnt,
      totalItems: totalItems.cnt,
      modifierRate: totalItems.cnt > 0
        ? Math.round((totalWithMods.cnt / totalItems.cnt) * 1000) / 10
        : 0,
      topCombos: topCombos.map((c) => ({
        combo: c.modifiers,
        item: c.item,
        count: c.cnt,
      })),
    });
  } finally {
    salesDb.close();
  }
}
