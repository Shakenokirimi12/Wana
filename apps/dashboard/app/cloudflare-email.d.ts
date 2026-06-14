// See apps/worker/src/cloudflare-email.d.ts for context.
declare module "cloudflare:email" {
  export class EmailMessage {
    constructor(from: string, to: string, raw: string);
    readonly from: string;
    readonly to: string;
    readonly raw: string;
  }
}
