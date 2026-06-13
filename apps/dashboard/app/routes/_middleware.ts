import { createRoute } from "honox/factory";

import { csrfMiddleware } from "@/middleware/csrf";
import { loopbackRedirectMiddleware } from "@/middleware/loopback-redirect";
import { maintenanceMiddleware } from "@/middleware/maintenance";
import { sessionMiddleware } from "@/middleware/session";

export default createRoute(
  loopbackRedirectMiddleware,
  csrfMiddleware,
  sessionMiddleware,
  maintenanceMiddleware
);
