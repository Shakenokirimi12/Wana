import { describe, it, expect } from "vitest";
import { parseSearchQuery, matchIssue } from "../search-query";

describe("parseSearchQuery", () => {
  it("returns empty defaults for an empty input", () => {
    const q = parseSearchQuery("");
    expect(q.status).toBeNull();
    expect(q.tagFilters).toEqual([]);
    expect(q.freeText).toEqual([]);
  });

  it("parses status, key:value, quoted, free text and negation", () => {
    const q = parseSearchQuery(
      'is:unresolved browser:Chrome environment:"prod prod" !runtime:node foo bar'
    );
    expect(q.status).toBe("unresolved");
    expect(q.tagFilters).toEqual([
      { key: "browser", values: ["Chrome"] },
      { key: "environment", values: ["prod prod"] },
    ]);
    expect(q.negTagFilters).toEqual([{ key: "runtime", value: "node" }]);
    expect(q.freeText).toEqual(["foo", "bar"]);
  });

  it("parses comma-separated OR within a key", () => {
    const q = parseSearchQuery("level:error,warning");
    expect(q.tagFilters).toEqual([
      { key: "level", values: ["error", "warning"] },
    ]);
  });

  it("parses has: and !has:", () => {
    const q = parseSearchQuery("has:release !has:browser");
    expect(q.hasKeys).toEqual(["release"]);
    expect(q.negHasKeys).toEqual(["browser"]);
  });

  it("treats malformed key:value as free text (preserves token)", () => {
    const q = parseSearchQuery("BAD KEY!:value plain");
    // `BAD` becomes free text, `KEY!:value` is malformed → preserved as free text,
    // `plain` is plain free text.
    expect(q.freeText).toContain("BAD");
    expect(q.freeText).toContain("plain");
    expect(q.freeText.some((t) => t.includes("KEY!"))).toBe(true);
  });
});

describe("matchIssue", () => {
  const base = {
    status: "unresolved",
    value: "Connection refused",
    type: "NetworkError",
    culprit: "api/client.ts:42",
  };
  const browser: Record<string, string> = { browser: "Chrome", environment: "prod" };
  const node: Record<string, string> = { runtime: "node", environment: "prod" };

  it("matches when free text is a substring of value/type/culprit", () => {
    const q = parseSearchQuery("Connection");
    expect(matchIssue({ ...base, eventTagMaps: [browser] }, q)).toBe(true);
  });

  it("rejects when status does not match", () => {
    const q = parseSearchQuery("is:resolved");
    expect(matchIssue({ ...base, eventTagMaps: [browser] }, q)).toBe(false);
  });

  it("AND across keys requires the SAME event to satisfy all", () => {
    const q = parseSearchQuery("browser:Chrome runtime:node");
    // Two events, each satisfies one half → should NOT match (Sentry semantic).
    expect(
      matchIssue({ ...base, eventTagMaps: [browser, node] }, q)
    ).toBe(false);
    // One event satisfies both → matches.
    const both = { browser: "Chrome", runtime: "node" };
    expect(matchIssue({ ...base, eventTagMaps: [both] }, q)).toBe(true);
  });

  it("comma OR within a key matches any of the values", () => {
    const q = parseSearchQuery("browser:Firefox,Chrome");
    expect(matchIssue({ ...base, eventTagMaps: [browser] }, q)).toBe(true);
  });

  it("negation excludes if ANY event in the issue has the tag value", () => {
    const q = parseSearchQuery("!browser:Chrome");
    expect(matchIssue({ ...base, eventTagMaps: [browser] }, q)).toBe(false);
    expect(matchIssue({ ...base, eventTagMaps: [node] }, q)).toBe(true);
  });

  it("has: requires at least one event to have the tag key", () => {
    const q = parseSearchQuery("has:browser");
    expect(matchIssue({ ...base, eventTagMaps: [browser] }, q)).toBe(true);
    expect(matchIssue({ ...base, eventTagMaps: [node] }, q)).toBe(false);
  });
});
