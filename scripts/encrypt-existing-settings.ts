/**
 * One-time migration script: encrypt existing plaintext tokens in categories.db.
 *
 * Run after setting the ENCRYPTION_KEY env var for the first time:
 *   ENCRYPTION_KEY=your-secret npx tsx scripts/encrypt-existing-settings.ts
 *
 * Safe to run multiple times — already-encrypted values are skipped.
 */

import Database from "better-sqlite3";
import path from "path";
import { encrypt, isEncrypted, isEncryptionEnabled } from "../src/lib/services/encryption";

const SENSITIVE_KEYS = ["square_api_token", "plaid_access_token"];

function main() {
  if (!isEncryptionEnabled()) {
    console.error("ENCRYPTION_KEY environment variable is not set. Nothing to do.");
    process.exit(1);
  }

  const dbPath = path.join(process.cwd(), "databases", "categories.db");
  const db = new Database(dbPath);

  let migrated = 0;
  let skipped = 0;

  for (const key of SENSITIVE_KEYS) {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;

    if (!row) {
      console.log(`  ${key}: not set — skipped`);
      skipped++;
      continue;
    }

    if (isEncrypted(row.value)) {
      console.log(`  ${key}: already encrypted — skipped`);
      skipped++;
      continue;
    }

    const encrypted = encrypt(row.value);
    db.prepare("UPDATE settings SET value = ? WHERE key = ?").run(encrypted, key);
    console.log(`  ${key}: encrypted (${row.value.length} chars → ${encrypted.length} chars)`);
    migrated++;
  }

  db.close();
  console.log(`\nDone: ${migrated} encrypted, ${skipped} skipped.`);
}

main();
