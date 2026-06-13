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
});
