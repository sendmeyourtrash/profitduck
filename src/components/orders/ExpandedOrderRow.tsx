/**
 * Expandable order detail row — shared between Sales page and Platform detail page.
 * Shows items, modifiers, customer name, fee breakdown receipt, and order metadata.
 */
import { Fragment } from "react";
import { formatCurrency } from "@/lib/utils/format";

// ── Types ──

export interface OrderItem {
  item_name: string;
  qty: number;
  unit_price: number;
  gross_sales: number;
  modifiers: string;
  display_name: string;
}

export interface ExpandableOrder {
  id: string;
  platform: string;
  order_id: string;
  order_status: string;
  time?: string | null;
  gross_sales: number;
  tax: number;
  tip: number;
  net_sales: number;
  items?: string | null;
  discounts: number;
  dining_option?: string | null;
  customer_name?: string | null;
  payment_method?: string | null;
  commission_fee: number;
  processing_fee: number;
  delivery_fee: number;
  marketing_fee: number;
  fees_total: number;
  marketing_total: number;
  refunds_total: number;
  adjustments_total: number;
  other_total: number;
  order_items?: OrderItem[];
}

// ── Constants ──

const PLATFORM_LABELS: Record<string, string> = {
  square: "Square",
  doordash: "DoorDash",
  ubereats: "Uber Eats",
  grubhub: "Grubhub",
};

const PLATFORM_COLORS: Record<string, string> = {
  square: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  doordash: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  ubereats: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  grubhub: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  refund: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  unfulfilled: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400",
  other: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400",
  adjustment: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  credit: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  error_charge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

// ── Helpers ──

function FeeRow({ label, value }: { label: string; value: number }) {
  if (!value || Math.abs(value) < 0.01) return null;
  return (
    <div className="flex justify-between">
      <span className="text-gray-400 dark:text-gray-500">{label}</span>
      <span className={value < 0 ? "text-red-500" : "text-gray-600 dark:text-gray-400"}>
        {formatCurrency(value)}
      </span>
    </div>
  );
}

export function parseModifiersJson(modifiers: string): { group: string; name: string; price: number }[] {
  if (!modifiers) return [];
  try {
    const parsed = JSON.parse(modifiers);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* not JSON */ }
  if (modifiers.includes(";")) {
    return modifiers.split(";").flatMap(group => {
      const trimmed = group.trim();
      if (!trimmed) return [];
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx === -1) return [{ group: "", name: trimmed, price: 0 }];
      const groupName = trimmed.slice(0, colonIdx).trim();
      const optionsStr = trimmed.slice(colonIdx + 1).trim();
      return optionsStr.split(/,\s*/).map(opt => {
        const priceMatch = opt.match(/\(\$([\d.]+)\)/);
        const name = opt.replace(/\s*\(\$[\d.]+\)/, "").trim();
        return { group: groupName, name, price: priceMatch ? parseFloat(priceMatch[1]) : 0 };
      }).filter(m => m.name);
    });
  }
  return modifiers.split(",").map(m => m.trim()).filter(Boolean).map(name => ({
    group: "", name, price: 0,
  }));
}

// ── Main Component ──

export default function ExpandedOrderRow({ order, colSpan = 8 }: { order: ExpandableOrder; colSpan?: number }) {
  const hasOrderItems = Array.isArray(order.order_items) && order.order_items.length > 0;

  const itemList = hasOrderItems
    ? order.order_items!.map((oi) => ({
        name: oi.display_name || oi.item_name,
        qty: oi.qty,
        price: oi.unit_price,
        total: oi.gross_sales,
        modifiers: parseModifiersJson(oi.modifiers),
      }))
    : order.items
      ? order.items.split(" | ").map((s) => {
          const match = s.trim().match(/^(.+)\s+x(\d+)$/);
          return match
            ? { name: match[1].trim(), qty: parseInt(match[2]), price: 0, total: 0, modifiers: [] as { group: string; name: string; price: number }[] }
            : { name: s.trim(), qty: 1, price: 0, total: 0, modifiers: [] };
        }).filter(i => i.name)
      : null;

  return (
    <td colSpan={colSpan} className="px-0 py-0">
      <div className="bg-gray-50/80 dark:bg-gray-800/80 border-t border-gray-100 dark:border-gray-700/50">
        <div className="px-5 py-3 space-y-3">

          {/* Overview metadata — compact inline chips */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-400">Platform</span>
              <span className={`px-2 py-0.5 rounded-full text-xs ${PLATFORM_COLORS[order.platform] || "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"}`}>
                {PLATFORM_LABELS[order.platform] || order.platform}
              </span>
            </div>
            {order.time && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-gray-400">Time</span>
                <span className="text-xs text-gray-800 dark:text-gray-200">{order.time}</span>
              </div>
            )}
            {order.dining_option && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-gray-400">Type</span>
                <span className="px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">{order.dining_option}</span>
              </div>
            )}
            {order.payment_method && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-gray-400">Payment</span>
                <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">{order.payment_method}</span>
              </div>
            )}
            {order.customer_name && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-gray-400">Customer</span>
                <span className="text-xs font-medium text-gray-800 dark:text-gray-200">{order.customer_name}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-400">Status</span>
              <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[order.order_status] || "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"}`}>
                {order.order_status}
              </span>
            </div>
          </div>

          {/* Items (left) + Receipt (right) — side by side on lg */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-3">

            {/* Items table */}
            {itemList && itemList.length > 0 ? (
              <div>
                <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Items Ordered</h4>
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700/50 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                        <th className="px-3 py-1.5 font-medium">Item</th>
                        <th className="px-3 py-1.5 font-medium text-right">Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itemList.map((item, i) => (
                        <Fragment key={i}>
                          <tr className="border-t border-gray-50 dark:border-gray-700/50">
                            <td className="px-3 py-1">
                              <span className="text-gray-800 dark:text-gray-200 font-medium">{item.name}</span>
                              <span className="text-gray-400 dark:text-gray-500 ml-1 text-[10px]">x{item.qty}</span>
                            </td>
                            <td className="px-3 py-1 text-right text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">
                              {item.total > 0 && formatCurrency(item.total)}
                            </td>
                          </tr>
                          {item.modifiers.map((mod, j) => (
                            <tr key={`${i}-mod-${j}`}>
                              <td className="px-3 py-0 pl-6">
                                <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                  {mod.group ? `${mod.group}: ${mod.name}` : mod.name}
                                </span>
                              </td>
                              <td className="px-3 py-0 text-right text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
                                {mod.price > 0 ? `+$${mod.price.toFixed(2)}` : "$0.00"}
                              </td>
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                    </tbody>
                    {(() => {
                      const itemsTotal = itemList.reduce((sum, i) => sum + (i.total || 0), 0);
                      const modsTotal = itemList.reduce((sum, i) => sum + i.modifiers.reduce((ms, m) => ms + (m.price || 0), 0), 0);
                      const grandTotal = Math.round((itemsTotal + modsTotal) * 100) / 100;
                      return (
                        <tfoot className="border-t border-gray-200 dark:border-gray-600">
                          <tr>
                            <td className="px-3 py-0.5 text-[11px] text-gray-500 dark:text-gray-400">Items</td>
                            <td className="px-3 py-0.5 text-right text-[11px] font-medium text-gray-600 dark:text-gray-400">{formatCurrency(itemsTotal)}</td>
                          </tr>
                          {modsTotal > 0 && (
                            <tr>
                              <td className="px-3 py-0.5 text-[11px] text-gray-500 dark:text-gray-400">Modifiers</td>
                              <td className="px-3 py-0.5 text-right text-[11px] font-medium text-gray-600 dark:text-gray-400">+{formatCurrency(modsTotal)}</td>
                            </tr>
                          )}
                          <tr className="border-t border-gray-200 dark:border-gray-600">
                            <td className="px-3 py-1 text-xs font-semibold text-gray-800 dark:text-gray-200">Total</td>
                            <td className="px-3 py-1 text-right text-xs font-semibold text-gray-800 dark:text-gray-200">{formatCurrency(grandTotal)}</td>
                          </tr>
                        </tfoot>
                      );
                    })()}
                  </table>
                </div>
              </div>
            ) : (
              <div />
            )}

            {/* Financial receipt card */}
            <div className="md:order-last order-first">
              <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 md:sr-only">Financial Summary</h4>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700/50 rounded-lg px-4 py-3">
                <div className="text-xs space-y-0">
                  <p className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Sale</p>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Subtotal</span>
                    <span className="text-gray-800 dark:text-gray-200">{formatCurrency(order.gross_sales)}</span>
                  </div>
                  {order.tax > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Tax</span>
                      <span className="text-gray-600 dark:text-gray-400">{formatCurrency(order.tax)}</span>
                    </div>
                  )}
                  {order.tip > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Tip</span>
                      <span className="text-emerald-600">{formatCurrency(order.tip)}</span>
                    </div>
                  )}
                  {order.discounts < 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Discounts</span>
                      <span className="text-amber-600">{formatCurrency(order.discounts)}</span>
                    </div>
                  )}
                  <div className="border-t border-gray-100 dark:border-gray-700/50 mt-1 pt-1 flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400 font-medium">Total</span>
                    <span className="text-gray-800 dark:text-gray-200 font-medium">{formatCurrency(order.gross_sales + order.tax + (order.tip || 0) + (order.discounts || 0))}</span>
                  </div>

                  {(order.fees_total !== 0 || order.marketing_total !== 0) && (
                    <>
                      <div className="mt-2" />
                      <p className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Platform Costs</p>
                      <FeeRow label="Commission" value={order.commission_fee} />
                      <FeeRow label="Processing" value={order.processing_fee} />
                      <FeeRow label="Delivery" value={order.delivery_fee} />
                      <FeeRow label="Marketing" value={order.marketing_fee || order.marketing_total} />
                      <div className="border-t border-gray-100 dark:border-gray-700/50 mt-1 pt-1 flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400 font-medium">Total Costs</span>
                        <span className="text-red-500 font-medium">{formatCurrency((order.fees_total || 0) + (order.marketing_total || 0))}</span>
                      </div>
                    </>
                  )}

                  {(order.refunds_total !== 0 || order.adjustments_total !== 0 || order.other_total !== 0) && (
                    <>
                      <div className="mt-2" />
                      <p className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Adjustments</p>
                      {order.refunds_total !== 0 && (
                        <div className="flex justify-between">
                          <span className="text-gray-600 dark:text-gray-400">Refunds</span>
                          <span className="text-red-500">{formatCurrency(order.refunds_total)}</span>
                        </div>
                      )}
                      {order.adjustments_total !== 0 && (
                        <div className="flex justify-between">
                          <span className="text-gray-600 dark:text-gray-400">Adjustments</span>
                          <span className={order.adjustments_total < 0 ? "text-red-500" : "text-gray-600 dark:text-gray-400"}>{formatCurrency(order.adjustments_total)}</span>
                        </div>
                      )}
                      {order.other_total !== 0 && (
                        <div className="flex justify-between">
                          <span className="text-gray-600 dark:text-gray-400">Other</span>
                          <span className={order.other_total < 0 ? "text-red-500" : "text-gray-600 dark:text-gray-400"}>{formatCurrency(order.other_total)}</span>
                        </div>
                      )}
                    </>
                  )}

                  <div className="border-t-2 border-gray-200 dark:border-gray-600 mt-2 pt-1.5 flex justify-between">
                    <span className="text-gray-800 dark:text-gray-200 font-semibold">Net Revenue</span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-bold text-sm">{formatCurrency(order.net_sales)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Order ID footer */}
          <div className="flex items-center gap-3 pt-1 border-t border-gray-100 dark:border-gray-700/50 text-[10px] text-gray-400">
            {order.order_id && (
              <span className="font-mono" title={order.order_id}>
                ID: {order.order_id.length > 30 ? order.order_id.slice(0, 30) + "..." : order.order_id}
              </span>
            )}
          </div>
        </div>
      </div>
    </td>
  );
}
