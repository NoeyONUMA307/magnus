import { useCallback, useEffect, useRef, useState } from "react";
import { getScans, createScan } from "../lib/api";
import { useScan } from "../hooks/useScan";
import { useStream } from "../hooks/useStream";
import { PageHeader } from "../components/PageHeader";
import { AttackStream } from "../components/AttackStream";
import { SeverityBars } from "../components/SeverityBars";
import { AttackSurface } from "../components/AttackSurface";
import { FindingsTable } from "../components/FindingsTable";
import { CopyButton } from "../components/CopyButton";
import type { Scan, Finding, SeverityCounts, AttackSurfaceCategory, AgentPhase } from "../types/index";

const DISMISSED_STATUSES = new Set(["dismissed", "accepted_risk"]);

function computeSeverityCounts(findings: ReturnType<typeof useScan>["findings"]): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    if (DISMISSED_STATUSES.has(f.status)) continue;
    counts[f.severity] += 1;
  }
  return counts;
}

function deriveAttackSurface(findings: ReturnType<typeof useScan>["findings"]): AttackSurfaceCategory[] {
  const catMap = new Map<string, number>();
  for (const f of findings) {
    if (f.owasp) {
      catMap.set(f.owasp, (catMap.get(f.owasp) ?? 0) + 1);
    } else {
      catMap.set("Other", (catMap.get("Other") ?? 0) + 1);
    }
  }
  const COLORS: string[] = ["var(--crit)", "var(--high)", "var(--med)", "var(--low)", "var(--ok)", "var(--stream-code)"];
  const entries = Array.from(catMap.entries()).sort((a, b) => b[1] - a[1]);
  const firstEntry = entries[0];
  const max = firstEntry !== undefined ? firstEntry[1] : 1;
  return entries.map(([name, count], idx): AttackSurfaceCategory => ({
    name,
    count,
    maxCount: max,
    color: COLORS[idx % COLORS.length] ?? "var(--text-3)",
  }));
}

function derivePhase(events: ReturnType<typeof useStream>["events"]): AgentPhase {
  const last = events[events.length - 1];
  if (!last) return "recon";
  return last.phase;
}

function deriveProgress(phase: AgentPhase, events: ReturnType<typeof useStream>["events"]): number {
  const phaseBase: Record<AgentPhase, number> = {
    recon: 0,
    planning: 20,
    exploitation: 40,
    "browser-confirm": 60,
    reporting: 80,
  };
  const base = phaseBase[phase] ?? 0;
  const phaseEvents = events.filter((e) => e.phase === phase).length;
  const inPhaseProgress = Math.min(20, phaseEvents * 2);
  return base + inPhaseProgress;
}

function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

interface TokenUsageInfo {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  llm_calls: number;
  estimated_cost_usd: number;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatCost(usd: number): string {
  if (usd === 0) return "Free";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

function getTokenUsage(scan: Scan): TokenUsageInfo | null {
  const tu = scan.metadata?.token_usage;
  if (!tu || typeof tu !== "object") return null;
  const t = tu as Record<string, unknown>;
  if (typeof t.total_tokens !== "number") return null;
  return t as unknown as TokenUsageInfo;
}

function ScanCompleteModal({
  scan,
  findings,
  onDismiss,
  onViewFindings,
}: {
  scan: Scan;
  findings: Finding[];
  onDismiss: () => void;
  onViewFindings: () => void;
}) {
  const critCount = findings.filter((f) => f.severity === "critical").length;
  const highCount = findings.filter((f) => f.severity === "high").length;
  const exploitedCount = findings.filter((f) => f.exploited).length;
  const tokenUsage = getTokenUsage(scan);

  return (
    <div className="modal-overlay" onClick={onDismiss}>
      <div className="about-card" onClick={(e) => e.stopPropagation()}>
        <div className="about-logo" style={{ background: "var(--ok-bg)", border: "1px solid var(--ok-border)" }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="var(--ok)" strokeWidth="2.5">
            <path d="M6 14.5L11.5 20L22 8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <h2 className="about-title">Scan Complete</h2>
        <div className="about-version">{hostname(scan.url)}</div>

        <p className="about-desc">
          {findings.length === 0
            ? "No vulnerabilities were discovered during this assessment."
            : `Discovered ${findings.length} ${findings.length === 1 ? "vulnerability" : "vulnerabilities"} across ${hostname(scan.url)}.`}
        </p>

        {findings.length > 0 && (
          <>
            <div className="about-divider" />
            <div className="about-specs">
              <div className="about-spec">
                <span className="about-spec-key">Total</span>
                <span className="about-spec-val">{findings.length} findings</span>
              </div>
              {critCount > 0 && (
                <div className="about-spec">
                  <span className="about-spec-key">Critical</span>
                  <span className="about-spec-val" style={{ color: "var(--crit)" }}>{critCount}</span>
                </div>
              )}
              {highCount > 0 && (
                <div className="about-spec">
                  <span className="about-spec-key">High</span>
                  <span className="about-spec-val" style={{ color: "var(--high)" }}>{highCount}</span>
                </div>
              )}
              {exploitedCount > 0 && (
                <div className="about-spec">
                  <span className="about-spec-key">Exploited</span>
                  <span className="about-spec-val" style={{ color: "var(--crit)" }}>{exploitedCount} confirmed</span>
                </div>
              )}
              {scan.risk_score !== null && (
                <div className="about-spec">
                  <span className="about-spec-key">Risk Score</span>
                  <span className="about-spec-val">{scan.risk_score.toFixed(1)} / 10</span>
                </div>
              )}
            </div>
          </>
        )}

        {tokenUsage && tokenUsage.total_tokens > 0 && (
          <>
            <div className="about-divider" />
            <div className="about-specs">
              <div className="about-spec">
                <span className="about-spec-key">Tokens</span>
                <span className="about-spec-val">{formatTokens(tokenUsage.total_tokens)}</span>
              </div>
              <div className="about-spec">
                <span className="about-spec-key">Est. Cost</span>
                <span className="about-spec-val">{formatCost(tokenUsage.estimated_cost_usd)}</span>
              </div>
            </div>
          </>
        )}

        <div className="about-divider" />

        <div style={{ display: "flex", gap: "var(--s-8)", justifyContent: "center" }}>
          <button className="btn btn-ghost" onClick={onDismiss}>Dismiss</button>
          <button className="btn btn-primary" onClick={onViewFindings}>
            {findings.length > 0 ? "View Findings" : "View Report"}
          </button>
        </div>

        <button className="modal-close" onClick={onDismiss} aria-label="Close" style={{ position: "absolute", top: "16px", right: "16px" }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="2" y1="2" x2="12" y2="12" strokeLinecap="round" />
            <line x1="12" y1="2" x2="2" y2="12" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

interface OverviewProps {
  activeScanId: string | null;
  onScanCreated?: (scan: Scan) => void;
}

export function Overview({ activeScanId: propScanId, onScanCreated }: OverviewProps) {
  const [localScanId, setLocalScanId] = useState<string | null>(null);
  const [showComplete, setShowComplete] = useState(false);
  const prevStatusRef = useRef<string | null>(null);
  const dismissedScansRef = useRef<Set<string>>(new Set());
  const scanId = propScanId ?? localScanId;

  useEffect(() => {
    if (propScanId) return;
    getScans()
      .then((scans: Scan[]) => {
        const first = scans[0];
        if (first) {
          setLocalScanId(first.id);
        }
      })
      .catch(() => {});
  }, [propScanId]);

  const { scan, findings, diff, refetchFindings } = useScan(scanId);

  const handleRescan = useCallback(async () => {
    if (!scan) return;
    try {
      const meta = scan.metadata ?? {};
      const payload: Parameters<typeof createScan>[0] = {
        url: scan.url,
        scan_type: scan.scan_type as "whitebox" | "blackbox",
      };
      if (meta.auth_headers && typeof meta.auth_headers === "object" && !Array.isArray(meta.auth_headers)) {
        payload.auth_headers = meta.auth_headers as Record<string, string>;
      }
      if (meta.openapi_spec && typeof meta.openapi_spec === "object" && !Array.isArray(meta.openapi_spec)) {
        payload.openapi_spec = meta.openapi_spec as Record<string, unknown>;
      }
      if (meta.write_probes_enabled === true) {
        payload.write_probes_enabled = true;
      }
      const newScan = await createScan(payload);
      setLocalScanId(newScan.id);
      onScanCreated?.(newScan);
    } catch {
      // silently fail
    }
  }, [scan, onScanCreated]);
  const { events, connected } = useStream(
    scan?.status === "running" || scan?.status === "pending" ? scanId : null
  );

  // Detect scan completion — live transition OR recently-completed on navigate
  const scanStatus = scan?.status ?? null;
  const prevScanIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevScanIdRef.current !== scanId) {
      prevScanIdRef.current = scanId;
      prevStatusRef.current = null;
      setShowComplete(false);
    }
    if (!scanStatus) return;
    const prev = prevStatusRef.current;
    prevStatusRef.current = scanStatus;

    // Live transition: watched status go from running/pending → complete
    if (prev && (prev === "running" || prev === "pending") && scanStatus === "complete") {
      setShowComplete(true);
      return;
    }

    // Navigated to already-complete scan — show modal if completed within last 5 min
    if (!prev && scanStatus === "complete" && scan?.completed_at && scanId && !dismissedScansRef.current.has(scanId)) {
      const completedAgo = Date.now() - new Date(scan.completed_at).getTime();
      if (completedAgo < 5 * 60 * 1000) {
        setShowComplete(true);
      }
    }
  }, [scanId, scanStatus, scan?.completed_at]);

  const severityCounts = computeSeverityCounts(findings);
  const exploitedCount = findings.filter((f) => f.exploited && !DISMISSED_STATUSES.has(f.status)).length;
  const attackSurface = deriveAttackSurface(findings);
  const phase = derivePhase(events);
  const progress = scan?.status === "complete" ? 100 : deriveProgress(phase, events);

  if (!scan) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">No scans yet</div>
        <div className="empty-state-sub">
          Start your first security scan by clicking "New Scan" above.
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        scan={scan}
        findings={findings}
        severityCounts={severityCounts}
        exploitedCount={exploitedCount}
        totalFindings={findings.length}
        diff={diff}
        onRescan={handleRescan}
      />
      <div className="content">
        <AttackStream
          scanId={scan.id}
          events={events}
          phase={phase}
          progress={progress}
          isLive={connected}
          model={scan.model}
        />
        {scan.status === "complete" && !!scan.metadata?.executive_summary && (
          <div className="exec-summary-card">
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
            {(() => {
              const tu = getTokenUsage(scan);
              if (!tu || tu.total_tokens === 0) return null;
              return (
                <div className="token-usage-line">
                  {formatTokens(tu.total_tokens)} tokens · {tu.llm_calls} LLM calls · {formatCost(tu.estimated_cost_usd)}
                </div>
              );
            })()}
          </div>
        )}
        <div className="two-col">
          <SeverityBars counts={severityCounts} />
          <AttackSurface categories={attackSurface} />
        </div>
        <FindingsTable
          findings={findings}
          newFindingIds={diff ? new Set(diff.new_ids) : undefined}
          fixedFindings={diff?.fixed}
          onFindingsChange={refetchFindings}
        />
      </div>

      {showComplete && scan && (
        <ScanCompleteModal
          scan={scan}
          findings={findings}
          onDismiss={() => {
            setShowComplete(false);
            dismissedScansRef.current.add(scan.id);
          }}
          onViewFindings={() => {
            setShowComplete(false);
            dismissedScansRef.current.add(scan.id);
            document.querySelector(".findings-card")?.scrollIntoView({ behavior: "smooth" });
          }}
        />
      )}
    </>
  );
}
