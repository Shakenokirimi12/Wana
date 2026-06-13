/** Values from DurableObjectNamespace.newUniqueId().toString() are 64 hex chars. */
const HEX64 = /^[0-9a-f]{64}$/i;

/**
 * Resolves a Durable Object ID from a stored string (either hex ID or name).
 */
export function durableObjectIdForStoredProject(
  ns: {
    idFromString: (hex: string) => any;
    idFromName: (name: string) => any;
  },
  storedDoId: string
) {
  const s = storedDoId.trim();
  if (HEX64.test(s)) {
    return ns.idFromString(s);
  }
  return ns.idFromName(s);
}
