import { createRoute } from "honox/factory";

import { loopbackRedirectMiddleware } from "@/middleware/loopback-redirect";
import { maintenanceMiddleware } from "@/middleware/maintenance";
import { sessionMiddleware } from "@/middleware/session";

export default createRoute(
  loopbackRedirectMiddleware,
  sessionMiddleware,
  maintenanceMiddleware
);
