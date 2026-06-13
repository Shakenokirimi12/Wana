import { describe, it, expect } from "vitest";
import { calculateFingerprint, calculateMessageFingerprint } from "../fingerprint";

describe("fingerprint", () => {
  describe("calculateFingerprint", () => {
    it("should include type and value", () => {
      const ex = { type: "TypeError", value: "out of bounds" };
      expect(calculateFingerprint(ex)).toBe("TypeError::out of bounds");
    });

    it("should include stacktrace frames if available", () => {
      const ex = {
        type: "Error",
        value: "fail",
        stacktrace: {
          frames: [
            { filename: "a.js", function: "foo", lineno: 10 },
            { filename: "b.js", function: "bar", lineno: 20 },
          ],
        },
      };
      expect(calculateFingerprint(ex)).toBe("Error::fail::b.js::bar::20");
    });
  });

  describe("calculateMessageFingerprint", () => {
    it("should include message, level and logger", () => {
      expect(calculateMessageFingerprint("hello", "info", "main")).toBe("message::info::hello::main");
    });

    it("should use defaults if level or logger are missing", () => {
      expect(calculateMessageFingerprint("hello")).toBe("message::info::hello::");
    });
  });
});
