/**
 * Rebuild unified databases from vendor DBs (Step 2 + Step 3).
 * Usage: npx tsx scripts/rebuild-pipeline.ts
 */
import { step2UnifyAll } from "../src/lib/services/pipeline-step2-unify";
import { step3ApplyAliases } from "../src/lib/services/pipeline-step3-aliases";

console.log("=== Pipeline Rebuild ===\n");

console.log("Step 2: Vendor DB → Unified DB...");
const r2 = step2UnifyAll(true);
r2.forEach(r => console.log(`  ${r.platform}: inserted=${r.inserted}, skipped=${r.skipped}`));

console.log("\nStep 3: Apply Aliases...");
const r3 = step3ApplyAliases();
console.log(`  items=${r3.itemAliasesApplied}, categories=${r3.categoryAliasesApplied}, total=${r3.totalItems}`);

console.log("\n=== Done ===");
