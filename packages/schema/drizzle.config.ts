import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/control-plane.ts",
  out: "./migrations",
  dialect: "sqlite",
});
