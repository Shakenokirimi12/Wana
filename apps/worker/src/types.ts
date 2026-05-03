import type { QueueMessage } from "@wana/types";

export interface Env {
  SYSTEM_CONFIG: KVNamespace;
  PAYLOAD_STORAGE: R2Bucket;
  PROJECT_DO: DurableObjectNamespace<ProjectDataStore>;
}

import type { ProjectDataStore } from "./do/ProjectDataStore";
