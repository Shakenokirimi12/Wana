import type { DurableObjectNamespace } from "@cloudflare/workers-types";

/** Values from {@link DurableObjectNamespace#newUniqueId}{@code .toString()}. */
const HEX64 = /^[0-9a-f]{64}$/i;

/**
 * `projects.do_id` in D1: either a {@link DurableObjectNamespace#newUniqueId} string (64 hex),
 * or any other stable string resolved with {@link DurableObjectNamespace#idFromName} (e.g. seeds).
 */
export function durableObjectIdForStoredProject(
  ns: DurableObjectNamespace,
  storedDoId: string
) {
  const s = storedDoId.trim();
  if (HEX64.test(s)) {
    return ns.idFromString(s);
  }
  return ns.idFromName(s);
}
