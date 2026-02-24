import { useState } from "react";
import type { Finding, FindingStatus, Severity, Confidence } from "../types/index";
import { FindingDetail } from "./FindingDetail";

interface FindingsTableProps {
  findings: Finding[];
  newFindingIds?: Set<string>;
  fixedFindings?: Finding[];
  onFindingsChange?: () => void;
}

type SeverityFilter = "all" | Severity;
type StatusFilter = "all" | "open" | "in_progress" | "fixed" | "verified" | "dismissed";

function sevBadgeClass(severity: Severity): string {
  switch (severity) {
    case "critical": return "sev sev-c";
    case "high": return "sev sev-h";
    case "medium": return "sev sev-m";
    case "low": return "sev sev-l";
    case "info": return "sev";
  }
}

function sevLabel(severity: Severity): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

function cvssClass(score: number | null): string {
  if (score === null) return "cvss";
  if (score >= 9) return "cvss cvss-c";
  if (score >= 7) return "cvss cvss-h";
  if (score >= 4) return "cvss cvss-m";
  return "cvss cvss-l";
}

function statusDotClass(status: Finding["status"]): string {
  switch (status) {
    case "fixed":
    case "verified": return "sc-dot scd-fix";
    case "confirmed":
    case "in_progress": return "sc-dot scd-conf";
    case "dismissed":
    case "accepted_risk": return "sc-dot scd-dismiss";
    default: return "sc-dot scd-new";
  }
}

function statusLabel(status: Finding["status"]): string {
  switch (status) {
    case "new": return "New";
    case "confirmed": return "Confirmed";
    case "in_progress": return "In Progress";
    case "fixed": return "Fixed";
    case "verified": return "Verified";
    case "dismissed": return "Dismissed";
    case "accepted_risk": return "Accepted Risk";
  }
}

function confBadgeClass(c: Confidence): string {
  switch (c) {
    case "confirmed": return "conf conf-confirmed";
    case "firm": return "conf conf-firm";
    case "tentative": return "conf conf-tentative";
  }
}

function confLabel(c: Confidence): string {
  switch (c) {
    case "confirmed": return "Confirmed";
    case "firm": return "Firm";
    case "tentative": return "Suspected";
  }
}

const SEV_FILTER_OPTIONS: { key: SeverityFilter; label: string; activeClass: string }[] = [
  { key: "all", label: "All", activeClass: "fp active-all" },
  { key: "critical", label: "Critical", activeClass: "fp active-crit" },
  { key: "high", label: "High", activeClass: "fp active-high" },
  { key: "medium", label: "Medium", activeClass: "fp active-med" },
  { key: "low", label: "Low", activeClass: "fp active-low" },
  { key: "info", label: "Info", activeClass: "fp active-info" },
];

const STATUS_FILTER_OPTIONS: { key: StatusFilter; label: string; activeClass: string }[] = [
  { key: "all", label: "All", activeClass: "fp active-all" },
  { key: "open", label: "Open", activeClass: "fp active-open" },
  { key: "in_progress", label: "In Progress", activeClass: "fp active-prog" },
  { key: "fixed", label: "Fixed", activeClass: "fp active-fixed" },
  { key: "verified", label: "Verified", activeClass: "fp active-ver" },
  { key: "dismissed", label: "Dismissed", activeClass: "fp active-dismiss" },
];

function matchesStatusFilter(status: FindingStatus, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "open") return status === "new" || status === "confirmed";
  if (filter === "dismissed") return status === "dismissed" || status === "accepted_risk";
  return status === filter;
}

function FixedSection({ findings }: { findings: Finding[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed-section">
      <button className="fixed-toggle" onClick={() => setOpen(!open)}>
        <svg className={`fixed-chevron${open ? " open" : ""}`} width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 4.5L6 6.5L8 4.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {findings.length} fixed since previous scan
      </button>
      {open && (
        <div className="fixed-list">
          {findings.map((f) => (
            <div key={f.id} className="fr fixed-row">
              <div>
                <span className={sevBadgeClass(f.severity)}>
                  {sevLabel(f.severity)}
                </span>
              </div>
              <div>
                <div className="fr-name">
                  {f.title}
                  <span className="diff-tag diff-tag-fixed">FIXED</span>
                </div>
              </div>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "12px", fontFamily: "'Geist Mono', monospace", color: "var(--text-3)" }}>
                {f.endpoint ?? "\u2014"}
              </div>
              <div>
                <span className={cvssClass(f.cvss_score)}>
                  {f.cvss_score !== null ? f.cvss_score.toFixed(1) : "\u2014"}
                </span>
              </div>
              <div className="status-chip">
                <span className="sc-dot scd-fix" />
                Fixed
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function FindingsTable({ findings, newFindingIds, fixedFindings, onFindingsChange }: FindingsTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sevFilter, setSevFilter] = useState<SeverityFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [localFindings, setLocalFindings] = useState<Map<string, FindingStatus>>(new Map());

  const resolved = findings.filter((f) => {
    const s = localFindings.get(f.id) ?? f.status;
    return s === "fixed" || s === "verified" || s === "dismissed" || s === "accepted_risk";
  }).length;

  const filtered = findings.filter((f) => {
    const effectiveStatus = localFindings.get(f.id) ?? f.status;
    if (sevFilter !== "all" && f.severity !== sevFilter) return false;
    if (!matchesStatusFilter(effectiveStatus, statusFilter)) return false;
    return true;
  });

  function toggleRow(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  function handleStatusChange(id: string, newStatus: FindingStatus) {
    setLocalFindings((prev) => new Map(prev).set(id, newStatus));
    onFindingsChange?.();
  }

  return (
    <div className="findings-card">
      <div className="findings-head">
        <span className="findings-title">Findings</span>
        <div className="filter-pills">
          {SEV_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              className={sevFilter === opt.key ? opt.activeClass : "fp"}
              onClick={() => setSevFilter(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="findings-head" style={{ paddingTop: 0 }}>
        <span className="findings-subtitle">Status</span>
        <div className="filter-pills">
          {STATUS_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              className={statusFilter === opt.key ? opt.activeClass : "fp"}
              onClick={() => setStatusFilter(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {findings.length > 0 && (
        <div className="rem-bar-wrap">
          <span className="rem-label">{resolved} of {findings.length} resolved</span>
          <div className="rem-bar">
            <div
              className="rem-fill"
              style={{ width: `${(resolved / findings.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="findings-cols">
        <span>Severity</span>
        <span>Vulnerability</span>
        <span>Endpoint</span>
        <span>CVSS</span>
        <span>Status</span>
      </div>

      {filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-title">No findings</div>
          <div className="empty-state-sub">
            {sevFilter === "all" && statusFilter === "all"
              ? "No vulnerabilities detected for this scan."
              : "No findings match the current filters."}
          </div>
        </div>
      )}

      {filtered.map((finding) => {
        const effectiveStatus = localFindings.get(finding.id) ?? finding.status;
        const displayFinding = effectiveStatus !== finding.status
          ? { ...finding, status: effectiveStatus }
          : finding;

        return (
          <div key={finding.id}>
            <div
              className={`fr${expandedId === finding.id ? " open" : ""}${finding.confidence === "tentative" ? " tentative" : ""}`}
              onClick={() => toggleRow(finding.id)}
            >
              <div>
                <span className={sevBadgeClass(finding.severity)}>
                  {sevLabel(finding.severity)}
                </span>
              </div>
              <div>
                <div className="fr-name">
                  {finding.title}
                  <span className={confBadgeClass(finding.confidence)}>
                    {confLabel(finding.confidence)}
                  </span>
                  {newFindingIds?.has(finding.id) && (
                    <span className="diff-tag diff-tag-new">NEW</span>
                  )}
                </div>
                {finding.file_path && (
                  <div className="fr-path">{finding.file_path}</div>
                )}
              </div>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "12px", fontFamily: "'Geist Mono', monospace", color: "var(--text-3)" }}>
                {finding.endpoint ?? "\u2014"}
              </div>
              <div>
                <span className={cvssClass(finding.cvss_score)}>
                  {finding.cvss_score !== null ? finding.cvss_score.toFixed(1) : "\u2014"}
                </span>
              </div>
              <div className="status-chip">
                <span className={statusDotClass(effectiveStatus)} />
                {statusLabel(effectiveStatus)}
              </div>
            </div>
            {expandedId === finding.id && (
              <FindingDetail
                finding={displayFinding}
                onStatusChange={handleStatusChange}
              />
            )}
          </div>
        );
      })}

      {fixedFindings && fixedFindings.length > 0 && (
        <FixedSection findings={fixedFindings} />
      )}
    </div>
  );
}
