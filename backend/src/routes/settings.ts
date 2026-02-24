import { Router } from "express";
import type { Request, Response } from "express";
import { settings } from "../lib/db.js";

const router = Router();

// GET / — return all settings
router.get("/", (_req: Request, res: Response): void => {
  try {
    res.json(settings.all());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    res.status(500).json({ error: message });
  }
});

// PUT / — update a setting
router.put("/", (req: Request, res: Response): void => {
  const { key, value } = req.body as { key?: string; value?: string };

  if (!key || typeof key !== "string" || typeof value !== "string") {
    res.status(400).json({ error: "key and value are required strings" });
    return;
  }

  const ALLOWED_KEYS = new Set(["llm_provider", "llm_model", "min_severity", "webhook_url", "github_token", "anthropic_api_key", "openai_api_key"]);
  if (!ALLOWED_KEYS.has(key)) {
    res.status(400).json({ error: `Invalid setting key: ${key}` });
    return;
  }

  if (key === "llm_provider" && value !== "anthropic" && value !== "openai" && value !== "ollama") {
    res.status(400).json({ error: "llm_provider must be 'anthropic', 'openai', or 'ollama'" });
    return;
  }

  const VALID_SEVERITIES = new Set(["critical", "high", "medium", "low", "info"]);
  if (key === "min_severity" && !VALID_SEVERITIES.has(value)) {
    res.status(400).json({ error: "min_severity must be 'critical', 'high', 'medium', 'low', or 'info'" });
    return;
  }

  if (key === "webhook_url" && value !== "") {
    try {
      const parsed = new URL(value);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        res.status(400).json({ error: "webhook_url must use http or https" });
        return;
      }
    } catch {
      res.status(400).json({ error: "webhook_url must be a valid URL or empty string" });
      return;
    }
  }

  if (key === "github_token" && value !== "") {
    if (!/^(ghp_|github_pat_)/.test(value)) {
      res.status(400).json({ error: "github_token must be a GitHub personal access token (ghp_... or github_pat_...)" });
      return;
    }
  }

  try {
    settings.set(key, value);
    res.json(settings.all());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    res.status(500).json({ error: message });
  }
});

// Ollama model discovery — mounted at /api/ollama by index.ts
export const ollamaRouter = Router();

ollamaRouter.get("/models", async (_req: Request, res: Response) => {
  try {
    const resp = await fetch("http://localhost:11434/api/tags");
    if (!resp.ok) {
      res.json({ models: [], available: false });
      return;
    }
    const data = (await resp.json()) as {
      models?: { name: string; size: number }[];
    };
    const models = (data.models ?? []).map((m) => ({
      id: m.name,
      name: m.name,
      size: `${(m.size / 1e9).toFixed(1)} GB`,
    }));
    res.json({ models, available: true });
  } catch {
    res.json({ models: [], available: false });
  }
});

export default router;
