import { describe, it, expect } from "vitest";
import { parseEventFromEnvelope } from "../event-parser";
import type { ParsedEnvelope } from "@wana/types";

describe("event-parser", () => {
  it("should return null for non-event envelopes", () => {
    const env: ParsedEnvelope = {
      header: { event_id: "123" },
      items: [{ header: { type: "session" }, payload: {} }],
    };
    expect(parseEventFromEnvelope(env, Date.now())).toBeNull();
  });

  it("should extract metadata from an exception event", () => {
    const env: ParsedEnvelope = {
      header: { event_id: "123" },
      items: [
        {
          header: { type: "event" },
          payload: {
            exception: {
              values: [{ type: "Error", value: "boom" }],
            },
            environment: "prod",
            release: "1.0.0",
            timestamp: 1600000000,
          },
        },
      ],
    };
    const meta = parseEventFromEnvelope(env, 1700000000000);
    expect(meta).not.toBeNull();
    expect(meta?.type).toBe("Error");
    expect(meta?.value).toBe("boom");
    expect(meta?.environment).toBe("prod");
    expect(meta?.release).toBe("1.0.0");
    expect(meta?.timestamp.getTime()).toBe(1600000000 * 1000);
    expect(meta?.fingerprint).toBe("Error::boom");
  });

  it("should extract metadata from a message event", () => {
    const env: ParsedEnvelope = {
      header: { event_id: "123" },
      items: [
        {
          header: { type: "event" },
          payload: {
            message: "hello world",
            level: "info",
            logger: "test",
          },
        },
      ],
    };
    const meta = parseEventFromEnvelope(env, 1700000000000);
    expect(meta).not.toBeNull();
    expect(meta?.type).toBe("INFO");
    expect(meta?.value).toBe("hello world");
    expect(meta?.fingerprint).toBe("message::info::hello world::test");
  });

  it("coerces a missing exception value to empty string (NOT NULL safe)", () => {
    const env: ParsedEnvelope = {
      header: { event_id: "123" },
      items: [
        {
          header: { type: "event" },
          // SDK sent a type but no value — must not produce undefined.
          payload: { exception: { values: [{ type: "TypeError" }] } } as never,
        },
      ],
    };
    const meta = parseEventFromEnvelope(env, 1700000000000);
    expect(meta).not.toBeNull();
    expect(meta?.type).toBe("TypeError");
    expect(meta?.value).toBe("");
  });

  it("falls back to receivedAt for an invalid (NaN) payload timestamp", () => {
    const now = 1700000000000;
    const env: ParsedEnvelope = {
      header: { event_id: "123" },
      items: [
        {
          header: { type: "event" },
          payload: {
            exception: { values: [{ type: "Error", value: "x" }] },
            timestamp: Number.NaN as never,
          },
        },
      ],
    };
    const meta = parseEventFromEnvelope(env, now);
    expect(meta?.timestamp.getTime()).toBe(now);
  });

  it("should use receivedAt if payload timestamp is missing", () => {
    const now = 1700000000000;
    const env: ParsedEnvelope = {
      header: { event_id: "123" },
      items: [
        {
          header: { type: "event" },
          payload: {
            message: "msg",
          },
        },
      ],
    };
    const meta = parseEventFromEnvelope(env, now);
    expect(meta?.timestamp.getTime()).toBe(now);
  });

  it("extracts standard tags and well-known contexts", () => {
    const env: ParsedEnvelope = {
      header: { event_id: "1" },
      items: [
        {
          header: { type: "event" },
          payload: {
            exception: { values: [{ type: "Error", value: "x" }] },
            environment: "prod",
            release: "1.2.3",
            level: "error",
            platform: "javascript",
            tags: { customer_tier: "gold", route: "/dashboard" },
            contexts: {
              browser: { name: "Chrome", version: "120.0" },
              os: { name: "macOS", version: "14.3" },
              runtime: { name: "node", version: "20.0" },
            },
          },
        },
      ],
    };
    const meta = parseEventFromEnvelope(env, 1700000000000);
    expect(meta?.tags).toEqual({
      level: "error",
      platform: "javascript",
      environment: "prod",
      release: "1.2.3",
      "browser.name": "Chrome",
      "browser.version": "120.0",
      browser: "Chrome",
      "os.name": "macOS",
      "os.version": "14.3",
      os: "macOS",
      "runtime.name": "node",
      "runtime.version": "20.0",
      runtime: "node",
      customer_tier: "gold",
      route: "/dashboard",
    });
  });

  it("payload.tags overrides context-derived tags on key collision (user wins)", () => {
    const env: ParsedEnvelope = {
      header: { event_id: "1" },
      items: [
        {
          header: { type: "event" },
          payload: {
            exception: { values: [{ type: "E", value: "v" }] },
            contexts: { browser: { name: "Chrome" } },
            tags: { browser: "Firefox" } as never,
          },
        },
      ],
    };
    const meta = parseEventFromEnvelope(env, 1700000000000);
    expect(meta?.tags.browser).toBe("Firefox");
  });

  it("accepts array-of-tuples for payload.tags (browser SDK shape)", () => {
    const env: ParsedEnvelope = {
      header: { event_id: "1" },
      items: [
        {
          header: { type: "event" },
          payload: {
            exception: { values: [{ type: "E", value: "v" }] },
            tags: [["customer_tier", "gold"], ["route", "/x"]] as never,
          },
        },
      ],
    };
    const meta = parseEventFromEnvelope(env, 1700000000000);
    expect(meta?.tags.customer_tier).toBe("gold");
    expect(meta?.tags.route).toBe("/x");
  });

  it("truncates oversized tag values and drops invalid keys", () => {
    const big = "A".repeat(300);
    const env: ParsedEnvelope = {
      header: { event_id: "1" },
      items: [
        {
          header: { type: "event" },
          payload: {
            exception: { values: [{ type: "E", value: "v" }] },
            tags: {
              "valid_key": big,
              "BAD KEY!": "x", // space + bang → invalid alphabet → dropped
              "way_too_long_key_name_that_exceeds_the_64_char_limit_for_validity_xx":
                "y",
            } as never,
          },
        },
      ],
    };
    const meta = parseEventFromEnvelope(env, 1700000000000);
    expect(meta?.tags.valid_key?.length).toBe(200);
    expect(meta?.tags.valid_key?.endsWith("…")).toBe(true);
    expect(meta?.tags["bad key!"]).toBeUndefined();
    expect(Object.keys(meta?.tags ?? {})).not.toContain(
      "way_too_long_key_name_that_exceeds_the_64_char_limit_for_validity_xx"
    );
  });

  it("does NOT extract anything from payload.user (PII safe)", () => {
    const env: ParsedEnvelope = {
      header: { event_id: "1" },
      items: [
        {
          header: { type: "event" },
          payload: {
            exception: { values: [{ type: "E", value: "v" }] },
            user: {
              id: "u123",
              email: "alice@example.com",
              ip_address: "203.0.113.5",
              username: "alice",
            },
          },
        },
      ],
    };
    const meta = parseEventFromEnvelope(env, 1700000000000);
    const stringified = JSON.stringify(meta?.tags ?? {});
    expect(stringified.includes("alice")).toBe(false);
    expect(stringified.includes("203.0.113.5")).toBe(false);
    expect(stringified.includes("u123")).toBe(false);
  });
});
