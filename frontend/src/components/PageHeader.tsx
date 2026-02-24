import { useState, useCallback } from "react";
import { getFindings } from "../lib/api";
import type { ScanDiff } from "../lib/api";
import type { Scan, Finding, SeverityCounts } from "../types/index";

const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

interface PageHeaderProps {
  scan: Scan;
  findings: Finding[];
  severityCounts: SeverityCounts;
  exploitedCount: number;
  totalFindings: number;
  diff?: ScanDiff | null;
  onRescan?: () => void;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function statusPillClass(status: Scan["status"]): string {
  switch (status) {
    case "complete": return "eyebrow-pill ep-ok";
    case "running": return "eyebrow-pill ep-running";
    case "failed": return "eyebrow-pill ep-crit";
    default: return "eyebrow-pill ep-neutral";
  }
}

function statusTooltip(status: Scan["status"]): string {
  switch (status) {
    case "complete": return "Scan finished successfully";
    case "running": return "Scan is currently in progress";
    case "failed": return "Scan encountered an error";
    case "pending": return "Scan is queued to run";
    default: return "";
  }
}

function riskScoreColor(score: number | null): string {
  if (score === null) return "var(--text-3)";
  if (score >= 8) return "var(--crit)";
  if (score >= 6) return "var(--high)";
  if (score >= 4) return "var(--med)";
  return "var(--ok)";
}

function DownloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 10h9M6.5 2v6M4 6l2.5 2.5L9 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 7A5 5 0 1 0 3.5 3.5" strokeLinecap="round" />
      <path d="M2 3.5V7H5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="10" cy="2.5" r="1.5" />
      <circle cx="10" cy="10.5" r="1.5" />
      <circle cx="3" cy="6.5" r="1.5" />
      <line x1="4.5" y1="5.8" x2="8.5" y2="3.2" />
      <line x1="4.5" y1="7.2" x2="8.5" y2="9.8" />
    </svg>
  );
}

export function PageHeader({ scan, findings, severityCounts, exploitedCount, totalFindings, diff, onRescan }: PageHeaderProps) {
  const [shareLabel, setShareLabel] = useState("Share");

  const displayUrl = (() => {
    try {
      return new URL(scan.url).hostname;
    } catch {
      return scan.url;
    }
  })();

  const handleExport = useCallback(async () => {
    try {
      const findings = await getFindings({ scan_id: scan.id });
      const report = {
        exported_at: new Date().toISOString(),
        scan: {
          id: scan.id,
          url: scan.url,
          scan_type: scan.scan_type,
          status: scan.status,
          risk_score: scan.risk_score,
          started_at: scan.started_at,
          completed_at: scan.completed_at,
        },
        summary: { total: findings.length, ...severityCounts, exploited: exploitedCount },
        findings,
      };
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `magnus-report-${displayUrl}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silently fail
    }
  }, [scan, severityCounts, exploitedCount, displayUrl]);

  const handleExportPdf = useCallback(async () => {
    try {
      const findings = await getFindings({ scan_id: scan.id });
      const { downloadPdfReport } = await import("../lib/pdf-report");
      downloadPdfReport(scan, findings, severityCounts);
    } catch {
      // silently fail
    }
  }, [scan, severityCounts]);

  const handleShare = useCallback(() => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setShareLabel("Copied!");
      setTimeout(() => setShareLabel("Share"), 2000);
    }).catch(() => {});
  }, []);

  return (
    <div className="page-header">
      <div className="page-eyebrow">
        <span>{displayUrl}</span>
        <span>·</span>
        <span className={statusPillClass(scan.status)} data-tooltip={statusTooltip(scan.status)}>
          {scan.status}
        </span>
        <span className="eyebrow-pill ep-neutral" data-tooltip={scan.scan_type === "whitebox" ? "Full access — source code and runtime analysis" : "External reconnaissance only — no source code access"}>
          {scan.scan_type}
        </span>
        {!!scan.metadata?.auth_headers && Object.keys(scan.metadata.auth_headers as Record<string, unknown>).length > 0 && (
          <span className="eyebrow-pill ep-auth" data-tooltip="Scanned with auth headers — findings reflect logged-in attacker access">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3">
              <rect x="2" y="5" width="6" height="4" rx="0.8" />
              <path d="M3.5 5V3.5a1.5 1.5 0 0 1 3 0V5" strokeLinecap="round" />
            </svg>
            authenticated
          </span>
        )}
        <span>·</span>
        <span>{formatDate(scan.started_at ?? scan.created_at)}</span>
      </div>

      <h1 className="page-title">
        {totalFindings} {totalFindings === 1 ? "vulnerability" : "vulnerabilities"} found across {displayUrl}
      </h1>

      <p className="page-sub">
        Automated security scan completed by {scan.model} ·{" "}
        {scan.scan_type === "whitebox" ? "White-box" : "Black-box"} assessment
      </p>

      {diff && diff.previous_scan_id && (() => {
        const minRank = SEV_RANK[diff.min_severity] ?? 1;
        const findingMap = new Map(findings.map((f) => [f.id, f]));
        const aboveThreshold = (id: string) => {
          const f = findingMap.get(id);
          return f ? (SEV_RANK[f.severity] ?? 0) >= minRank : true;
        };
        const newAbove = diff.new_ids.filter(aboveThreshold).length;
        const newBelow = diff.new_ids.length - newAbove;
        const fixedAbove = diff.fixed.filter((f) => (SEV_RANK[f.severity] ?? 0) >= minRank).length;

        return (
          <div className="diff-badge">
            <span className="diff-new">
              {newAbove} new{newBelow > 0 && <span className="diff-below"> ({newBelow} below threshold)</span>}
            </span>
            <span className="diff-sep">&middot;</span>
            <span className="diff-fixed">{fixedAbove} fixed</span>
            <span className="diff-sep">&middot;</span>
            <span className="diff-unchanged">{diff.unchanged_ids.length} unchanged</span>
          </div>
        );
      })()}

      <div className="stat-bento">
        <div className="stat-cell">
          <div className="stat-label">Critical</div>
          <div className="stat-num c">{severityCounts.critical}</div>
          <div className="stat-sub">findings</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">High</div>
          <div className="stat-num h">{severityCounts.high}</div>
          <div className="stat-sub">findings</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Medium</div>
          <div className="stat-num m">{severityCounts.medium}</div>
          <div className="stat-sub">findings</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Low</div>
          <div className="stat-num l">{severityCounts.low}</div>
          <div className="stat-sub">findings</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Exploited</div>
          <div className="stat-num c">{exploitedCount}</div>
          <div className="stat-sub">confirmed</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Risk Score</div>
          <div
            className="stat-num"
            style={{ color: riskScoreColor(scan.risk_score) }}
          >
            {scan.risk_score !== null ? scan.risk_score.toFixed(1) : "—"}
          </div>
          <div className="stat-sub">out of 10</div>
        </div>
      </div>

      <div className="header-actions">
        <button className="btn btn-ghost" onClick={handleExport}>
          <DownloadIcon />
          Export JSON
        </button>
        <button className="btn btn-ghost" onClick={handleExportPdf}>
          <DownloadIcon />
          Export PDF
        </button>
        <button className="btn btn-ghost" onClick={handleShare}>
          <ShareIcon />
          {shareLabel}
        </button>
        <button className="btn btn-primary" onClick={onRescan}>
          <RefreshIcon />
          Re-scan
        </button>
      </div>
    </div>
  );
}
