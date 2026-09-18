import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// In production, this single Express process also serves the built React
// frontend, so the whole app is one deployable service (one URL, no CORS,
// no separate frontend host). In dev, the frontend runs on its own Vite
// dev server instead, so this block is skipped.
if (process.env["NODE_ENV"] === "production") {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/index.mjs -> artifacts/api-server/dist -> ../../trackaccess-optimiser/dist/public
  const staticDir = path.resolve(
    here,
    "../../trackaccess-optimiser/dist/public",
  );

  app.use(express.static(staticDir));

  // SPA fallback: any non-API GET request gets index.html so client-side
  // routing (wouter) can take over.
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

export default app;
