import { Router } from "express";
import type { Request, Response } from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../../../");
const EVIDENCE_DIR = path.join(PROJECT_ROOT, "data", "evidence");

const router = Router();

router.get(
  "/:scanId/:findingId/:filename",
  (req: Request<{ scanId: string; findingId: string; filename: string }>, res: Response): void => {
    const { scanId, findingId, filename } = req.params;

    // Prevent directory traversal
    if (
      scanId.includes("..") || findingId.includes("..") || filename.includes("..") ||
      scanId.includes("/") || findingId.includes("/") || filename.includes("/")
    ) {
      res.status(400).json({ error: "Invalid path" });
      return;
    }

    const filePath = path.join(EVIDENCE_DIR, scanId, filename);

    if (!existsSync(filePath)) {
      res.status(404).json({ error: "Evidence not found" });
      return;
    }

    res.sendFile(filePath);
  }
);

export default router;
