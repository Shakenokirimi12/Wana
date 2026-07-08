import { Container } from "@cloudflare/containers";

import type { Env } from "../types";

/**
 * Wraps the Go HTTP server in `apps/symbolicator/` so the worker can
 * resolve native crash addresses against a dSYM. One Container instance
 * is bound per dSYM UUID via `env.SYMBOLICATOR.getByName(uuid)` — keeps
 * the warm process holding that dSYM's pages so repeated symbolicate
 * calls (which happen when an issue accumulates events) re-use the same
 * llvm-symbolizer process.
 *
 * The container is sandboxed: no outbound internet (it only ever talks
 * to the worker via the Cloudflare-internal fetch loopback). The dSYM
 * bytes arrive in the request body, not from R2 directly — the worker
 * has the R2 binding and forwards.
 */
export class Symbolicator extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "5m";
  enableInternet = false;
  pingEndpoint = "/health";
}
