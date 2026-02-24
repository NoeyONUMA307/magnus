import { useEffect, useState } from "react";
import { getScans } from "../lib/api";
import type { Scan } from "../types/index";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function statusPill(status: Scan["status"]): JSX.Element {
  const classMap: Record<Scan["status"], string> = {
    complete: "eyebrow-pill ep-ok",
    running: "eyebrow-pill ep-running",
    failed: "eyebrow-pill ep-crit",
    pending: "eyebrow-pill ep-neutral",
  };
  return <span className={classMap[status]}>{status}</span>;
}

function scoreColor(score: number | null): string {
  if (score === null) return "var(--text-3)";
  if (score >= 8) return "var(--crit)";
  if (score >= 6) return "var(--high)";
  if (score >= 4) return "var(--med)";
  return "var(--ok)";
}

interface HistoryProps {
  onSelectScan?: (scanId: string) => void;
}

export function History({ onSelectScan }: HistoryProps) {
  const [scans, setScans] = useState<Scan[]>([]);
  useEffect(() => {
    getScans().then(setScans).catch(() => {});
  }, []);

  if (scans.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">No scan history</div>
        <div className="empty-state-sub">
          Completed scans will appear here. Start a new scan to begin.
        </div>
      </div>
    );
  }

  return (
    <div className="content">
      <div className="findings-card">
        <div className="findings-head">
          <span className="findings-title">Scan History</span>
          <span style={{ marginLeft: "auto", fontSize: "12px", fontFamily: "'Geist Mono', monospace", color: "var(--text-3)" }}>
            {scans.length} {scans.length === 1 ? "scan" : "scans"}
          </span>
        </div>

        <div
          className="findings-cols"
          style={{ gridTemplateColumns: "1fr 120px 110px 70px 120px" }}
        >
          <span>Target</span>
          <span>Type</span>
          <span>Status</span>
          <span>Score</span>
          <span>Started</span>
        </div>

        {scans.map((scan) => (
          <div
            key={scan.id}
            className="fr"
            style={{ gridTemplateColumns: "1fr 120px 110px 70px 120px", cursor: "pointer" }}
            onClick={() => onSelectScan?.(scan.id)}
          >
            <div>
              <div className="fr-name" style={{ fontFamily: "'Geist Mono', monospace", fontSize: "12px" }}>
                {scan.url}
              </div>
              <div className="fr-path">{scan.id}</div>
            </div>
            <div style={{ fontSize: "12px", fontFamily: "'Geist Mono', monospace", color: "var(--text-2)" }}>
              {scan.scan_type}
            </div>
            <div>{statusPill(scan.status)}</div>
            <div>
              <span
                className="cvss"
                style={{ color: scoreColor(scan.risk_score) }}
              >
                {scan.risk_score !== null ? scan.risk_score.toFixed(1) : "—"}
              </span>
            </div>
            <div style={{ fontSize: "11px", fontFamily: "'Geist Mono', monospace", color: "var(--text-3)" }}>
              {formatDate(scan.started_at ?? scan.created_at)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
