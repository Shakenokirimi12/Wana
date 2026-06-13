import { drizzle } from "drizzle-orm/d1";
import * as schema from "@wana/schema/control-plane";

/**
 * Creates a Drizzle client for the Control Plane (D1).
 */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof createDb>;
