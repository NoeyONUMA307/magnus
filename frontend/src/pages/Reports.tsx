import { useCallback, useEffect, useState } from "react";
import { getScans, getFindings, createSharedReport, getSharedReports, deleteSharedReport } from "../lib/api";
import type { SharedReport } from "../lib/api";
import { CopyButton } from "../components/CopyButton";
import type { Scan, Finding, SeverityCounts } from "../types/index";

function DownloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 10h9M6.5 2v6M4 6l2.5 2.5L9 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"
      style={{ transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
    >
      <path d="M3 1.5L7 5L3 8.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function scoreColor(score: number | null): string {
  if (score === null) return "var(--text-3)";
  if (score >= 8) return "var(--crit)";
  if (score >= 6) return "var(--high)";
  if (score >= 4) return "var(--med)";
  return "var(--ok)";
}

function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function sevColor(severity: string): string {
  switch (severity) {
    case "critical": return "var(--crit)";
    case "high": return "var(--high)";
    case "medium": return "var(--med)";
    case "low": return "var(--low)";
    default: return "var(--text-3)";
  }
}

function sevBg(severity: string): string {
  switch (severity) {
    case "critical": return "var(--crit-bg)";
    case "high": return "var(--high-bg)";
    case "medium": return "var(--med-bg)";
    case "low": return "var(--low-bg)";
    default: return "var(--surface-2)";
  }
}

function DocumentIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 6h16l8 8v22a2 2 0 01-2 2H8a2 2 0 01-2-2V8a2 2 0 012-2z" strokeLinejoin="round" />
      <path d="M24 6v8h8" strokeLinejoin="round" />
      <line x1="12" y1="22" x2="28" y2="22" strokeLinecap="round" />
      <line x1="12" y1="28" x2="22" y2="28" strokeLinecap="round" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="3" cy="6.5" r="1.5" />
      <circle cx="10" cy="3" r="1.5" />
      <circle cx="10" cy="10" r="1.5" />
      <path d="M4.5 5.8L8.5 3.7M4.5 7.2L8.5 9.3" strokeLinecap="round" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M5.5 7.5L7.5 5.5M4.2 8.8L3 10a1.5 1.5 0 002.1 0l1.5-1.5M7.4 5.6l1.5-1.5a1.5 1.5 0 000-2.1 1.5 1.5 0 00-2.1 0L5.3 3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function downloadReport(scan: Scan, findings: Finding[]) {
  const severityCounts = findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {});

  const report = {
    exported_at: new Date().toISOString(),
    scan: {
      id: scan.id, url: scan.url, scan_type: scan.scan_type,
      status: scan.status, risk_score: scan.risk_score,
      started_at: scan.started_at, completed_at: scan.completed_at,
    },
    executive_summary: (scan.metadata?.executive_summary as string) || null,
    attack_narrative: (scan.metadata?.attack_narrative as string) || null,
    summary: {
      total: findings.length,
      critical: severityCounts["critical"] ?? 0,
      high: severityCounts["high"] ?? 0,
      medium: severityCounts["medium"] ?? 0,
      low: severityCounts["low"] ?? 0,
      info: severityCounts["info"] ?? 0,
      exploited: findings.filter((f) => f.exploited).length,
    },
    findings,
  };

  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `magnus-report-${hostname(scan.url)}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

interface ReportCard {
  scan: Scan;
  findingCount: number;
  severityCounts: Record<string, number>;
}

interface ReportsProps {
  onSelectScan: (scanId: string) => void;
}

export function Reports({ onSelectScan }: ReportsProps) {
  const [reports, setReports] = useState<ReportCard[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedFindings, setExpandedFindings] = useState<Finding[]>([]);
  const [sharedReports, setSharedReports] = useState<SharedReport[]>([]);
  const [shareModalScanId, setShareModalScanId] = useState<string | null>(null);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [expiresIn, setExpiresIn] = useState<string>("never");
  const [shareLoading, setShareLoading] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  useEffect(() => {
    getSharedReports().then(setSharedReports).catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([getScans(), getFindings()]).then(([scans, findings]) => {
      const completed = scans.filter((s) => s.status === "complete");
      const cards = completed.map((scan): ReportCard => {
        const scanFindings = findings.filter((f) => f.scan_id === scan.id);
        const severityCounts = scanFindings.reduce<Record<string, number>>((acc, f) => {
          acc[f.severity] = (acc[f.severity] ?? 0) + 1;
          return acc;
        }, {});
        return { scan, findingCount: scanFindings.length, severityCounts };
      });
      setReports(cards);
    }).catch(() => {});
  }, []);

  const handleToggle = useCallback(async (scanId: string) => {
    if (expandedId === scanId) {
      setExpandedId(null);
      setExpandedFindings([]);
      return;
    }
    setExpandedId(scanId);
    try {
      const findings = await getFindings({ scan_id: scanId });
      // Sort by CVSS score descending so top findings show first
      findings.sort((a, b) => (b.cvss_score ?? 0) - (a.cvss_score ?? 0));
      setExpandedFindings(findings);
    } catch {
      setExpandedFindings([]);
    }
  }, [expandedId]);

  const handleDownload = useCallback(async (e: React.MouseEvent, scan: Scan) => {
    e.stopPropagation();
    try {
      const findings = await getFindings({ scan_id: scan.id });
      downloadReport(scan, findings);
    } catch { /* silently fail */ }
  }, []);

  const handlePdfDownload = useCallback(async (e: React.MouseEvent, scan: Scan) => {
    e.stopPropagation();
    try {
      const findings = await getFindings({ scan_id: scan.id });
      const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
      for (const f of findings) { counts[f.severity] += 1; }
      const { downloadPdfReport } = await import("../lib/pdf-report");
      downloadPdfReport(scan, findings, counts);
    } catch { /* silently fail */ }
  }, []);

  const openShareModal = useCallback(async (e: React.MouseEvent, scanId: string) => {
    e.stopPropagation();
    setShareModalScanId(scanId);
    setExcludedIds(new Set());
    setExpiresIn("never");
    setShareCopied(false);
    // Load findings for the checkboxes if not already expanded
    if (expandedId !== scanId) {
      try {
        const f = await getFindings({ scan_id: scanId });
        f.sort((a, b) => (b.cvss_score ?? 0) - (a.cvss_score ?? 0));
        setExpandedFindings(f);
      } catch { /* */ }
    }
  }, [expandedId]);

  const handleCreateShare = useCallback(async () => {
    if (!shareModalScanId) return;
    setShareLoading(true);
    try {
      const share = await createSharedReport({
        scan_id: shareModalScanId,
        excluded_ids: Array.from(excludedIds),
        expires_in: expiresIn,
      });
      setSharedReports((prev) => [...prev, share]);
    } catch { /* */ }
    setShareLoading(false);
  }, [shareModalScanId, excludedIds, expiresIn]);

  const handleRevokeShare = useCallback(async (shareId: string) => {
    try {
      await deleteSharedReport(shareId);
      setSharedReports((prev) => prev.filter((s) => s.id !== shareId));
    } catch { /* */ }
  }, []);

  const handleCopyShareUrl = useCallback((url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    }).catch(() => {});
  }, []);

  const toggleExcluded = useCallback((findingId: string) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(findingId)) next.delete(findingId);
      else next.add(findingId);
      return next;
    });
  }, []);

  const existingShare = shareModalScanId
    ? sharedReports.find((s) => s.scan_id === shareModalScanId)
    : null;

  if (reports.length === 0) {
    return (
      <div className="content">
        <div className="empty-state">
          <div style={{ color: "var(--text-4)", marginBottom: "var(--s-8)" }}>
            <DocumentIcon />
          </div>
          <div className="empty-state-title">No reports yet</div>
          <div className="empty-state-sub">
            Reports are generated after scan completion. Run a security scan to produce a downloadable report.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="content">
      <div className="findings-card">
        <div className="findings-head">
          <span className="findings-title">Reports</span>
          <span style={{ marginLeft: "auto", fontSize: "12px", fontFamily: "'Geist Mono', monospace", color: "var(--text-3)" }}>
            {reports.length} {reports.length === 1 ? "report" : "reports"}
          </span>
        </div>

        <div className="findings-cols report-cols">
          <span />
          <span>Target</span>
          <span className="report-col-hide">Score</span>
          <span className="report-col-hide">Crit</span>
          <span className="report-col-hide">High</span>
          <span className="report-col-hide">Med</span>
          <span>Findings</span>
          <span>Date</span>
        </div>

        {reports.map(({ scan, findingCount, severityCounts }) => {
          const isOpen = expandedId === scan.id;
          const topFindings = isOpen ? expandedFindings.slice(0, 5) : [];

          return (
            <div key={scan.id}>
              <div
                className={`fr report-cols${isOpen ? " open" : ""}`}
                style={{ cursor: "pointer" }}
                onClick={() => handleToggle(scan.id)}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)" }}>
                  <ChevronIcon open={isOpen} />
                </div>
                <div>
                  <div className="fr-name" style={{ fontFamily: "'Geist Mono', monospace", fontSize: "12px" }}>
                    {hostname(scan.url)}
                  </div>
                  <div className="fr-path">{scan.scan_type} · {scan.model}</div>
                </div>
                <div className="report-col-hide">
                  <span className="cvss" style={{ color: scoreColor(scan.risk_score) }}>
                    {scan.risk_score !== null ? scan.risk_score.toFixed(1) : "—"}
                  </span>
                </div>
                <div className="report-col-hide" style={{ fontFamily: "'Geist Mono', monospace", fontSize: "12px", color: severityCounts["critical"] ? "var(--crit)" : "var(--text-3)" }}>
                  {severityCounts["critical"] ?? 0}
                </div>
                <div className="report-col-hide" style={{ fontFamily: "'Geist Mono', monospace", fontSize: "12px", color: severityCounts["high"] ? "var(--high)" : "var(--text-3)" }}>
                  {severityCounts["high"] ?? 0}
                </div>
                <div className="report-col-hide" style={{ fontFamily: "'Geist Mono', monospace", fontSize: "12px", color: severityCounts["medium"] ? "var(--med)" : "var(--text-3)" }}>
                  {severityCounts["medium"] ?? 0}
                </div>
                <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: "12px", color: "var(--text-2)" }}>
                  {findingCount}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "11px", fontFamily: "'Geist Mono', monospace", color: "var(--text-3)" }}>
                    {formatDate(scan.completed_at ?? scan.created_at)}
                  </span>
                  <button
                    className="icon-btn"
                    style={{ width: "24px", height: "24px" }}
                    title="Download report"
                    onClick={(e) => handleDownload(e, scan)}
                  >
                    <DownloadIcon />
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="report-detail">
                  <div className="report-detail-inner">
                    <div className="report-detail-header">
                      <span className="fd-label" style={{ margin: 0 }}>{hostname(scan.url)}</span>
                      <div style={{ display: "flex", gap: "var(--s-8)" }}>
                        <button
                          className="btn btn-ghost"
                          onClick={(e) => handleDownload(e, scan)}
                        >
                          <DownloadIcon /> Export JSON
                        </button>
                        <button
                          className="btn btn-ghost"
                          onClick={(e) => handlePdfDownload(e, scan)}
                        >
                          <DownloadIcon /> Export PDF
                        </button>
                        <button
                          className="btn btn-ghost"
                          onClick={(e) => openShareModal(e, scan.id)}
                        >
                          {sharedReports.some((s) => s.scan_id === scan.id)
                            ? <><LinkIcon /> Shared</>
                            : <><ShareIcon /> Share</>
                          }
                        </button>
                        <button
                          className="btn btn-primary"
                          onClick={() => onSelectScan(scan.id)}
                        >
                          View Scan
                        </button>
                      </div>
                    </div>

                    {!!scan.metadata?.executive_summary && (
                      <div className="exec-summary-card" style={{ marginBottom: "var(--s-16)" }}>
                        <div className="exec-summary-header">
                          <div className="exec-summary-label">Executive Summary</div>
                          <CopyButton text={String(scan.metadata.executive_summary) + (scan.metadata?.attack_narrative ? "\n\n" + String(scan.metadata.attack_narrative) : "")} />
                        </div>
                        <div className="exec-summary-text">{String(scan.metadata.executive_summary)}</div>
                        {!!scan.metadata?.attack_narrative && (
                          <>
                            <div className="exec-summary-label" style={{ marginTop: 16 }}>Attack Narrative</div>
                            <div className="exec-summary-text">{String(scan.metadata.attack_narrative)}</div>
                          </>
                        )}
                      </div>
                    )}

                    <span className="fd-label" style={{ margin: "0 0 var(--s-8) 0", display: "block" }}>Top Findings</span>

                    {topFindings.length === 0 && (
                      <div style={{ padding: "var(--s-16) 0", fontSize: "12px", color: "var(--text-3)", fontFamily: "'Geist Mono', monospace" }}>
                        Loading findings...
                      </div>
                    )}

                    {topFindings.map((f) => (
                      <div key={f.id} className="report-finding-row">
                        <span
                          className="report-sev-dot"
                          style={{ background: sevColor(f.severity) }}
                          title={f.severity}
                        />
                        <span
                          className="report-sev-badge"
                          style={{ color: sevColor(f.severity), background: sevBg(f.severity) }}
                        >
                          {f.severity.slice(0, 4).toUpperCase()}
                        </span>
                        <span className="report-finding-title">{f.title}</span>
                        {f.cvss_score !== null && (
                          <span className="report-finding-cvss" style={{ color: scoreColor(f.cvss_score) }}>
                            {f.cvss_score.toFixed(1)}
                          </span>
                        )}
                        {f.exploited && (
                          <span className="report-exploited-badge">Exploited</span>
                        )}
                      </div>
                    ))}

                    {expandedFindings.length > 5 && (
                      <div style={{ padding: "var(--s-8) 0 0", fontSize: "11px", color: "var(--text-3)", fontFamily: "'Geist Mono', monospace" }}>
                        + {expandedFindings.length - 5} more findings
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {shareModalScanId && (
        <div className="modal-overlay" onClick={() => setShareModalScanId(null)}>
          <div className="modal-card share-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{existingShare ? "Shared Report" : "Share Report"}</h3>
              <button className="modal-close" onClick={() => setShareModalScanId(null)}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {existingShare ? (
              <div>
                <div className="modal-field">
                  <label>Public URL</label>
                  <div className="share-url-row">
                    <input
                      type="text"
                      readOnly
                      value={existingShare.url}
                      className="share-url-input"
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <button
                      className="btn btn-primary"
                      style={{ flexShrink: 0 }}
                      onClick={() => handleCopyShareUrl(existingShare.url)}
                    >
                      {shareCopied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
                <div className="share-meta">
                  <span>Created {formatDate(existingShare.created_at)}</span>
                  {existingShare.expires_at && (
                    <span>Expires {formatDate(existingShare.expires_at)}</span>
                  )}
                  {!existingShare.expires_at && <span>No expiration</span>}
                  {existingShare.excluded_ids.length > 0 && (
                    <span>{existingShare.excluded_ids.length} finding{existingShare.excluded_ids.length === 1 ? "" : "s"} excluded</span>
                  )}
                </div>
                <div className="modal-actions">
                  <button
                    className="btn btn-ghost"
                    style={{ color: "var(--crit)" }}
                    onClick={() => handleRevokeShare(existingShare.id)}
                  >
                    Stop Sharing
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="modal-field">
                  <label>Expiration</label>
                  <div className="share-expiry-group">
                    {(["never", "24h", "7d", "30d"] as const).map((opt) => (
                      <button
                        key={opt}
                        className={`share-expiry-btn${expiresIn === opt ? " selected" : ""}`}
                        onClick={() => setExpiresIn(opt)}
                      >
                        {opt === "never" ? "Never" : opt === "24h" ? "24 hours" : opt === "7d" ? "7 days" : "30 days"}
                      </button>
                    ))}
                  </div>
                </div>

                {expandedFindings.length > 0 && (
                  <div className="modal-field">
                    <label>Exclude Findings</label>
                    <div className="share-findings-list">
                      {expandedFindings.map((f) => (
                        <label key={f.id} className="share-finding-row">
                          <input
                            type="checkbox"
                            checked={excludedIds.has(f.id)}
                            onChange={() => toggleExcluded(f.id)}
                          />
                          <span
                            className="report-sev-badge"
                            style={{ color: sevColor(f.severity), background: sevBg(f.severity), fontSize: "10px", padding: "1px 6px" }}
                          >
                            {f.severity.slice(0, 4).toUpperCase()}
                          </span>
                          <span className="share-finding-title">{f.title}</span>
                        </label>
                      ))}
                    </div>
                    {excludedIds.size > 0 && (
                      <div style={{ fontSize: "11px", color: "var(--text-3)", marginTop: "6px", fontFamily: "'Geist Mono', monospace" }}>
                        {excludedIds.size} finding{excludedIds.size === 1 ? "" : "s"} will be hidden from the public report
                      </div>
                    )}
                  </div>
                )}

                <div className="modal-actions">
                  <button className="btn btn-ghost" onClick={() => setShareModalScanId(null)}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={shareLoading}
                    onClick={handleCreateShare}
                  >
                    {shareLoading ? "Creating..." : "Create Public Link"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
