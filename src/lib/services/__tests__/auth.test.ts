import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock config-db so we don't need a real SQLite database
const store = new Map<string, string>();

vi.mock("../../db/config-db", () => ({
  getSettingValue: (key: string) => store.get(key) ?? null,
  setSettingValue: (key: string, value: string) => { store.set(key, value); },
}));

import {
  isPasswordSet,
  setupPassword,
  verifyLogin,
  changePassword,
  createSessionToken,
  verifySessionToken,
  SESSION_COOKIE_NAME,
  buildSessionCookie,
  buildLogoutCookie,
} from "../auth";

describe("auth service", () => {
  beforeEach(() => {
    store.clear();
  });

  // ---- Password management ----

  describe("setupPassword", () => {
    it("stores a hashed password", () => {
      setupPassword("mypassword123");
      expect(isPasswordSet()).toBe(true);
      // The stored value should be salt:hash, not plaintext
      const stored = store.get("auth_password_hash")!;
      expect(stored).toContain(":");
      expect(stored).not.toContain("mypassword123");
    });

    it("rejects passwords shorter than 8 characters", () => {
      expect(() => setupPassword("short")).toThrow("at least 8");
    });

    it("prevents double setup", () => {
      setupPassword("password123");
      expect(() => setupPassword("another123")).toThrow("already set");
    });
  });

  describe("verifyLogin", () => {
    it("returns true for correct password", () => {
      setupPassword("correcthorse");
      expect(verifyLogin("correcthorse")).toBe(true);
    });

    it("returns false for wrong password", () => {
      setupPassword("correcthorse");
      expect(verifyLogin("wrongpassword")).toBe(false);
    });

    it("returns false when no password is set", () => {
      expect(verifyLogin("anything")).toBe(false);
    });
  });

  describe("changePassword", () => {
    it("changes the password when current is correct", () => {
      setupPassword("oldpassword1");
      changePassword("oldpassword1", "newpassword1");
      expect(verifyLogin("newpassword1")).toBe(true);
      expect(verifyLogin("oldpassword1")).toBe(false);
    });

    it("rejects change when current password is wrong", () => {
      setupPassword("oldpassword1");
      expect(() => changePassword("wrongpass11", "newpassword1")).toThrow("incorrect");
    });

    it("rejects new password shorter than 8 characters", () => {
      setupPassword("oldpassword1");
      expect(() => changePassword("oldpassword1", "short")).toThrow("at least 8");
    });
  });

  // ---- Session tokens ----

  describe("session tokens", () => {
    beforeEach(() => {
      // Setup creates the session secret
      setupPassword("testpasswd1");
    });

    it("creates a valid token that verifies", () => {
      const token = createSessionToken();
      expect(token).toContain(".");
      expect(verifySessionToken(token)).toBe(true);
    });

    it("rejects a tampered token", () => {
      const token = createSessionToken();
      const tampered = token.slice(0, -4) + "dead";
      expect(verifySessionToken(tampered)).toBe(false);
    });

    it("rejects an empty token", () => {
      expect(verifySessionToken("")).toBe(false);
    });

    it("rejects a token without a dot separator", () => {
      expect(verifySessionToken("nodot")).toBe(false);
    });

    it("rejects an expired token", () => {
      // Create a token with a timestamp 31 days in the past
      const oldTimestamp = (Date.now() - 31 * 24 * 60 * 60 * 1000).toString();
      const secret = store.get("auth_session_secret")!;
      const { createHmac } = require("crypto");
      const sig = createHmac("sha256", secret).update(oldTimestamp).digest("hex");
      const expiredToken = `${oldTimestamp}.${sig}`;
      expect(verifySessionToken(expiredToken)).toBe(false);
    });
  });

  // ---- Cookie helpers ----

  describe("cookie helpers", () => {
    it("SESSION_COOKIE_NAME is pd_session", () => {
      expect(SESSION_COOKIE_NAME).toBe("pd_session");
    });

    it("buildSessionCookie includes HttpOnly and SameSite", () => {
      const cookie = buildSessionCookie("test-token");
      expect(cookie).toContain("pd_session=test-token");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Path=/");
    });

    it("buildLogoutCookie sets Max-Age=0", () => {
      const cookie = buildLogoutCookie();
      expect(cookie).toContain("Max-Age=0");
      expect(cookie).toContain("pd_session=");
    });
  });
});
