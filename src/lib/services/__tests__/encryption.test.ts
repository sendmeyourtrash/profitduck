import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// We need to control the ENCRYPTION_KEY env var per test
const originalEnv = process.env.ENCRYPTION_KEY;

describe("encryption service", () => {
  afterEach(() => {
    // Restore original env
    if (originalEnv === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = originalEnv;
    }
    // Clear module cache so deriveKey() re-reads env
    vi.resetModules();
  });

  async function loadModule() {
    return await import("../encryption");
  }

  describe("with ENCRYPTION_KEY set", () => {
    beforeEach(() => {
      process.env.ENCRYPTION_KEY = "test-secret-key-for-unit-tests";
    });

    it("encrypts and decrypts a value round-trip", async () => {
      const { encrypt, decrypt } = await loadModule();
      const plaintext = "sq-api-token-12345";
      const encrypted = encrypt(plaintext);
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted.startsWith("enc:")).toBe(true);
      expect(decrypt(encrypted)).toBe(plaintext);
    });

    it("produces different ciphertext for the same plaintext (unique IVs)", async () => {
      const { encrypt } = await loadModule();
      const a = encrypt("same-value");
      const b = encrypt("same-value");
      expect(a).not.toBe(b); // Different IVs
    });

    it("isEncrypted detects the enc: prefix", async () => {
      const { encrypt, isEncrypted } = await loadModule();
      expect(isEncrypted("plain-text")).toBe(false);
      expect(isEncrypted(encrypt("value"))).toBe(true);
    });

    it("decrypt passes through plaintext values unchanged", async () => {
      const { decrypt } = await loadModule();
      expect(decrypt("not-encrypted")).toBe("not-encrypted");
    });

    it("handles empty string", async () => {
      const { encrypt, decrypt } = await loadModule();
      const encrypted = encrypt("");
      expect(decrypt(encrypted)).toBe("");
    });

    it("handles special characters and unicode", async () => {
      const { encrypt, decrypt } = await loadModule();
      const value = 'key="val&ue" 日本語 🦆';
      expect(decrypt(encrypt(value))).toBe(value);
    });

    it("throws on tampered ciphertext", async () => {
      const { encrypt, decrypt } = await loadModule();
      const encrypted = encrypt("secret");
      // Tamper with the ciphertext portion
      const tampered = encrypted.slice(0, -2) + "XX";
      expect(() => decrypt(tampered)).toThrow();
    });

    it("isEncryptionEnabled returns true", async () => {
      const { isEncryptionEnabled } = await loadModule();
      expect(isEncryptionEnabled()).toBe(true);
    });
  });

  describe("without ENCRYPTION_KEY", () => {
    beforeEach(() => {
      delete process.env.ENCRYPTION_KEY;
    });

    it("encrypt returns plaintext unchanged", async () => {
      const { encrypt } = await loadModule();
      expect(encrypt("my-token")).toBe("my-token");
    });

    it("decrypt returns plaintext unchanged", async () => {
      const { decrypt } = await loadModule();
      expect(decrypt("my-token")).toBe("my-token");
    });

    it("decrypt throws on encrypted value when key is missing", async () => {
      // First encrypt with a key
      process.env.ENCRYPTION_KEY = "temp-key";
      const { encrypt } = await loadModule();
      const encrypted = encrypt("secret");

      // Now try to decrypt without key
      delete process.env.ENCRYPTION_KEY;
      vi.resetModules();
      const { decrypt } = await import("../encryption");
      expect(() => decrypt(encrypted)).toThrow("ENCRYPTION_KEY");
    });

    it("isEncryptionEnabled returns false", async () => {
      const { isEncryptionEnabled } = await loadModule();
      expect(isEncryptionEnabled()).toBe(false);
    });
  });
});
