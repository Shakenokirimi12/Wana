import { describe, it, expect } from "vitest";
import { hashHex, generateSentryPublicKey, apiKeyHint, parseSentryAuthHeader } from "../crypto";

describe("crypto", () => {
  describe("hashHex", () => {
    it("should generate a valid SHA-256 hex string", async () => {
      const hash = await hashHex("hello world");
      expect(hash).toHaveLength(64);
      // SHA-256 for "hello world"
      expect(hash).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
    });
  });

  describe("generateSentryPublicKey", () => {
    it("should start with 'wana' and have expected length", () => {
      const key = generateSentryPublicKey();
      expect(key).toMatch(/^wana[0-9a-f]{48}$/);
    });
  });

  describe("apiKeyHint", () => {
    it("should return the last 6 chars prefixed with ellipsis", () => {
      expect(apiKeyHint("1234567890abcdef")).toBe("…abcdef");
    });
  });

  describe("parseSentryAuthHeader", () => {
    it("should extract sentry_key", () => {
      const header = "Sentry sentry_version=7, sentry_key=abc-123_456, sentry_client=sentry.js";
      const parsed = parseSentryAuthHeader(header);
      expect(parsed?.sentryKey).toBe("abc-123_456");
    });

    it("should return null if sentry_key is missing", () => {
      expect(parseSentryAuthHeader("invalid")).toBeNull();
    });
  });
});
