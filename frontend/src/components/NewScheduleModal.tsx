import { useCallback, useEffect, useState } from "react";
import { createScheduledScan, updateScheduledScan } from "../lib/api";
import type { ScheduledScan, ScheduleInterval } from "../types/index";

interface NewScheduleModalProps {
  open: boolean;
  editing?: ScheduledScan | null;
  onClose: () => void;
  onCreated: () => void;
}

const SCHEDULES: { value: ScheduleInterval; label: string }[] = [
  { value: "6h", label: "Every 6 hours" },
  { value: "12h", label: "Every 12 hours" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
];

function authHeadersToRaw(headers: Record<string, string>): string {
  return Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\n");
}

export function NewScheduleModal({ open, editing, onClose, onCreated }: NewScheduleModalProps) {
  const [url, setUrl] = useState("");
  const [scanType, setScanType] = useState<"blackbox" | "whitebox">("blackbox");
  const [schedule, setSchedule] = useState<ScheduleInterval>("daily");
  const [authRaw, setAuthRaw] = useState("");
  const [showAuth, setShowAuth] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Sync fields when editing changes
  useEffect(() => {
    if (editing) {
      setUrl(editing.url);
      setScanType(editing.scan_type);
      setSchedule(editing.schedule);
      const raw = authHeadersToRaw(editing.auth_headers);
      setAuthRaw(raw);
      setShowAuth(raw.length > 0);
    } else {
      setUrl("");
      setScanType("blackbox");
      setSchedule("daily");
      setAuthRaw("");
      setShowAuth(false);
    }
    setError("");
  }, [editing]);

  const isEditing = !!editing;

  const handleSubmit = useCallback(async () => {
    setError("");

    const trimmed = url.trim();
    if (!trimmed) { setError("URL is required"); return; }

    let auth_headers: Record<string, string> | undefined;
    if (authRaw.trim()) {
      auth_headers = {};
      let lastKey = "";
      for (const line of authRaw.split("\n")) {
        const trimmed2 = line.trim();
        if (!trimmed2) continue;
        const idx = trimmed2.indexOf(":");
        if (idx === -1) {
          if (lastKey) auth_headers[lastKey] += trimmed2;
          continue;
        }
        const key = trimmed2.slice(0, idx).trim();
        if (key) {
          auth_headers[key] = trimmed2.slice(idx + 1).trim();
          lastKey = key;
        }
      }
      if (Object.keys(auth_headers).length === 0) auth_headers = undefined;
    }

    setSaving(true);
    try {
      if (isEditing) {
        await updateScheduledScan(editing.id, { url: trimmed, scan_type: scanType, schedule, auth_headers: auth_headers ?? {} });
      } else {
        await createScheduledScan({ url: trimmed, scan_type: scanType, schedule, auth_headers });
      }
      setUrl("");
      setAuthRaw("");
      setShowAuth(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : isEditing ? "Failed to update schedule" : "Failed to create schedule");
    } finally {
      setSaving(false);
    }
  }, [url, scanType, schedule, authRaw, isEditing, editing, onCreated]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="3" x2="11" y2="11" strokeLinecap="round" />
            <line x1="11" y1="3" x2="3" y2="11" strokeLinecap="round" />
          </svg>
        </button>

        <h2 className="modal-title">{isEditing ? "Edit Schedule" : "New Scheduled Scan"}</h2>
        <p className="modal-sub">{isEditing ? "Update target, frequency, or authentication." : "Set up a recurring scan against a target."}</p>

        {error && <div className="modal-error">{error}</div>}

        <div className="modal-field">
          <label>Target URL</label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
          />
        </div>

        <div className="modal-field">
          <label>Scan Type</label>
          <div className="modal-radio-group">
            <label
              className={`modal-radio${scanType === "blackbox" ? " selected" : ""}`}
              onClick={() => setScanType("blackbox")}
            >
              <input type="radio" name="scan-type" value="blackbox" checked={scanType === "blackbox"} readOnly />
              <span className="radio-label">Black-box</span>
              <span className="radio-desc">External only, no source access</span>
            </label>
            <label
              className={`modal-radio${scanType === "whitebox" ? " selected" : ""}`}
              onClick={() => setScanType("whitebox")}
            >
              <input type="radio" name="scan-type" value="whitebox" checked={scanType === "whitebox"} readOnly />
              <span className="radio-label">White-box</span>
              <span className="radio-desc">Full access, source + runtime</span>
            </label>
          </div>
        </div>

        <div className="modal-field">
          <label>Frequency</label>
          <div className="schedule-picker">
            {SCHEDULES.map((s) => (
              <button
                key={s.value}
                type="button"
                className={`schedule-pick-btn${schedule === s.value ? " selected" : ""}`}
                onClick={() => setSchedule(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-field">
          <button type="button" className="auth-toggle" onClick={() => setShowAuth(!showAuth)}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ transform: showAuth ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
              <path d="M4 2L8 6L4 10" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Authentication
            {authRaw.trim() && <span className="auth-active-dot" />}
          </button>
          {showAuth && (
            <div className="auth-section">
              <textarea
                value={authRaw}
                onChange={(e) => setAuthRaw(e.target.value)}
                placeholder={"Cookie: session=abc123\nAuthorization: Bearer eyJ..."}
                rows={3}
                className="auth-textarea"
              />
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={saving}
          >
            {saving ? "Saving..." : isEditing ? "Save Changes" : "Create Schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}
