import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import "./lib/db.js";
import express from "express";
import cors from "cors";
import scansRouter from "./routes/scans.js";
import findingsRouter from "./routes/findings.js";
import streamRouter from "./routes/stream.js";
import settingsRouter, { ollamaRouter } from "./routes/settings.js";
import evidenceRouter from "./routes/evidence.js";
import scheduledRouter from "./routes/scheduled.js";
import triggerRouter from "./routes/trigger.js";
import badgeRouter from "./routes/badge.js";
import integrationsRouter from "./routes/integrations.js";
import shareApiRouter, { shareRouter } from "./routes/share.js";
import { initScheduler } from "./lib/scheduler.js";

const app = express();
const PORT = process.env.PORT ?? 3001;

const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";
app.use(cors({ origin: corsOrigin === "*" ? true : corsOrigin.split(",") }));
app.use(express.json());

app.use("/api/scans", scansRouter);
app.use("/api/findings", findingsRouter);
app.use("/api/stream", streamRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/ollama", ollamaRouter);
app.use("/api/evidence", evidenceRouter);
app.use("/api/scheduled-scans", scheduledRouter);
app.use("/api/scan/trigger", triggerRouter);
app.use("/api/badge", badgeRouter);
app.use("/api/integrations", integrationsRouter);
app.use("/api/shared-reports", shareApiRouter);
app.use("/share", shareRouter);

app.get("/api/health", (_req: express.Request, res: express.Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Serve frontend static build in production (Docker / npm start)
const PROJECT_ROOT = path.resolve(__dirname, "../../");
const frontendDist = path.join(PROJECT_ROOT, "frontend", "dist");
if (existsSync(path.join(frontendDist, "index.html"))) {
  app.use(express.static(frontendDist));
  app.get("*", (_req: express.Request, res: express.Response) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

initScheduler();

app.listen(PORT, () => {
  console.log(`Magnus backend running on port ${PORT}`);
});
