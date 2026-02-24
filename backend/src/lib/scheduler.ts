import { scans, scheduledScans } from "./db.js";
import { runScan } from "../agent/magnus.js";
import { getActiveModel } from "./llm.js";
import type { ScanType } from "../types/index.js";

const TICK_INTERVAL = 60_000; // 60 seconds

export function initScheduler(): void {
  console.log("[scheduler] Started — checking for due scans every 60s");

  setInterval(() => {
    try {
      const due = scheduledScans.getDue();
      if (due.length === 0) return;

      for (const schedule of due) {
        console.log(`[scheduler] Triggering scheduled scan: ${schedule.url} (${schedule.schedule})`);

        const metadata: Record<string, unknown> = {
          scheduled_scan_id: schedule.id,
        };
        if (Object.keys(schedule.auth_headers).length > 0) {
          metadata.auth_headers = schedule.auth_headers;
        }

        const scan = scans.create({
          url: schedule.url,
          scan_type: schedule.scan_type,
          model: getActiveModel(),
          metadata,
        });

        void runScan(scan.id, schedule.url, schedule.scan_type as ScanType);
        scheduledScans.markRun(schedule.id, scan.id, schedule.schedule);

        console.log(`[scheduler] Created scan ${scan.id} for schedule ${schedule.id}`);
      }
    } catch (err) {
      console.error("[scheduler] Error during tick:", err);
    }
  }, TICK_INTERVAL);
}
