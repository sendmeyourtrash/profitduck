/**
 * Encryption service — AES-256-GCM encryption for sensitive settings.
 *
 * When ENCRYPTION_KEY env var is set, sensitive values (API tokens, etc.)
 * are encrypted before storage and decrypted on read.
 * When ENCRYPTION_KEY is not set, values are stored as plaintext (local dev).
 *
 * Format: enc:base64(iv):base64(authTag):base64(ciphertext)
 */

import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ENCRYPTED_PREFIX = "enc:";

function deriveKey(): Buffer | null {
  const envKey = process.env.ENCRYPTION_KEY;
  if (!envKey) return null;
  return scryptSync(envKey, "profitduck-encryption-salt", KEY_LENGTH);
}

export function encrypt(plaintext: string): string {
  const key = deriveKey();
  if (!key) return plaintext;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return ENCRYPTED_PREFIX + [
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

export function decrypt(ciphertext: string): string {
  if (!ciphertext.startsWith(ENCRYPTED_PREFIX)) return ciphertext;

  const key = deriveKey();
  if (!key) {
    throw new Error("Cannot decrypt: ENCRYPTION_KEY environment variable is not set");
  }

  const parts = ciphertext.slice(ENCRYPTED_PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted value format");

  const iv = Buffer.from(parts[0], "base64");
  const authTag = Buffer.from(parts[1], "base64");
  const encrypted = Buffer.from(parts[2], "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

export function isEncryptionEnabled(): boolean {
  return !!process.env.ENCRYPTION_KEY;
}
