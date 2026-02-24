import { Router } from "express";
import type { Request, Response } from "express";
import { agentLog, scans } from "../lib/db.js";

const router = Router();

const POLL_INTERVAL_MS = 1000;
const REPLAY_COUNT = 20;

// GET /:scanId — SSE stream for a scan
router.get(
  "/:scanId",
  (req: Request<{ scanId: string }>, res: Response): void => {
    const { scanId } = req.params;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    res.write(
      `data: ${JSON.stringify({ type: "connected", scan_id: scanId })}\n\n`
    );

    // Replay the last 20 log entries on connect
    const replayEntries = agentLog.getLastN(scanId, REPLAY_COUNT);
    for (const entry of replayEntries) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }

    let lastTimestamp: string | undefined =
      replayEntries.length > 0
        ? replayEntries[replayEntries.length - 1].timestamp
        : undefined;

    let closed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    req.on("close", () => {
      closed = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
    });

    function poll(): void {
      if (closed) return;

      try {
        const newEntries = agentLog.getByScan(scanId, lastTimestamp);

        for (const entry of newEntries) {
          if (!closed) {
            res.write(`data: ${JSON.stringify(entry)}\n\n`);
          }
        }

        if (newEntries.length > 0) {
          lastTimestamp = newEntries[newEntries.length - 1].timestamp;
        }

        const scan = scans.get(scanId);

        if (scan) {
          if (scan.status === "complete") {
            if (!closed) {
              res.write(
                `data: ${JSON.stringify({ type: "scan_complete", data: { scan_id: scanId } })}\n\n`
              );
              res.end();
            }
            return;
          }

          if (scan.status === "failed") {
            if (!closed) {
              res.write(
                `data: ${JSON.stringify({ type: "scan_error", data: { scan_id: scanId } })}\n\n`
              );
              res.end();
            }
            return;
          }
        }
      } catch {
        // Errors don't kill the stream — keep polling
      }

      if (!closed) {
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    timer = setTimeout(poll, POLL_INTERVAL_MS);
  }
);

export default router;
