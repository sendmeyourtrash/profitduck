/**
 * In-memory deduplication for intercepted orders.
 *
 * Prevents re-sending the same orders when the user scrolls back
 * and forth on the portal. This is a performance optimization —
 * the server-side pipeline has its own dedup as the authoritative gate.
 */

/** @type {Set<string>} */
const seen = new Set();

/**
 * Filter out orders that have already been seen this session.
 *
 * @param {Array<Record<string, string>>} orders
 * @returns {Array<Record<string, string>>} Only new orders
 */
export function dedup(orders) {
  const newOrders = [];

  for (const order of orders) {
    const id = order["Order ID"];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    newOrders.push(order);
  }

  return newOrders;
}

/**
 * Get count of unique orders seen this session.
 * @returns {number}
 */
export function getSeenCount() {
  return seen.size;
}

/**
 * Clear the dedup set (e.g., on service worker restart).
 */
export function clearSeen() {
  seen.clear();
}
