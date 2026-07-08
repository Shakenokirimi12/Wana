import type { ProjectDataStore } from "./do/ProjectDataStore";
import type { Env } from "./types";

/**
 * Per-image native-symbol metadata extracted from the Sentry payload.
 * `addresses` are the raw frame `instruction_addr`s that fall within
 * the image's load range; `imageLoadAddr` is the image's base address
 * (`image_addr` from debug_meta), used by the symbolicator to compute
 * a dSYM-relative offset per frame.
 */
interface ImageFrames {
  imageLoadAddr: string;
  addresses: string[];
}

export interface SymbolicatedFrame {
  address: string;
  function?: string;
  file?: string;
  line?: number;
  unresolved?: boolean;
}

/**
 * Detect native frames in the event payload and group them by their
 * containing image's UUID. Returns `null` when the payload has no
 * `debug_meta.images` (i.e. not a native event) so the caller can skip
 * the whole symbolicate path for the typical JS/Python/etc. case.
 */
export function extractNativeFrames(
  payload: unknown
): Map<string, ImageFrames> | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const debugMeta = p.debug_meta as
    | { images?: Array<Record<string, unknown>> }
    | undefined;
  const images = debugMeta?.images;
  if (!Array.isArray(images) || images.length === 0) return null;

  const ranges: Array<{ uuid: string; baseAddr: bigint; size: bigint }> = [];
  for (const img of images) {
    const debugId = img.debug_id;
    const imageAddr = img.image_addr;
    if (typeof debugId !== "string" || typeof imageAddr !== "string") continue;
    const uuid = debugId.replace(/-/g, "").toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(uuid)) continue;
    let baseAddr: bigint;
    try {
      baseAddr = parseAddrBig(imageAddr);
    } catch {
      continue;
    }
    const size =
      typeof img.image_size === "number" ? BigInt(img.image_size) : 0n;
    ranges.push({ uuid, baseAddr, size });
  }
  if (ranges.length === 0) return null;

  const byUuid = new Map<string, ImageFrames>();
  const collect = (frames: unknown): void => {
    if (!Array.isArray(frames)) return;
    for (const frame of frames) {
      if (!frame || typeof frame !== "object") continue;
      const addr = (frame as Record<string, unknown>).instruction_addr;
      if (typeof addr !== "string") continue;
      let addrBig: bigint;
      try {
        addrBig = parseAddrBig(addr);
      } catch {
        continue;
      }
      const match = ranges.find(
        (r) =>
          addrBig >= r.baseAddr &&
          (r.size === 0n || addrBig < r.baseAddr + r.size)
      );
      if (!match) continue;
      const entry =
        byUuid.get(match.uuid) ??
        ({
          imageLoadAddr: "0x" + match.baseAddr.toString(16),
          addresses: [],
        } satisfies ImageFrames);
      entry.addresses.push(addr);
      byUuid.set(match.uuid, entry);
    }
  };

  const exception = p.exception as { values?: unknown[] } | undefined;
  if (Array.isArray(exception?.values)) {
    for (const v of exception.values) {
      const stack = (v as Record<string, unknown>)?.stacktrace as
        | Record<string, unknown>
        | undefined;
      collect(stack?.frames);
    }
  }
  const threads = p.threads as { values?: unknown[] } | undefined;
  if (Array.isArray(threads?.values)) {
    for (const t of threads.values) {
      const stack = (t as Record<string, unknown>)?.stacktrace as
        | Record<string, unknown>
        | undefined;
      collect(stack?.frames);
    }
  }

  return byUuid.size > 0 ? byUuid : null;
}

function parseAddrBig(s: string): bigint {
  const trimmed = s.trim().replace(/^0[xX]/, "");
  if (!/^[0-9a-fA-F]+$/.test(trimmed)) {
    throw new Error("not hex");
  }
  return BigInt("0x" + trimmed);
}

/**
 * For a parsed event, look up dSYMs in the DO + R2 and route a
 * symbolicate request to the Container per image UUID. Returns a
 * `symbolsByUuid` map suitable for storing alongside the original
 * payload (we write it to R2 at `<r2-key>.symbols.json` so the issue
 * detail page can overlay names on the raw stack without mutating the
 * original event).
 *
 * Best-effort: per-image failures are logged + skipped so a single bad
 * dSYM doesn't lose the whole event's symbols.
 */
// Base64-encoding a dSYM (~4/3 blowup) plus the JSON envelope around it has
// to fit in the isolate's memory alongside everything else in flight. The
// debug-files upload path allows dSYMs up to 90 MB, which would produce a
// 120 MB+ request body — comfortably past the Workers memory ceiling and,
// unlike a normal exception, not something the per-image try/catch below can
// recover from. Skip (rather than crash) images whose dSYM exceeds a size
// we're confident fits.
const MAX_SYMBOLICATE_DSYM_BYTES = 32 * 1024 * 1024;

export async function symbolicateNativePayload(
  env: Env,
  store: DurableObjectStub<ProjectDataStore>,
  payload: unknown
): Promise<Record<string, SymbolicatedFrame[]> | null> {
  const native = extractNativeFrames(payload);
  if (!native) return null;

  const out: Record<string, SymbolicatedFrame[]> = {};
  await Promise.all(
    Array.from(native.entries()).map(async ([uuid, info]) => {
      try {
        const dbg = await store.findDebugFileByUuid(uuid);
        if (!dbg) return;
        const r2 = await env.PAYLOAD_STORAGE.get(dbg.r2Key);
        if (!r2) return;
        if (r2.size > MAX_SYMBOLICATE_DSYM_BYTES) {
          console.error(
            `[symbolicate] uuid=${uuid} dSYM too large to symbolicate (${r2.size} bytes > ${MAX_SYMBOLICATE_DSYM_BYTES})`
          );
          return;
        }
        const dsymBytes = await r2.arrayBuffer();
        const dsymB64 = arrayBufferToBase64(dsymBytes);

        // Pin one Container instance per dSYM UUID so warm callers re-use
        // the same llvm-symbolizer process (~50ms vs ~3s cold).
        const container = env.SYMBOLICATOR.getByName(uuid);
        await container.startAndWaitForPorts();
        const res = await container.fetch("http://symbolicator/symbolicate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            dsym_b64: dsymB64,
            image_load_addr: info.imageLoadAddr,
            addresses: info.addresses,
          }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          console.error(
            `[symbolicate] uuid=${uuid} status=${res.status}: ${detail.slice(0, 200)}`
          );
          return;
        }
        const body = (await res.json()) as { frames: SymbolicatedFrame[] };
        out[uuid] = body.frames;
      } catch (e) {
        console.error(`[symbolicate] uuid=${uuid} threw:`, e);
      }
    })
  );
  return Object.keys(out).length > 0 ? out : null;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  // Chunked to avoid blowing the call stack on String.fromCharCode for
  // large dSYMs (300 MB+ is rare but legal).
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(
      ...(bytes.subarray(i, i + CHUNK) as unknown as number[])
    );
  }
  return btoa(binary);
}
