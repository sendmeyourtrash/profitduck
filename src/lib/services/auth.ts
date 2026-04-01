/**
 * Auth service — single-user authentication for Profit Duck.
 *
 * Password hashing: scrypt (Node built-in, zero deps)
 * Session: HMAC-signed token stored in httpOnly cookie
 */

import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "crypto";
import { getSettingValue, setSettingValue } from "../db/config-db";

const HASH_KEY = "auth_password_hash";
const SESSION_SECRET_KEY = "auth_session_secret";
const SCRYPT_KEY_LENGTH = 64;
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ---- Password hashing ----

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, storedHash] = stored.split(":");
  if (!salt || !storedHash) return false;
  const hash = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  const storedBuf = Buffer.from(storedHash, "hex");
  if (hash.length !== storedBuf.length) return false;
  return timingSafeEqual(hash, storedBuf);
}

// ---- Password management ----

export function isPasswordSet(): boolean {
  return !!getSettingValue(HASH_KEY);
}

export function setupPassword(password: string): void {
  if (isPasswordSet()) throw new Error("Password already set. Use changePassword() instead.");
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");
  setSettingValue(HASH_KEY, hashPassword(password));
  ensureSessionSecret();
}

export function changePassword(currentPassword: string, newPassword: string): void {
  const stored = getSettingValue(HASH_KEY);
  if (!stored || !verifyPassword(currentPassword, stored)) {
    throw new Error("Current password is incorrect.");
  }
  if (newPassword.length < 8) throw new Error("New password must be at least 8 characters.");
  setSettingValue(HASH_KEY, hashPassword(newPassword));
}

export function verifyLogin(password: string): boolean {
  const stored = getSettingValue(HASH_KEY);
  if (!stored) return false;
  return verifyPassword(password, stored);
}

// ---- Session tokens ----

function ensureSessionSecret(): string {
  let secret = getSettingValue(SESSION_SECRET_KEY);
  if (!secret) {
    secret = randomBytes(32).toString("hex");
    setSettingValue(SESSION_SECRET_KEY, secret);
  }
  return secret;
}

export function createSessionToken(): string {
  const secret = ensureSessionSecret();
  const timestamp = Date.now().toString();
  const signature = createHmac("sha256", secret).update(timestamp).digest("hex");
  return `${timestamp}.${signature}`;
}

export function verifySessionToken(token: string): boolean {
  if (!token) return false;
  const secret = getSettingValue(SESSION_SECRET_KEY);
  if (!secret) return false;

  const dotIndex = token.indexOf(".");
  if (dotIndex === -1) return false;

  const timestamp = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);

  const expected = createHmac("sha256", secret).update(timestamp).digest("hex");
  if (signature.length !== expected.length) return false;
  if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) return false;

  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) return false;
  return Date.now() - ts < SESSION_DURATION_MS;
}

// ---- Cookie helpers ----

export const SESSION_COOKIE_NAME = "pd_session";

export function buildSessionCookie(token: string): string {
  const isProduction = process.env.NODE_ENV === "production";
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}`,
  ];
  if (isProduction) parts.push("Secure");
  return parts.join("; ");
}

export function buildLogoutCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
