export type ScanStatus = "pending" | "running" | "complete" | "failed";
export type ScanType = "whitebox" | "blackbox";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type FindingStatus = "new" | "confirmed" | "in_progress" | "fixed" | "verified" | "dismissed" | "accepted_risk";
export type AgentPhase = "recon" | "planning" | "exploitation" | "browser-confirm" | "reporting";
export type Confidence = "confirmed" | "firm" | "tentative";

export interface Scan {
  id: string;
  url: string;
  status: ScanStatus;
  scan_type: ScanType;
  model: string;
  started_at: string | null;
  completed_at: string | null;
  risk_score: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Finding {
  id: string;
  scan_id: string;
  title: string;
  description: string | null;
  severity: Severity;
  cvss_score: number | null;
  status: FindingStatus;
  endpoint: string | null;
  file_path: string | null;
  cwe: string | null;
  owasp: string | null;
  exploited: boolean;
  fix_guide_json: FixGuide | null;
  ai_commentary: string | null;
  browser_evidence_json: BrowserEvidence | null;
  confidence: Confidence;
  created_at: string;
}

export interface FixGuide {
  steps: string[];
  diff: string | null;
  install_cmd: string | null;
  verify_cmd: string | null;
}

export interface BrowserEvidence {
  screenshot: string;
  cookie_data: string | null;
  dialog_detected: boolean;
  confirmed: boolean;
  timestamp: string;
  proof_level: 1 | 2 | 3 | 4;
  proof_detail: string;
  payloads_attempted: string[];
  bypass_rounds: number;
}

export interface AgentLogEntry {
  id: string;
  scan_id: string;
  timestamp: string;
  phase: AgentPhase;
  message: string;
  metadata: Record<string, unknown>;
}

export interface CreateScanRequest {
  url: string;
  scan_type: ScanType;
  auth_headers?: Record<string, string>;
  write_probes_enabled?: boolean;
}

export type ScheduleInterval = "6h" | "12h" | "daily" | "weekly";

export interface ScheduledScan {
  id: string;
  url: string;
  scan_type: ScanType;
  schedule: ScheduleInterval;
  auth_headers: Record<string, string>;
  enabled: boolean;
  last_run_id: string | null;
  last_run_at: string | null;
  next_run_at: string;
  created_at: string;
  updated_at: string;
}

export interface StreamEvent {
  type: "log" | "finding" | "phase_change" | "scan_complete" | "scan_error";
  data: AgentLogEntry | Finding | { phase: AgentPhase } | { scan_id: string };
}
