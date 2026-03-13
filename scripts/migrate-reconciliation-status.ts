/**
 * Migration script to:
 * 1. Backfill reconciliationStatus from existing reconciled boolean
 * 2. Run initial L1-L2 matching
 * 3. Run alert scan
 * 4. Print summary
 *
 * Run with: npx tsx scripts/migrate-reconciliation-status.ts
 */
import { prisma } from "../src/lib/db/prisma";
import { matchLevel1ToLevel2 } from "../src/lib/services/reconciliation/l1-l2-matcher";
import { autoMatchL2L3 } from "../src/lib/services/reconciliation/l2-l3-matcher";
import { runAlertScan } from "../src/lib/services/reconciliation/alert-engine";
import { getReconciliationSummary } from "../src/lib/services/reconciliation/chain-builder";

async function main() {
  console.log("=== Reconciliation Migration ===\n");

  // 1. Backfill reconciliationStatus from existing reconciled boolean
  console.log("Step 1: Backfilling reconciliation status from existing data...");

  const reconciledBankTxns = await prisma.bankTransaction.updateMany({
    where: { reconciled: true, reconciliationStatus: "unreconciled" },
    data: { reconciliationStatus: "reconciled" },
  });
  console.log(`  Updated ${reconciledBankTxns.count} bank transactions to 'reconciled'`);

  const linkedPayouts = await prisma.payout.updateMany({
    where: {
      bankTransactionId: { not: null },
      reconciliationStatus: "unreconciled",
    },
    data: { reconciliationStatus: "partially_reconciled" },
  });
  console.log(`  Updated ${linkedPayouts.count} payouts to 'partially_reconciled'`);

  // 2. Run L1-L2 matching
  console.log("\nStep 2: Running L1→L2 matching...");
  const l1l2 = await matchLevel1ToLevel2();
  console.log(`  Matched: ${l1l2.matched} orders`);
  console.log(`  Unmatched: ${l1l2.unmatched} orders`);
  console.log(`  Discrepancies: ${l1l2.discrepancies}`);
  if (l1l2.alerts.length > 0) {
    console.log(`  Alerts generated:`);
    for (const a of l1l2.alerts.slice(0, 5)) {
      console.log(`    - ${a.message}`);
    }
  }

  // 3. Auto-match high-confidence L2-L3
  console.log("\nStep 3: Auto-matching L2→L3 (confidence ≥ 0.9)...");
  const autoMatched = await autoMatchL2L3(0.9);
  console.log(`  Auto-matched: ${autoMatched} payout-bank pairs`);

  // 4. Run alert scan
  console.log("\nStep 4: Running alert scan...");
  const newAlerts = await runAlertScan();
  console.log(`  New alerts created: ${newAlerts}`);

  // 5. Summary
  console.log("\n=== Final Summary ===");
  const summary = await getReconciliationSummary();
  console.log(`  L1 Expected Revenue:   $${summary.totalExpectedRevenue.toFixed(2)}`);
  console.log(`  L2 Payout Total:       $${summary.totalPayoutAmount.toFixed(2)}`);
  console.log(`  L3 Bank Deposits:      $${summary.totalBankDeposits.toFixed(2)}`);
  console.log(`  L1→L2 Variance:        $${summary.l1L2Variance.toFixed(2)}`);
  console.log(`  L2→L3 Variance:        $${summary.l2L3Variance.toFixed(2)}`);
  console.log(`  Reconciled chains:     ${summary.reconciledChains}`);
  console.log(`  Partial chains:        ${summary.partialChains}`);
  console.log(`  Discrepancy chains:    ${summary.discrepancyChains}`);
  console.log(`  Unreconciled chains:   ${summary.unreconciledChains}`);
  console.log(`  Active alerts:         ${summary.activeAlerts}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
