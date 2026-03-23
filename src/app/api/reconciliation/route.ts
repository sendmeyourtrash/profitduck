import { NextResponse } from "next/server";
import {
  getReconMatches,
  getReconAlerts,
  getReconSummary,
} from "@/lib/db/config-db";

export async function GET() {
  const matches = getReconMatches();
  const summary = getReconSummary();
  const alerts = getReconAlerts();

  return NextResponse.json({
    stats: {
      totalPayouts: summary.total,
      reconciledPayouts: summary.matched,
      unreconciledPayouts: summary.unmatched,
      totalBankDeposits: 0,
      reconciledBankDeposits: 0,
      unreconciledBankDeposits: 0,
      reconciliationRate: summary.rate,
    },
    matches: matches.map((m) => ({
      id: m.id,
      platform: m.platform,
      orderGroupStart: m.order_group_start,
      orderGroupEnd: m.order_group_end,
      orderCount: m.order_count,
      expectedAmount: m.expected_amount,
      bankTxId: m.bank_tx_id,
      bankDate: m.bank_date,
      bankAmount: m.bank_amount,
      variance: m.variance,
      status: m.status,
    })),
    summary: {
      totalExpectedRevenue: matches.reduce((s, m) => s + m.expected_amount, 0),
      totalPayoutAmount: matches.filter(m => m.status === "matched").reduce((s, m) => s + (m.bank_amount || 0), 0),
      totalBankDeposits: matches.filter(m => m.bank_amount).reduce((s, m) => s + (m.bank_amount || 0), 0),
      l1L2Variance: 0,
      l2L3Variance: summary.variance,
      reconciledChains: summary.matched,
      partialChains: 0,
      discrepancyChains: matches.filter(m => m.status === "discrepancy").length,
      unreconciledChains: summary.unmatched,
      activeAlerts: alerts.length,
    },
    alerts: alerts.map((a) => ({
      id: a.id,
      type: a.type,
      severity: a.severity,
      message: a.message,
      platform: a.platform,
      resolved: a.resolved === 1,
      createdAt: a.created_at,
    })),
    // Legacy fields for backward compat
    suggestions: [],
    reconciledPairs: [],
  });
}
