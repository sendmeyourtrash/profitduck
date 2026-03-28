/**
 * Recursive JSON normalizer — searches API response trees for order-like
 * objects and extracts them into the standard CSV-row format that Profit
 * Duck's pipeline expects.
 *
 * Ported from: src/lib/services/ubereats-scraper.ts extractOrdersFromApiResponse
 */

/**
 * Recursively search a JSON response for order-like objects.
 * Returns an array of normalized order records in CSV-row format.
 *
 * @param {unknown} data - Raw API response JSON
 * @param {string} platform - Platform identifier (e.g., "ubereats")
 * @returns {Array<Record<string, string>>} Normalized order rows
 */
export function extractOrders(data, platform) {
  if (platform === "ubereats") return extractUberEatsOrders(data);
  return [];
}

/**
 * Extract Uber Eats orders from API response JSON.
 * Searches recursively up to 5 levels deep for objects with
 * order-like field patterns (orderId + subtotal/payout).
 */
function extractUberEatsOrders(data) {
  const orders = [];
  const seenIds = new Set();

  if (!data || typeof data !== "object") return orders;

  function search(obj, depth) {
    if (depth > 5 || !obj || typeof obj !== "object") return;

    if (Array.isArray(obj)) {
      for (const item of obj) search(item, depth + 1);
      return;
    }

    // Look for order-like objects: must have an ID field + a money field
    const hasId = "orderId" in obj || "order_id" in obj || "orderUUID" in obj || "uuid" in obj;
    const hasMoney = "total" in obj || "subtotal" in obj || "payout" in obj || "amount" in obj;

    if (hasId && hasMoney) {
      const orderId = String(
        obj.orderId || obj.order_id || obj.orderUUID || obj.uuid || ""
      );

      // Skip duplicates within this response
      if (!orderId || seenIds.has(orderId)) {
        // Still recurse — might have nested orders
      } else {
        seenIds.add(orderId);

        const dateVal =
          obj.date ||
          obj.createdAt ||
          obj.created_at ||
          obj.orderDate ||
          obj.placedAt ||
          obj.placed_at ||
          "";
        const date = dateVal ? new Date(String(dateVal)) : new Date();
        const dateStr = `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;

        const subtotal = toNum(obj.subtotal || obj.sales || obj.itemsTotal || obj.foodSales || 0);
        const tax = toNum(obj.tax || obj.salesTax || 0);
        const fee = Math.abs(toNum(obj.marketplaceFee || obj.commission || obj.fee || obj.serviceFee || 0));
        const refunds = Math.abs(toNum(obj.refunds || obj.customerRefunds || obj.adjustments || 0));
        const charges = Math.abs(toNum(obj.orderCharges || obj.additionalCharges || obj.otherCharges || 0));
        const payout = toNum(obj.payout || obj.estimatedPayout || obj.netPayout || obj.restaurantPayout || 0);
        const status = String(obj.status || obj.orderStatus || obj.order_status || "Completed");
        const customer = String(obj.customer || obj.customerName || obj.customer_name || obj.eaterName || "");

        // Only include if there's meaningful financial data
        if (subtotal > 0 || payout > 0) {
          orders.push({
            "Order ID": orderId,
            "Date": dateStr,
            "Customer": customer,
            "Order status": status,
            "Sales (excl. tax)": subtotal.toFixed(2),
            "Tax": tax.toFixed(2),
            "Marketplace fee": (-fee).toFixed(2),
            "Customer refunds": refunds.toFixed(2),
            "Order charges": (-charges).toFixed(2),
            "Estimated payout": payout.toFixed(2),
          });
        }
      }
    }

    // Recurse into all nested objects/arrays
    for (const val of Object.values(obj)) {
      search(val, depth + 1);
    }
  }

  search(data, 0);
  return orders;
}

/**
 * Safely convert a value to a number.
 * Handles strings with currency symbols, commas, etc.
 */
function toNum(val) {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const cleaned = val.replace(/[$,\s]/g, "");
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}
