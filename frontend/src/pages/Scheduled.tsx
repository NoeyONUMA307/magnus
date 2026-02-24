import { useCallback, useEffect, useState } from "react";
import { getScheduledScans, updateScheduledScan, deleteScheduledScan } from "../lib/api";
import { NewScheduleModal } from "../components/NewScheduleModal";
import type { ScheduledScan } from "../types/index";

const SCHEDULE_LABELS: Record<string, string> = {
  "6h": "Every 6h",
  "12h": "Every 12h",
  daily: "Daily",
  weekly: "Weekly",
};

function formatUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname !== "/" ? u.pathname : "");
  } catch {
    return url;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function timeUntil(iso: string, _tick: number): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "due now";
  const totalSecs = Math.floor(diff / 1000);
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `in ${days}d ${hours % 24}h ${mins}m`;
  }
  if (hours > 0) return `in ${hours}h ${mins}m ${secs}s`;
  if (mins > 0) return `in ${mins}m ${secs}s`;
  return `in ${secs}s`;
}

export function Scheduled() {
  const [schedules, setSchedules] = useState<ScheduledScan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScheduledScan | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    getScheduledScans()
      .then(setSchedules)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Live countdown — tick every second
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    try {
      await updateScheduledScan(id, { enabled });
      refresh();
    } catch { /* ignore */ }
  }, [refresh]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteScheduledScan(id);
      refresh();
    } catch { /* ignore */ }
  }, [refresh]);

  return (
    <div className="page-scheduled">
      <div className="scheduled-header">
        <div>
          <h2 className="scheduled-title">Scheduled Scans</h2>
          <p className="scheduled-sub">Automated recurring scans against your targets.</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditingSchedule(null); setShowModal(true); }}>
          New Schedule
        </button>
      </div>

      {loading ? (
        <div className="scheduled-empty">Loading...</div>
      ) : schedules.length === 0 ? (
        <div className="scheduled-empty">
          <div className="scheduled-empty-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6V12L16 14" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p>No scheduled scans yet.</p>
          <p className="scheduled-empty-hint">Set one up to monitor your targets continuously.</p>
        </div>
      ) : (
        <div className="schedule-list">
          <div className="schedule-list-header">
            <span className="slh-target">Target</span>
            <span className="slh-schedule">Schedule</span>
            <span className="slh-next">Next Run</span>
            <span className="slh-last">Last Run</span>
            <span className="slh-actions" />
          </div>
          {schedules.map((s) => (
            <div key={s.id} className={`schedule-row${s.enabled ? "" : " disabled"}`}>
              <div className="sr-target">
                <span className="sr-url">{formatUrl(s.url)}</span>
                <span className="sr-type">{s.scan_type}</span>
              </div>
              <div className="sr-schedule">
                <span className="schedule-pill">{SCHEDULE_LABELS[s.schedule] ?? s.schedule}</span>
              </div>
              <div className="sr-next">
                {s.enabled ? timeUntil(s.next_run_at, tick) : "paused"}
              </div>
              <div className="sr-last">
                {formatDate(s.last_run_at)}
              </div>
              <div className="sr-actions">
                <button
                  className="icon-btn"
                  title="Edit"
                  onClick={() => { setEditingSchedule(s); setShowModal(true); }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
                    <path d="M8.5 2.5l3 3M2 9l6.5-6.5 3 3L5 12H2V9z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  className={`toggle-btn${s.enabled ? " on" : ""}`}
                  title={s.enabled ? "Pause" : "Enable"}
                  onClick={() => handleToggle(s.id, !s.enabled)}
                >
                  <span className="toggle-track">
                    <span className="toggle-thumb" />
                  </span>
                </button>
                <button
                  className="icon-btn delete-btn"
                  title="Delete"
                  onClick={() => handleDelete(s.id)}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
                    <path d="M2.5 4h9M5 4V2.5h4V4M3.5 4v7.5a1 1 0 001 1h5a1 1 0 001-1V4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <NewScheduleModal
        open={showModal}
        editing={editingSchedule}
        onClose={() => { setShowModal(false); setEditingSchedule(null); }}
        onCreated={() => { setShowModal(false); setEditingSchedule(null); refresh(); }}
      />
    </div>
  );
}
