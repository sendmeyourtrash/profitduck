const Database = require('better-sqlite3');
const db = new Database('databases/ubereats.db');

const orders = db.prepare("SELECT order_id, raw_json FROM orders WHERE raw_json IS NOT NULL AND raw_json != ''").all();
let updated = 0;
const update = db.prepare("UPDATE items SET modifiers_json = ? WHERE order_id = ? AND item_name = ?");

const tx = db.transaction(() => {
  for (const order of orders) {
    try {
      const raw = JSON.parse(order.raw_json);
      const od = raw.data && raw.data.orderDetails;
      if (!od || !od.items) continue;
      for (const item of od.items) {
        if (!item.customizations || item.customizations.length === 0) continue;
        const mods = [];
        for (const c of item.customizations) {
          for (const o of (c.options || [])) {
            const priceStr = o.price || "";
            const price = priceStr ? parseFloat(priceStr.replace(/[^0-9.-]/g, "")) || 0 : 0;
            mods.push({ group: c.name, name: o.name, price: price });
          }
        }
        if (mods.length > 0) {
          update.run(JSON.stringify(mods), order.order_id, item.name);
          updated++;
        }
      }
    } catch (e) { console.error("Error on", order.order_id, e.message); }
  }
});
tx();
console.log("Updated " + updated + " items with modifiers_json");
db.close();
