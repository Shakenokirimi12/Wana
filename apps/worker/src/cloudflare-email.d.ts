// Type shim for the `cloudflare:email` runtime module. `@cloudflare/workers-types`
// does not yet expose this declaration; the runtime provides it from the
// workerd `cloudflare:email` worker built-in.

declare module "cloudflare:email" {
  export class EmailMessage {
    constructor(from: string, to: string, raw: string);
    readonly from: string;
    readonly to: string;
    readonly raw: string;
  }
}
