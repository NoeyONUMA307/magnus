import { useState } from "react";
import type { Finding, FindingStatus } from "../types/index";
import { getEvidenceUrl, updateFindingStatus } from "../lib/api";
import { CopyButton } from "./CopyButton";

interface FindingDetailProps {
  finding: Finding;
  onStatusChange?: (id: string, newStatus: FindingStatus) => void;
}

function cvssLabel(score: number | null): string {
  if (score === null) return "—";
  if (score >= 9) return "Critical";
  if (score >= 7) return "High";
  if (score >= 4) return "Medium";
  return "Low";
}

function fixTimeEstimate(severity: Finding["severity"]): string {
  switch (severity) {
    case "critical": return "2–4 hours";
    case "high": return "4–8 hours";
    case "medium": return "1–2 days";
    case "low": return "1 week";
    case "info": return "Informational";
  }
}

const PROOF_LABELS: Record<number, string> = {
  1: "Blocked",
  2: "Reflected",
  3: "JS Execution",
  4: "Impact Confirmed",
};

function proofLevelClass(level: number): string {
  if (level >= 3) return "proof-level proof-high";
  if (level === 2) return "proof-level proof-mid";
  return "proof-level proof-low";
}

type Tab = "analysis" | "fix";

const STATUS_OPTIONS: { value: FindingStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "confirmed", label: "Confirmed" },
  { value: "in_progress", label: "In Progress" },
  { value: "fixed", label: "Fixed" },
  { value: "verified", label: "Verified" },
  { value: "dismissed", label: "Dismissed" },
  { value: "accepted_risk", label: "Accepted Risk" },
];

export function FindingDetail({ finding, onStatusChange }: FindingDetailProps) {
  const [tab, setTab] = useState<Tab>("analysis");
  const [status, setStatus] = useState<FindingStatus>(finding.status);
  const steps = finding.fix_guide_json?.steps ?? [];
  const diff = finding.fix_guide_json?.diff ?? null;
  const hasFixGuide = steps.length > 0 || diff;

  return (
    <div className="fd">
      <div className="fd-left">
        {/* Tab bar */}
        <div className="fd-tabs">
          <button
            className={`fd-tab${tab === "analysis" ? " active" : ""}`}
            onClick={() => setTab("analysis")}
          >
            Analysis
          </button>
          <button
            className={`fd-tab${tab === "fix" ? " active" : ""}`}
            onClick={() => setTab("fix")}
          >
            Fix Guide
            {hasFixGuide && <span className="fd-tab-dot" />}
          </button>
        </div>

        {tab === "analysis" && (
          <>
            <div className="fd-section">
              <div className="fd-label">What happened</div>
              {finding.description && <CopyButton text={finding.description} />}
            </div>
            <div className="fd-desc">
              {finding.description ?? "No description provided."}
            </div>

            {diff && (
              <>
                <div className="fd-section">
                  <div className="fd-label">Proof of Concept</div>
                  <CopyButton text={diff} />
                </div>
                <div className="code-block">{diff}</div>
              </>
            )}

            {finding.ai_commentary && (
              <div className="ai-callout">
                <div className="ai-callout-icon">◆</div>
                <div style={{ flex: 1 }}>
                  <div className="fd-section">
                    <div className="ai-callout-label">AI Analysis</div>
                    <CopyButton text={finding.ai_commentary} />
                  </div>
                  <div className="ai-callout-text">{finding.ai_commentary}</div>
                </div>
              </div>
            )}

            {finding.browser_evidence_json && (
              <div className="browser-evidence">
                <div className="fd-section">
                  <div className="fd-label">Browser Evidence</div>
                  <span className={proofLevelClass(finding.browser_evidence_json.proof_level)}>
                    Level {finding.browser_evidence_json.proof_level} — {PROOF_LABELS[finding.browser_evidence_json.proof_level]}
                  </span>
                </div>

                {finding.browser_evidence_json.proof_detail && (
                  <div className="fd-desc" style={{ marginBottom: 12 }}>
                    {finding.browser_evidence_json.proof_detail}
                  </div>
                )}

                {finding.browser_evidence_json.screenshot && (
                  <div className="evidence-screenshot">
                    <img
                      src={getEvidenceUrl(
                        finding.scan_id,
                        finding.id,
                        finding.browser_evidence_json.screenshot
                      )}
                      alt={`Browser evidence for ${finding.title}`}
                      loading="lazy"
                    />
                  </div>
                )}

                {finding.browser_evidence_json.cookie_data && (
                  <div className="evidence-cookies">
                    <div className="fd-section">
                      <div className="fd-label">Extracted Cookies</div>
                      <CopyButton text={finding.browser_evidence_json.cookie_data} />
                    </div>
                    <div className="code-block">{finding.browser_evidence_json.cookie_data}</div>
                  </div>
                )}

                {finding.browser_evidence_json.dialog_detected && (
                  <div className="evidence-dialog-notice">
                    Dialog event detected — alert/confirm/prompt triggered by payload
                  </div>
                )}

                <div className="evidence-meta">
                  <span>{finding.browser_evidence_json.payloads_attempted.length} payload{finding.browser_evidence_json.payloads_attempted.length !== 1 ? "s" : ""} tested</span>
                  <span>{finding.browser_evidence_json.bypass_rounds} bypass round{finding.browser_evidence_json.bypass_rounds !== 1 ? "s" : ""}</span>
                </div>
              </div>
            )}
          </>
        )}

        {tab === "fix" && (
          <>
            {!hasFixGuide && (
              <div className="fd-empty-fix">
                No fix guide available for this finding. Re-run the scan to generate remediation steps.
              </div>
            )}

            {steps.length > 0 && (
              <>
                <div className="fd-section">
                  <div className="fd-label">Remediation Steps</div>
                  <CopyButton text={steps.join("\n")} />
                </div>
                <div className="fix-steps">
                  {steps.map((step, idx) => (
                    <div key={idx} className="fix-step">
                      <span className="fix-step-num">{idx + 1}</span>
                      <span className="fix-step-text">{step}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {diff && (
              <>
                <div className="fd-section">
                  <div className="fd-label">Proof of Concept / Verification</div>
                  <CopyButton text={diff} />
                </div>
                <div className="code-block">{diff}</div>
              </>
            )}

            {finding.endpoint && (
              <>
                <div className="fd-label">Affected Endpoint</div>
                <div className="fix-endpoint">{finding.endpoint}</div>
              </>
            )}

            {finding.file_path && (
              <>
                <div className="fd-label">Affected File</div>
                <div className="fix-endpoint">{finding.file_path}</div>
              </>
            )}

            {(finding.cwe || finding.owasp) && (
              <>
                <div className="fd-label">References</div>
                <div className="fix-refs">
                  {finding.cwe && <span className="fix-ref">{finding.cwe}</span>}
                  {finding.owasp && <span className="fix-ref">{finding.owasp}</span>}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div className="fd-right">
        <div className="fd-label">Metadata</div>
        <div className="meta-rows">
          <div className="meta-row">
            <span className="meta-key">Status</span>
            <select
              className="status-select"
              value={status}
              onChange={(e) => {
                const next = e.target.value as FindingStatus;
                setStatus(next);
                updateFindingStatus(finding.id, next)
                  .then(() => onStatusChange?.(finding.id, next))
                  .catch(() => setStatus(status));
              }}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="meta-row">
            <span className="meta-key">CVSS</span>
            <span className={`meta-val${finding.cvss_score !== null && finding.cvss_score >= 7 ? " c" : ""}`}>
              {finding.cvss_score !== null ? `${finding.cvss_score} · ${cvssLabel(finding.cvss_score)}` : "—"}
            </span>
          </div>
          {finding.endpoint && (
            <div className="meta-row">
              <span className="meta-key">Vector</span>
              <span className="meta-val" style={{ fontFamily: "'Geist Mono', monospace", fontSize: "11px" }}>
                {finding.endpoint}
              </span>
            </div>
          )}
          <div className="meta-row">
            <span className="meta-key">CWE</span>
            <span className="meta-val">{finding.cwe ?? "—"}</span>
          </div>
          <div className="meta-row">
            <span className="meta-key">OWASP</span>
            <span className="meta-val">{finding.owasp ?? "—"}</span>
          </div>
          <div className="meta-row">
            <span className="meta-key">Confidence</span>
            <span className={`meta-val${finding.confidence === "confirmed" ? " ok" : finding.confidence === "tentative" ? " c" : ""}`}>
              {finding.confidence === "confirmed" ? "Confirmed" : finding.confidence === "firm" ? "Firm" : "Suspected"}
            </span>
          </div>
          <div className="meta-row">
            <span className="meta-key" />
            <span className="meta-val" style={{ fontSize: "11px", color: "var(--text-3)" }}>
              {finding.confidence === "confirmed"
                ? "Verified by browser agent or direct evidence"
                : finding.confidence === "firm"
                  ? "HTTP probe returned corroborating response"
                  : "Based on LLM analysis — no direct proof"}
            </span>
          </div>
          <div className="meta-row">
            <span className="meta-key">Exploited</span>
            <span className={`meta-val${finding.exploited ? " c" : " ok"}`}>
              {finding.exploited ? "Yes" : "No"}
            </span>
          </div>
          {finding.browser_evidence_json && (
            <div className="meta-row">
              <span className="meta-key">Browser</span>
              <span className={`meta-val${finding.browser_evidence_json.proof_level >= 3 ? " ok" : ""}`}>
                Level {finding.browser_evidence_json.proof_level}
              </span>
            </div>
          )}
          <div className="meta-row">
            <span className="meta-key">Fix Time</span>
            <span className="meta-val">{fixTimeEstimate(finding.severity)}</span>
          </div>
        </div>

      </div>
    </div>
  );
}
