import { describe, it, expect } from "vitest";
import { normalizeOrgSlug, normalizeUsernameKey } from "../utils";

describe("utils", () => {
  describe("normalizeOrgSlug", () => {
    it("should lowercase and replace invalid chars with hyphens", () => {
      expect(normalizeOrgSlug("My Organization!")).toBe("my-organization");
    });

    it("should collapse multiple hyphens", () => {
      expect(normalizeOrgSlug("foo---bar")).toBe("foo-bar");
    });

    it("should trim leading and trailing hyphens", () => {
      expect(normalizeOrgSlug("-foo-bar-")).toBe("foo-bar");
    });
  });

  describe("normalizeUsernameKey", () => {
    it("should lowercase and replace spaces with underscores", () => {
      expect(normalizeUsernameKey("John Doe")).toBe("john_doe");
    });
  });
});
