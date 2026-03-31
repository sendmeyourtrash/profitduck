/**
 * POST /api/ingest/extension — Receive order data from Chrome extension
 * GET  /api/ingest/extension — Health check for extension popup
 *
 * The extension intercepts API responses from delivery platform merchant
 * portals and forwards normalized order data here. This route feeds it
 * through the same 3-step pipeline as CSV uploads.
 *
 * Body: {
 *   platform: "ubereats" | "doordash" | "grubhub",
 *   orders: Record<string, string>[],
 *   source: "extension",
 *   extensionVersion?: string
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { ingestUberEatsOrders, ingestDoordashOrders } from "@/lib/services/pipeline-step1-ingest";
import { unifyUberEats, unifyDoordash } from "@/lib/services/pipeline-step2-unify";
import { step3ApplyAliases } from "@/lib/services/pipeline-step3-aliases";
import { createImport } from "@/lib/db/config-db";

// CORS headers for chrome-extension:// origin
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action");
  const platform = request.nextUrl.searchParams.get("platform");

  // Return known order IDs for smart-sync dedup
  if (action === "known_ids" && platform) {
    try {
      const Database = (await import("better-sqlite3")).default;
      const path = await import("path");

      const platformConfig: Record<string, { db: string; column: string; table: string }> = {
        ubereats: { db: "ubereats.db", column: "order_id", table: "orders" },
        doordash: { db: "doordash.db", column: "doordash_order_id", table: "detailed_transactions" },
      };

      const config = platformConfig[platform];
      if (!config) {
        return NextResponse.json(
          { orderIds: [], count: 0, error: `Unknown platform: ${platform}` },
          { headers: corsHeaders }
        );
      }

      const dbPath = path.join(process.cwd(), "databases", config.db);
      const db = new Database(dbPath, { readonly: true });
      const rows = db.prepare(`SELECT ${config.column} as id FROM ${config.table}`).all() as { id: string }[];
      db.close();
      const orderIds = rows.map(r => r.id).filter(Boolean);
      return NextResponse.json(
        { orderIds, count: orderIds.length },
        { headers: corsHeaders }
      );
    } catch (err) {
      return NextResponse.json(
        { orderIds: [], count: 0, error: err instanceof Error ? err.message : "DB error" },
        { headers: corsHeaders }
      );
    }
  }

  return NextResponse.json(
    { status: "ok", version: "1.0", platforms: ["ubereats", "doordash"] },
    { headers: corsHeaders }
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { platform, orders, source, extensionVersion } = body as {
      platform: string;
      orders: Record<string, string>[];
      source?: string;
      extensionVersion?: string;
    };

    // Validate
    if (!platform) {
      return NextResponse.json(
        { error: "Missing platform" },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!Array.isArray(orders) || orders.length === 0) {
      return NextResponse.json(
        { error: "No orders provided" },
        { status: 400, headers: corsHeaders }
      );
    }

    console.log(
      `[Extension Ingest] Received ${orders.length} ${platform} orders from ${source || "unknown"} v${extensionVersion || "?"}`
    );

    let inserted = 0;
    let skipped = 0;
    const errors: string[] = [];

    switch (platform) {
      case "ubereats": {
        // Step 1: Write to ubereats.db
        const ingestResult = ingestUberEatsOrders(orders);
        inserted = ingestResult.inserted;
        skipped = ingestResult.skipped;
        if (ingestResult.errors.length > 0) {
          errors.push(...ingestResult.errors);
        }

        // Step 2: Unify to sales.db
        unifyUberEats();

        // Step 3: Apply aliases
        step3ApplyAliases();
        break;
      }

      case "doordash": {
        const ddResult = ingestDoordashOrders(orders);
        inserted = ddResult.inserted;
        skipped = ddResult.skipped;
        if (ddResult.errors.length > 0) errors.push(...ddResult.errors);
        unifyDoordash();
        step3ApplyAliases();
        break;
      }

      default:
        return NextResponse.json(
          { error: `Unsupported platform: ${platform}` },
          { status: 400, headers: corsHeaders }
        );
    }

    console.log(
      `[Extension Ingest] ${platform}: ${inserted} inserted, ${skipped} skipped`
    );

    // Record in import history
    if (inserted > 0) {
      createImport(
        `${platform} extension sync (${orders.length} orders)`,
        `${platform}-extension`,
        inserted
      );
    }

    return NextResponse.json(
      {
        success: true,
        platform,
        inserted,
        skipped,
        errors: errors.length > 0 ? errors : undefined,
      },
      { headers: corsHeaders }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[Extension Ingest] Error: ${message}`);
    return NextResponse.json(
      { error: message },
      { status: 500, headers: corsHeaders }
    );
  }
}
