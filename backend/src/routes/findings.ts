import { Router } from "express";
import type { Request, Response } from "express";
import { findings } from "../lib/db.js";
import type { FindingStatus } from "../types/index.js";

const router = Router();

const VALID_STATUSES = new Set<string>([
  "new",
  "confirmed",
  "in_progress",
  "fixed",
  "verified",
]);

// GET / — List all findings, optional ?scan_id filter
router.get("/", (req: Request, res: Response): void => {
  const { scan_id } = req.query;

  try {
    const scanId =
      typeof scan_id === "string" && scan_id.length > 0 ? scan_id : undefined;
    res.json(findings.list(scanId));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    res.status(500).json({ error: message });
  }
});

// GET /:id — Get a single finding
router.get(
  "/:id",
  (req: Request<{ id: string }>, res: Response): void => {
    const { id } = req.params;

    try {
      const finding = findings.get(id);

      if (!finding) {
        res.status(404).json({ error: "Finding not found" });
        return;
      }

      res.json(finding);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      res.status(500).json({ error: message });
    }
  }
);

// PATCH /:id — Update finding status
router.patch(
  "/:id",
  (req: Request<{ id: string }>, res: Response): void => {
    const { id } = req.params;
    const { status } = req.body as { status?: unknown };

    if (!status || typeof status !== "string" || !VALID_STATUSES.has(status)) {
      res.status(400).json({
        error: `status must be one of: ${[...VALID_STATUSES].join(", ")}`,
      });
      return;
    }

    try {
      const existing = findings.get(id);

      if (!existing) {
        res.status(404).json({ error: "Finding not found" });
        return;
      }

      findings.update(id, { status: status as FindingStatus });

      const updated = findings.get(id);
      res.json(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      res.status(500).json({ error: message });
    }
  }
);

export default router;
