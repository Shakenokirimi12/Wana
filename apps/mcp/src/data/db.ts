import { drizzle } from "drizzle-orm/d1";
import * as schema from "@wana/schema/control-plane";

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}
