/**
 * Transactions API — Primary data source for the Sales page.
 *
 * Reads from sales.db unified `orders` table.
 */
import { NextRequest, NextResponse } from "next/server";
import { querySales, queryPlatformBreakdown } from "@/lib/db/sales-db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const platforms = searchParams.getAll("platforms");
  const platform = searchParams.get("platform");
  const types = searchParams.getAll("types");
  const statuses = searchParams.getAll("statuses");
  const categories = searchParams.getAll("categories");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const search = searchParams.get("search");
  const sortBy = searchParams.get("sortBy");
  const sortDir = (searchParams.get("sortDir") || "desc") as "asc" | "desc";
  const limit = parseInt(searchParams.get("limit") || "100");
  const offset = parseInt(searchParams.get("offset") || "0");

  const allPlatforms = platforms.length > 0 ? platforms : platform ? [platform] : [];

  try {
    const { records, total, summary } = querySales({
      platforms: allPlatforms,
      types: types.length > 0 ? types : undefined,
      statuses: statuses.length > 0 ? statuses : undefined,
      categories: categories.length > 0 ? categories : undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      search: search || undefined,
      sortBy: sortBy || undefined,
      sortDir,
      limit,
      offset,
    });

    // Transform records to match the frontend shape
    const transactions = records.map((r) => ({
      id: `${r.platform}-${r.order_id || r.id}`,
      date: r.date,
      time: r.time,
      platform: r.platform,
      order_id: r.order_id,
      order_status: r.order_status,
      gross_sales: r.gross_sales,
      tax: r.tax,
      tip: r.tip,
      net_sales: r.net_sales,
      // Items & detail
      items: r.items,
      item_count: r.item_count,
      modifiers: r.modifiers,
      discounts: r.discounts,
      dining_option: r.dining_option,
      customer_name: r.customer_name,
      payment_method: r.payment_method,
      // Raw fee breakdown
      commission_fee: r.commission_fee,
      processing_fee: r.processing_fee,
      delivery_fee: r.delivery_fee,
      marketing_fee: r.marketing_fee,
      // Summary rollups
      fees_total: r.fees_total,
      marketing_total: r.marketing_total,
      refunds_total: r.refunds_total,
      adjustments_total: r.adjustments_total,
      other_total: r.other_total,
    }));

    // Platform summary
    const platformSummary = {
      orderCount: summary.order_count,
      grossSales: summary.gross_sales,
      tax: summary.tax,
      tip: summary.tip,
      netSales: summary.net_sales,
      // Raw fee breakdown
      commissionFee: summary.commission_fee,
      processingFee: summary.processing_fee,
      deliveryFee: summary.delivery_fee,
      marketingFee: summary.marketing_fee,
      // Summary rollups
      feesTotal: summary.fees_total,
      marketingTotal: summary.marketing_total,
      refundsTotal: summary.refunds_total,
      adjustmentsTotal: summary.adjustments_total,
      otherTotal: summary.other_total,
      discounts: summary.discounts,
    };

    // Platform breakdown
    const breakdown = queryPlatformBreakdown({
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    });

    return NextResponse.json({
      transactions,
      total,
      limit,
      offset,
      platformSummary,
      platformBreakdown: breakdown,
    });
  } catch (error) {
    console.error("Sales query error:", error);
    return NextResponse.json(
      { error: "Failed to query sales data", detail: String(error) },
      { status: 500 },
    );
  }
}
