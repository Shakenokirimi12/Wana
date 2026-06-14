// Required because apps/worker/src/types.ts (imported transitively for the
// ProjectDataStore class type) references this module. The dashboard never
// constructs an EmailMessage at runtime — that path lives in wana-worker.
declare module "cloudflare:email" {
  export class EmailMessage {
    constructor(from: string, to: string, raw: string);
    readonly from: string;
    readonly to: string;
    readonly raw: string;
  }
}
