import { Router } from "express";
import type { Request, Response } from "express";
import { scheduledScans } from "../lib/db.js";
import type { ScheduleInterval, ScanType } from "../types/index.js";

const router = Router();

const VALID_SCAN_TYPES = new Set(["whitebox", "blackbox"]);
const VALID_SCHEDULES = new Set<string>(["6h", "12h", "daily", "weekly"]);

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

// GET / — List all scheduled scans
router.get("/", (_req: Request, res: Response): void => {
  try {
    res.json(scheduledScans.list());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    res.status(500).json({ error: message });
  }
});

// POST / — Create a scheduled scan
router.post("/", (req: Request, res: Response): void => {
  const { url, scan_type, schedule, auth_headers } = req.body as {
    url?: string;
    scan_type?: string;
    schedule?: string;
    auth_headers?: Record<string, string>;
  };

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url is required and must be a string" });
    return;
  }
  if (!scan_type || !VALID_SCAN_TYPES.has(scan_type)) {
    res.status(400).json({ error: "scan_type must be 'whitebox' or 'blackbox'" });
    return;
  }
  if (!schedule || !VALID_SCHEDULES.has(schedule)) {
    res.status(400).json({ error: "schedule must be '6h', '12h', 'daily', or 'weekly'" });
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

  try {
    const created = scheduledScans.create({
      url: normalizeUrl(url),
      scan_type,
      schedule: schedule as ScheduleInterval,
      auth_headers,
    });
    res.status(201).json(created);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    res.status(500).json({ error: message });
  }
});

// PATCH /:id — Update a scheduled scan
router.patch("/:id", (req: Request<{ id: string }>, res: Response): void => {
  const { id } = req.params;
  const { url, scan_type, enabled, schedule, auth_headers } = req.body as {
    url?: string;
    scan_type?: string;
    enabled?: boolean;
    schedule?: string;
    auth_headers?: Record<string, string>;
  };

  const existing = scheduledScans.get(id);
  if (!existing) {
    res.status(404).json({ error: "Scheduled scan not found" });
    return;
  }

  if (url !== undefined && (typeof url !== "string" || !url.trim())) {
    res.status(400).json({ error: "url must be a non-empty string" });
    return;
  }

  if (scan_type !== undefined && !VALID_SCAN_TYPES.has(scan_type)) {
    res.status(400).json({ error: "scan_type must be 'whitebox' or 'blackbox'" });
    return;
  }

  if (schedule !== undefined && !VALID_SCHEDULES.has(schedule)) {
    res.status(400).json({ error: "schedule must be '6h', '12h', 'daily', or 'weekly'" });
    return;
  }

  if (auth_headers !== undefined) {
    if (typeof auth_headers !== "object" || auth_headers === null || Array.isArray(auth_headers)) {
      res.status(400).json({ error: "auth_headers must be an object of string key-value pairs" });
      return;
    }
  }

  try {
    scheduledScans.update(id, {
      url: url ? normalizeUrl(url) : undefined,
      scan_type: scan_type as ScanType | undefined,
      enabled,
      schedule: schedule as ScheduleInterval | undefined,
      auth_headers,
    });
    res.json(scheduledScans.get(id));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    res.status(500).json({ error: message });
  }
});

// DELETE /:id — Remove a scheduled scan
router.delete("/:id", (req: Request<{ id: string }>, res: Response): void => {
  const { id } = req.params;

  const existing = scheduledScans.get(id);
  if (!existing) {
    res.status(404).json({ error: "Scheduled scan not found" });
    return;
  }

  try {
    scheduledScans.remove(id);
    res.status(204).end();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    res.status(500).json({ error: message });
  }
});

export default router;
