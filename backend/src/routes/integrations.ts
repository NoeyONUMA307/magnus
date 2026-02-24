import { Router } from "express";
import type { Request, Response } from "express";
import { settings } from "../lib/db.js";

const router = Router();

// POST /test-webhook — Send a test notification to the configured webhook URL
router.post("/test-webhook", async (_req: Request, res: Response) => {
  const webhookUrl = settings.get("webhook_url");
  if (!webhookUrl) {
    res.status(400).json({ error: "No webhook URL configured" });
    return;
  }

  const message = "Magnus test notification\nThis confirms your webhook is working correctly.";

  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message, content: message }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      res.status(502).json({ error: `Webhook returned ${resp.status}` });
      return;
    }

    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Webhook failed: ${msg}` });
  }
});

// POST /test-github — Validate the configured GitHub token
router.post("/test-github", async (_req: Request, res: Response) => {
  const token = settings.get("github_token");
  if (!token) {
    res.status(400).json({ error: "No GitHub token configured" });
    return;
  }

  try {
    const resp = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      res.status(502).json({ error: `GitHub returned ${resp.status} — check your token` });
      return;
    }

    const user = (await resp.json()) as { login: string };
    res.json({ ok: true, login: user.login });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `GitHub request failed: ${msg}` });
  }
});

export default router;
