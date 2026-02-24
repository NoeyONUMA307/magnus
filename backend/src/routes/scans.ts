import { Router } from "express";
import type { Request, Response } from "express";
import { scans, findings, settings } from "../lib/db.js";
import { runScan } from "../agent/magnus.js";
import { getActiveModel } from "../lib/llm.js";
import type { CreateScanRequest, ScanType, Finding } from "../types/index.js";

const DISMISSED_STATUSES = new Set(["dismissed", "accepted_risk"]);

const router = Router();

const VALID_SCAN_TYPES = new Set<string>(["whitebox", "blackbox"]);

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

// POST / — Create a new scan
router.post("/", (req: Request, res: Response): void => {
  const body = req.body as Partial<CreateScanRequest> & { openapi_spec?: unknown; write_probes_enabled?: boolean };
  const { url, scan_type, auth_headers, openapi_spec, write_probes_enabled } = body;

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url is required and must be a string" });
    return;
  }

  if (!scan_type || !VALID_SCAN_TYPES.has(scan_type)) {
    res
      .status(400)
      .json({ error: "scan_type must be 'whitebox' or 'blackbox'" });
    return;
  }

  // Validate auth_headers is a plain string→string object if provided
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
    const normalized = normalizeUrl(url);
    const scan = scans.create({ url: normalized, scan_type, model: getActiveModel(), metadata });

    // Kick off the agent in the background without awaiting
    void runScan(scan.id, normalized, scan_type as ScanType);

    res.status(201).json(scan);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    res.status(500).json({ error: message });
  }
});

// GET / — List all scans
router.get("/", (_req: Request, res: Response): void => {
  try {
    res.json(scans.list());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    res.status(500).json({ error: message });
  }
});

// GET /:id/diff — Compute finding diff against previous scan of same URL
router.get("/:id/diff", (req: Request<{ id: string }>, res: Response): void => {
  const { id } = req.params;

  try {
    const currentScan = scans.get(id);
    if (!currentScan) {
      res.status(404).json({ error: "Scan not found" });
      return;
    }

    const allCurrentFindings = findings.list(id);
    const currentFindings = allCurrentFindings.filter(
      (f) => !DISMISSED_STATUSES.has(f.status)
    );
    const isWhitebox = currentScan.scan_type === "whitebox";

    function normalizeEndpoint(ep: string | null): string {
      if (!ep) return "";
      try { return new URL(ep, "http://x").pathname; } catch { return ep.split("?")[0]; }
    }

    function fingerprint(f: Finding): string {
      const ep = isWhitebox ? (f.file_path ?? "") : normalizeEndpoint(f.endpoint);
      return `${f.severity}||${ep}||${f.cwe ?? ""}`;
    }

    const previousScan = scans.previousCompleted(currentScan.url, id);

    const minSeverity = settings.get("min_severity") ?? "low";

    if (!previousScan) {
      res.json({
        previous_scan_id: null,
        new_ids: currentFindings.map((f) => f.id),
        unchanged_ids: [],
        fixed: [],
        min_severity: minSeverity,
      });
      return;
    }

    const previousFindings = findings.list(previousScan.id).filter(
      (f) => !DISMISSED_STATUSES.has(f.status)
    );

    const prevFingerprints = new Map<string, Finding>();
    for (const f of previousFindings) {
      prevFingerprints.set(fingerprint(f), f);
    }

    const currentFingerprints = new Set<string>();
    for (const f of currentFindings) {
      currentFingerprints.add(fingerprint(f));
    }

    const newIds: string[] = [];
    const unchangedIds: string[] = [];

    for (const f of currentFindings) {
      if (prevFingerprints.has(fingerprint(f))) {
        unchangedIds.push(f.id);
      } else {
        newIds.push(f.id);
      }
    }

    const fixed: Finding[] = [];
    for (const [fp, f] of prevFingerprints) {
      if (!currentFingerprints.has(fp)) {
        fixed.push(f);
      }
    }

    res.json({
      previous_scan_id: previousScan.id,
      new_ids: newIds,
      unchanged_ids: unchangedIds,
      fixed,
      min_severity: minSeverity,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    res.status(500).json({ error: message });
  }
});

// GET /:id — Get a single scan with severity counts
router.get(
  "/:id",
  (req: Request<{ id: string }>, res: Response): void => {
    const { id } = req.params;

    try {
      const scan = scans.get(id);

      if (!scan) {
        res.status(404).json({ error: "Scan not found" });
        return;
      }

      const scanFindings = findings.list(id);
      const activeFindings = scanFindings.filter(
        (f) => !DISMISSED_STATUSES.has(f.status)
      );
      const severity_counts = activeFindings.reduce<Record<string, number>>(
        (acc, f) => {
          acc[f.severity] = (acc[f.severity] ?? 0) + 1;
          return acc;
        },
        {}
      );

      res.json({ ...scan, severity_counts });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      res.status(500).json({ error: message });
    }
  }
);

export default router;
