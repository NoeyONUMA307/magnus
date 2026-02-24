import { Router } from "express";
import type { Request, Response } from "express";
import { scans, findings, settings } from "../lib/db.js";
import { runScan } from "../agent/magnus.js";
import { getActiveModel } from "../lib/llm.js";
import type { ScanType } from "../types/index.js";

const router = Router();

const VALID_SCAN_TYPES = new Set<string>(["whitebox", "blackbox"]);

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

interface TriggerRequest {
  url: string;
  scan_type?: ScanType;
  auth_headers?: Record<string, string>;
  openapi_spec?: Record<string, unknown>;
  write_probes_enabled?: boolean;
  callback_url?: string;
  github_repo?: string;
  pr_number?: number;
}

interface CallbackPayload {
  scan_id: string;
  url: string;
  status: "complete" | "failed";
  pass: boolean;
  risk_score: number | null;
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    exploited: number;
  };
  findings: Array<{
    title: string;
    severity: string;
    cvss_score: number | null;
    endpoint: string | null;
    cwe: string | null;
    owasp: string | null;
    exploited: boolean;
    description: string | null;
  }>;
  completed_at: string | null;
}

async function fireCallback(callbackUrl: string, payload: CallbackPayload): Promise<void> {
  try {
    const res = await fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.error(`Callback to ${callbackUrl} returned ${res.status}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Callback to ${callbackUrl} failed: ${msg}`);
  }
}

// POST / — Trigger a scan (CI/CD integration)
router.post("/", (req: Request, res: Response): void => {
  const body = req.body as Partial<TriggerRequest>;
  const { url, scan_type = "blackbox", auth_headers, openapi_spec, write_probes_enabled, callback_url, github_repo, pr_number } = body;

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url is required and must be a string" });
    return;
  }

  if (!VALID_SCAN_TYPES.has(scan_type)) {
    res.status(400).json({ error: "scan_type must be 'whitebox' or 'blackbox'" });
    return;
  }

  if (auth_headers !== undefined) {
    if (typeof auth_headers !== "object" || auth_headers === null || Array.isArray(auth_headers)) {
      res.status(400).json({ error: "auth_headers must be an object of string key-value pairs" });
      return;
    }
    for (const [k, v] of Object.entries(auth_headers)) {
      if (typeof k !== "string" || typeof v !== "string") {
        res.status(400).json({ error: "auth_headers values must be strings" });
        return;
      }
    }
  }

  if (callback_url !== undefined) {
    if (typeof callback_url !== "string") {
      res.status(400).json({ error: "callback_url must be a string" });
      return;
    }
    try {
      const parsed = new URL(callback_url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        res.status(400).json({ error: "callback_url must use http or https" });
        return;
      }
    } catch {
      res.status(400).json({ error: "callback_url must be a valid URL" });
      return;
    }
  }

  if (github_repo !== undefined || pr_number !== undefined) {
    if (typeof github_repo !== "string" || typeof pr_number !== "number") {
      res.status(400).json({ error: "github_repo (string) and pr_number (number) must both be provided" });
      return;
    }
    if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(github_repo)) {
      res.status(400).json({ error: "github_repo must be in 'owner/repo' format" });
      return;
    }
    if (!Number.isInteger(pr_number) || pr_number < 1) {
      res.status(400).json({ error: "pr_number must be a positive integer" });
      return;
    }
  }

  try {
    const metadata: Record<string, unknown> = {};
    if (auth_headers && Object.keys(auth_headers).length > 0) {
      metadata.auth_headers = auth_headers;
    }
    if (openapi_spec && typeof openapi_spec === "object" && !Array.isArray(openapi_spec)) {
      metadata.openapi_spec = openapi_spec;
    }
    if (write_probes_enabled === true) {
      metadata.write_probes_enabled = true;
    }
    if (callback_url) {
      metadata.callback_url = callback_url;
    }
    if (github_repo && pr_number) {
      metadata.github_repo = github_repo;
      metadata.pr_number = pr_number;
    }

    const normalized = normalizeUrl(url);
    const scan = scans.create({ url: normalized, scan_type, model: getActiveModel(), metadata });

    // Run scan in background, fire callback on completion
    void runScan(scan.id, normalized, scan_type as ScanType).then(() => {
      if (!callback_url) return;

      const completedScan = scans.get(scan.id);
      const scanFindings = findings.list(scan.id);
      const activeFindings = scanFindings.filter((f) => f.status !== "dismissed" && f.status !== "accepted_risk");

      const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
      for (const f of activeFindings) {
        if (f.severity in counts) {
          counts[f.severity as keyof typeof counts] += 1;
        }
      }

      const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
      const minSev = settings.get("min_severity") ?? "low";
      const minRank = SEV_RANK[minSev] ?? 1;
      const pass = !activeFindings.some((f) => (SEV_RANK[f.severity] ?? 0) >= minRank);

      const payload: CallbackPayload = {
        scan_id: scan.id,
        url,
        status: completedScan?.status === "complete" ? "complete" : "failed",
        pass,
        risk_score: completedScan?.risk_score ?? null,
        summary: {
          total: scanFindings.length,
          ...counts,
          exploited: scanFindings.filter((f) => f.exploited).length,
        },
        findings: scanFindings.map((f) => ({
          title: f.title,
          severity: f.severity,
          cvss_score: f.cvss_score,
          endpoint: f.endpoint,
          cwe: f.cwe,
          owasp: f.owasp,
          exploited: f.exploited,
          description: f.description,
        })),
        completed_at: completedScan?.completed_at ?? null,
      };

      void fireCallback(callback_url, payload);
    });

    res.status(202).json({
      scan_id: scan.id,
      status: "pending",
      message: callback_url
        ? "Scan queued. Results will be POSTed to callback_url on completion."
        : "Scan queued. Poll GET /api/scans/:id for status.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    res.status(500).json({ error: message });
  }
});

// GET /:id — Check scan status (convenience for polling)
router.get("/:id", (req: Request<{ id: string }>, res: Response): void => {
  const { id } = req.params;

  try {
    const scan = scans.get(id);
    if (!scan) {
      res.status(404).json({ error: "Scan not found" });
      return;
    }

    const scanFindings = findings.list(id);
    const activeFindings = scanFindings.filter((f) => f.status !== "dismissed" && f.status !== "accepted_risk");
    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of activeFindings) {
      if (f.severity in counts) {
        counts[f.severity as keyof typeof counts] += 1;
      }
    }

    const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
    const minSev = settings.get("min_severity") ?? "low";
    const minRank = SEV_RANK[minSev] ?? 1;
    const pass = scan.status === "complete"
      ? !activeFindings.some((f) => (SEV_RANK[f.severity] ?? 0) >= minRank)
      : null;

    res.json({
      scan_id: scan.id,
      url: scan.url,
      status: scan.status,
      pass,
      risk_score: scan.risk_score,
      summary: {
        total: scanFindings.length,
        ...counts,
        exploited: scanFindings.filter((f) => f.exploited).length,
      },
      started_at: scan.started_at,
      completed_at: scan.completed_at,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    res.status(500).json({ error: message });
  }
});

export default router;
