import type { Env } from "../types/bindings";

const HEX64 = /^[0-9a-f]{64}$/i;

function durableObjectIdForStoredProject(
  ns: Env["PROJECT_DO"],
  storedDoId: string
) {
  const s = storedDoId.trim();
  if (HEX64.test(s)) {
    return ns.idFromString(s);
  }
  return ns.idFromName(s);
}

/**
 * Stub for the project-scoped Durable Object (defined on `wana-worker`).
 */
export function getProjectDataStore(env: Env, doId: string) {
  const id = durableObjectIdForStoredProject(env.PROJECT_DO, doId);
  return env.PROJECT_DO.get(id);
}
