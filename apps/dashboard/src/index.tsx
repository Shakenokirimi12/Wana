import { Hono } from "hono";

import { maintenanceMiddleware } from "./middleware/maintenance";
import { homeRoute } from "./routes/home";
import { projectSetupRoute } from "./routes/project-setup";
import { projectsRoute } from "./routes/projects";
import { renderer } from "./renderer";
import type { Env } from "./types/bindings";

const app = new Hono<{ Bindings: Env }>();

app.use(maintenanceMiddleware);
app.use(renderer);
app.route("/", homeRoute);
app.route("/projects", projectSetupRoute);
app.route("/p", projectsRoute);

export default app;
