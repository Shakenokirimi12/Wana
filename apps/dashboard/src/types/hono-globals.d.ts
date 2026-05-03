export {};

declare module "hono" {
  interface ContextVariableMap {
    maintenance: boolean;
  }
}
