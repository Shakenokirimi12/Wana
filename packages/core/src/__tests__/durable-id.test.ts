import { describe, it, expect, vi } from "vitest";
import { durableObjectIdForStoredProject } from "../durable-id";

describe("durable-id", () => {
  const mockNs = {
    idFromString: vi.fn((s) => ({ id: s, kind: "from-string" })),
    idFromName: vi.fn((s) => ({ id: s, kind: "from-name" })),
  };

  it("should use idFromString for 64 hex chars", () => {
    const hex64 = "a".repeat(64);
    const result = durableObjectIdForStoredProject(mockNs as any, hex64);
    expect(mockNs.idFromString).toHaveBeenCalledWith(hex64);
    expect(result.kind).toBe("from-string");
  });

  it("should use idFromName for other strings", () => {
    const name = "my-project";
    const result = durableObjectIdForStoredProject(mockNs as any, name);
    expect(mockNs.idFromName).toHaveBeenCalledWith(name);
    expect(result.kind).toBe("from-name");
  });

  it("should trim the input", () => {
    const name = "  my-project  ";
    durableObjectIdForStoredProject(mockNs as any, name);
    expect(mockNs.idFromName).toHaveBeenCalledWith("my-project");
  });
});
