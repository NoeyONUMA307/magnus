import { useEffect, useRef } from "react";
import type { AgentLogEntry, AgentPhase } from "../types/index";

interface AttackStreamProps {
  scanId: string;
  events: AgentLogEntry[];
  phase: AgentPhase;
  progress: number;
  isLive: boolean;
  model?: string;
}

const PHASES: AgentPhase[] = ["recon", "planning", "exploitation", "browser-confirm", "reporting"];
const PHASE_LABELS: Record<AgentPhase, string> = {
  recon: "Recon",
  planning: "Planning",
  exploitation: "Exploit",
  "browser-confirm": "Confirm",
  reporting: "Report",
};

function phaseStatus(phase: AgentPhase, currentPhase: AgentPhase): "done" | "active" | "pending" {
  const currentIdx = PHASES.indexOf(currentPhase);
  const phaseIdx = PHASES.indexOf(phase);
  if (phaseIdx < currentIdx) return "done";
  if (phaseIdx === currentIdx) return "active";
  return "pending";
}

function slPhaseClass(phase: AgentPhase): string {
  switch (phase) {
    case "recon": return "sl-phase recon";
    case "planning": return "sl-phase plan";
    case "exploitation": return "sl-phase exploit";
    case "browser-confirm": return "sl-phase confirm";
    case "reporting": return "sl-phase report";
  }
}

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return "--:--:--";
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function AttackStream({ events, phase, progress, isLive, model }: AttackStreamProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [events]);

  const findingCount = events.filter((e) => e.message?.startsWith("Finding saved:")).length;

  return (
    <div className="stream-card">
      <div className="stream-header">
        <span className="stream-label">Attack Stream</span>
        <span className="stream-model-pill">{model || "—"}</span>
        {isLive && (
          <span className="live-pill">
            <span className="live-dot" />
            live
          </span>
        )}
      </div>

      <div className="phase-bar">
        {PHASES.map((p, idx) => {
          const status = phaseStatus(p, phase);
          return (
            <div key={p} style={{ display: "flex", alignItems: "center", flex: 1 }}>
              <div className={`phase-step${status === "done" ? " done" : status === "active" ? " active" : ""}`}>
                <span className="phase-dot" />
                {PHASE_LABELS[p]}
              </div>
              {idx < PHASES.length - 1 && (
                <div className="phase-connector" />
              )}
            </div>
          );
        })}
      </div>

      <div className="stream-body" ref={bodyRef}>
        {events.length === 0 && (
          <div className="sl">
            <span className="sl-time">--:--</span>
            <span className="sl-msg" style={{ color: "var(--stream-dim)" }}>
              Waiting for agent output...
            </span>
          </div>
        )}
        {events
          .filter((e) => !e.metadata?.chunk)
          .map((event) => (
          <div key={event.id} className="sl">
            <span className="sl-time">{formatTime(event.timestamp)}</span>
            <span className={slPhaseClass(event.phase)}>{PHASE_LABELS[event.phase]}</span>
            <span className="sl-msg">{event.message}</span>
          </div>
        ))}
        {isLive && <span className="stream-cursor" />}
      </div>

      <div className="stream-footer">
        <div className="stream-stat">
          <span className="stream-stat-n">{events.length}</span>
          <span className="stream-stat-l">events</span>
        </div>
        <div className="stream-sep" />
        <div className="stream-stat">
          <span className="stream-stat-n">{findingCount}</span>
          <span className="stream-stat-l">findings</span>
        </div>
        <div className="stream-sep" />
        <div className="stream-stat">
          <span className="stream-stat-l">{PHASE_LABELS[phase]}</span>
        </div>
        <div className="progress-track">
          <div
            className="progress-fill"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
        <span className="progress-label">{Math.round(progress)}%</span>
      </div>
    </div>
  );
}
