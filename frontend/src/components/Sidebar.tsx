import { NavLink } from "react-router-dom";
import type { Scan } from "../types/index";

interface SidebarProps {
  scans: Scan[];
  findingsCount: number;
  activeScanId: string | null;
  activeModel?: string;
  onNewScan: () => void;
  onSelectScan: (scanId: string) => void;
}

function DashboardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="1" y="1" width="5" height="5" rx="1" />
      <rect x="8" y="1" width="5" height="5" rx="1" />
      <rect x="1" y="8" width="5" height="5" rx="1" />
      <rect x="8" y="8" width="5" height="5" rx="1" />
    </svg>
  );
}

function FindingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="6.5" cy="6.5" r="5" />
      <line x1="6.5" y1="4.5" x2="6.5" y2="7" strokeLinecap="round" />
      <circle cx="6.5" cy="8.8" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ReportsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M2.5 2h7l2.5 2.5V12a1 1 0 01-1 1h-8a1 1 0 01-1-1V3a1 1 0 011-1z" />
      <line x1="4" y1="7.5" x2="10" y2="7.5" strokeLinecap="round" />
      <line x1="4" y1="9.5" x2="7.5" y2="9.5" strokeLinecap="round" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="7" cy="7" r="5.5" />
      <path d="M7 4V7L9 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ScheduledIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="1.5" y="2.5" width="11" height="9" rx="1" />
      <line x1="1.5" y1="5.5" x2="12.5" y2="5.5" />
      <line x1="4.5" y1="1" x2="4.5" y2="3.5" strokeLinecap="round" />
      <line x1="9.5" y1="1" x2="9.5" y2="3.5" strokeLinecap="round" />
      <circle cx="7" cy="8.5" r="1.2" />
    </svg>
  );
}

function IntegrationsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="3" cy="7" r="2" />
      <circle cx="11" cy="3.5" r="2" />
      <circle cx="11" cy="10.5" r="2" />
      <line x1="5" y1="7" x2="9" y2="4" strokeLinecap="round" />
      <line x1="5" y1="7" x2="9" y2="10.5" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8">
      <line x1="6" y1="1.5" x2="6" y2="10.5" strokeLinecap="round" />
      <line x1="1.5" y1="6" x2="10.5" y2="6" strokeLinecap="round" />
    </svg>
  );
}

function statusDotClass(status: Scan["status"]): string {
  switch (status) {
    case "running": return "scan-dot dot-live";
    case "failed": return "scan-dot dot-crit";
    default: return "scan-dot dot-done";
  }
}

function scoreColor(score: number | null): string {
  if (score === null) return "var(--text-3)";
  if (score >= 8) return "var(--crit)";
  if (score >= 6) return "var(--high)";
  if (score >= 4) return "var(--med)";
  return "var(--ok)";
}

function formatScanUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname !== "/" ? u.pathname : "");
  } catch {
    return url;
  }
}

function formatScanDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

const workspaceItems = [
  { to: "/", label: "Dashboard", icon: <DashboardIcon />, end: true, badge: null },
  { to: "/findings", label: "All Findings", icon: <FindingsIcon />, end: false, badge: "badge" },
  { to: "/reports", label: "Reports", icon: <ReportsIcon />, end: false, badge: null },
  { to: "/history", label: "Scan History", icon: <HistoryIcon />, end: false, badge: null },
  { to: "/scheduled", label: "Scheduled", icon: <ScheduledIcon />, end: false, badge: null },
  { to: "/integrations", label: "Integrations", icon: <IntegrationsIcon />, end: false, badge: null },
];

export function Sidebar({ scans, findingsCount, activeScanId, activeModel, onNewScan, onSelectScan }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sb-section">Workspace</div>

      {workspaceItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `sb-item${isActive ? " active" : ""}`}
        >
          <span className="sb-item-icon">{item.icon}</span>
          {item.label}
          {item.badge === "badge" && findingsCount > 0 && (
            <span className="sb-badge">{findingsCount}</span>
          )}
        </NavLink>
      ))}

      <div className="sb-section" style={{ marginTop: "var(--s-8)" }}>Recent Scans</div>

      <div className="scan-list">
        {scans.length === 0 && (
          <div style={{ padding: "8px 10px", fontSize: "12px", color: "var(--text-3)" }}>
            No scans yet
          </div>
        )}
        {scans.slice(0, 8).map((scan) => (
          <div
            key={scan.id}
            className={`scan-entry${scan.id === activeScanId ? " active" : ""}`}
            style={{ cursor: "pointer" }}
            onClick={() => onSelectScan(scan.id)}
          >
            <div className="scan-entry-url">{formatScanUrl(scan.url)}</div>
            <div className="scan-entry-meta">
              <span className={statusDotClass(scan.status)} />
              <span className="scan-date">{formatScanDate(scan.created_at)}</span>
              {scan.risk_score !== null && (
                <span
                  className="scan-score"
                  style={{ color: scoreColor(scan.risk_score) }}
                >
                  {scan.risk_score.toFixed(1)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="sb-spacer" />

      {activeModel && (
        <div className="sb-model-label">
          <span className="sb-model-dot" />
          {activeModel}
        </div>
      )}

      <button className="sb-new-btn" onClick={onNewScan}>
        <PlusIcon />
        New Scan
      </button>
      <div className="sb-footer-stamp">Local-first · Model-agnostic</div>
    </aside>
  );
}
