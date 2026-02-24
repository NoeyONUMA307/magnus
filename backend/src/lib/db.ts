import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v4 as uuidv4 } from "uuid";
import type {
  Scan,
  Finding,
  AgentLogEntry,
  ScanStatus,
  ScanType,
  Severity,
  FindingStatus,
  AgentPhase,
  Confidence,
  FixGuide,
  BrowserEvidence,
  ScheduledScan,
  ScheduleInterval,
} from "../types/index.js";

import { mkdirSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../../../");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "magnus.db");

mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS scans (
    id          TEXT PRIMARY KEY,
    url         TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    scan_type   TEXT NOT NULL,
    model       TEXT NOT NULL,
    started_at  TEXT,
    completed_at TEXT,
    risk_score  REAL,
    metadata    TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS findings (
    id           TEXT PRIMARY KEY,
    scan_id      TEXT NOT NULL REFERENCES scans(id),
    title        TEXT NOT NULL,
    description  TEXT,
    severity     TEXT NOT NULL,
    cvss_score   REAL,
    status       TEXT NOT NULL DEFAULT 'new',
    endpoint     TEXT,
    file_path    TEXT,
    cwe          TEXT,
    owasp        TEXT,
    exploited    INTEGER NOT NULL DEFAULT 0,
    fix_guide_json TEXT,
    ai_commentary TEXT,
    browser_evidence_json TEXT,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_log (
    id        TEXT PRIMARY KEY,
    scan_id   TEXT NOT NULL REFERENCES scans(id),
    timestamp TEXT NOT NULL,
    phase     TEXT NOT NULL,
    message   TEXT NOT NULL,
    metadata  TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS rescans (
    id               TEXT PRIMARY KEY,
    original_scan_id TEXT NOT NULL REFERENCES scans(id),
    finding_id       TEXT NOT NULL REFERENCES findings(id),
    status           TEXT NOT NULL DEFAULT 'pending',
    triggered_at     TEXT NOT NULL,
    completed_at     TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scheduled_scans (
    id           TEXT PRIMARY KEY,
    url          TEXT NOT NULL,
    scan_type    TEXT NOT NULL,
    schedule     TEXT NOT NULL,
    auth_headers TEXT NOT NULL DEFAULT '{}',
    enabled      INTEGER NOT NULL DEFAULT 1,
    last_run_id  TEXT,
    last_run_at  TEXT,
    next_run_at  TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS shared_reports (
    id           TEXT PRIMARY KEY,
    scan_id      TEXT NOT NULL REFERENCES scans(id),
    token        TEXT NOT NULL UNIQUE,
    excluded_ids TEXT NOT NULL DEFAULT '[]',
    expires_at   TEXT,
    created_at   TEXT NOT NULL
  );
`);

// Migration: add browser_evidence_json for existing databases
try {
  db.exec(`ALTER TABLE findings ADD COLUMN browser_evidence_json TEXT`);
} catch {
  // Column already exists
}

// Migration: add confidence column for existing databases
try {
  db.exec(`ALTER TABLE findings ADD COLUMN confidence TEXT NOT NULL DEFAULT 'tentative'`);
} catch {
  // Column already exists
}

// Seed defaults
db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`).run("llm_provider", "anthropic");
db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`).run("llm_model", "claude-opus-4-6");
db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`).run("min_severity", "low");

// Row types as returned directly from better-sqlite3 (before mapping)
interface ScanRow {
  id: string;
  url: string;
  status: string;
  scan_type: string;
  model: string;
  started_at: string | null;
  completed_at: string | null;
  risk_score: number | null;
  metadata: string;
  created_at: string;
}

interface FindingRow {
  id: string;
  scan_id: string;
  title: string;
  description: string | null;
  severity: string;
  cvss_score: number | null;
  status: string;
  endpoint: string | null;
  file_path: string | null;
  cwe: string | null;
  owasp: string | null;
  exploited: number;
  fix_guide_json: string | null;
  ai_commentary: string | null;
  browser_evidence_json: string | null;
  confidence: string;
  created_at: string;
}

interface AgentLogRow {
  id: string;
  scan_id: string;
  timestamp: string;
  phase: string;
  message: string;
  metadata: string;
}

function mapScan(row: ScanRow): Scan {
  return {
    id: row.id,
    url: row.url,
    status: row.status as ScanStatus,
    scan_type: row.scan_type as ScanType,
    model: row.model,
    started_at: row.started_at,
    completed_at: row.completed_at,
    risk_score: row.risk_score,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    created_at: row.created_at,
  };
}

function mapFinding(row: FindingRow): Finding {
  return {
    id: row.id,
    scan_id: row.scan_id,
    title: row.title,
    description: row.description,
    severity: row.severity as Severity,
    cvss_score: row.cvss_score,
    status: row.status as FindingStatus,
    endpoint: row.endpoint,
    file_path: row.file_path,
    cwe: row.cwe,
    owasp: row.owasp,
    exploited: row.exploited === 1,
    fix_guide_json: row.fix_guide_json
      ? (JSON.parse(row.fix_guide_json) as FixGuide)
      : null,
    ai_commentary: row.ai_commentary,
    browser_evidence_json: row.browser_evidence_json
      ? (JSON.parse(row.browser_evidence_json) as BrowserEvidence)
      : null,
    confidence: (row.confidence ?? "tentative") as Confidence,
    created_at: row.created_at,
  };
}

function mapAgentLog(row: AgentLogRow): AgentLogEntry {
  return {
    id: row.id,
    scan_id: row.scan_id,
    timestamp: row.timestamp,
    phase: row.phase as AgentPhase,
    message: row.message,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
  };
}

// Prepared statements
const stmts = {
  scans: {
    insert: db.prepare<{
      id: string;
      url: string;
      scan_type: string;
      model: string;
      status: string;
      metadata: string;
      created_at: string;
    }>(
      `INSERT INTO scans (id, url, scan_type, model, status, metadata, created_at)
       VALUES (@id, @url, @scan_type, @model, @status, @metadata, @created_at)`
    ),
    getById: db.prepare<[string]>(`SELECT * FROM scans WHERE id = ?`),
    list: db.prepare(`SELECT * FROM scans ORDER BY created_at DESC`),
    previousCompleted: db.prepare<[string, string]>(
      `SELECT * FROM scans WHERE url = ? AND id != ? AND status = 'complete' ORDER BY completed_at DESC LIMIT 1`
    ),
    latestCompleted: db.prepare<[string]>(
      `SELECT * FROM scans WHERE url = ? AND status = 'complete' ORDER BY completed_at DESC LIMIT 1`
    ),
    update: db.prepare<{
      status?: string | null;
      started_at?: string | null;
      completed_at?: string | null;
      risk_score?: number | null;
      metadata?: string | null;
      id: string;
    }>(
      `UPDATE scans SET
        status       = COALESCE(@status, status),
        started_at   = COALESCE(@started_at, started_at),
        completed_at = COALESCE(@completed_at, completed_at),
        risk_score   = COALESCE(@risk_score, risk_score),
        metadata     = COALESCE(@metadata, metadata)
       WHERE id = @id`
    ),
  },
  findings: {
    insert: db.prepare<{
      id: string;
      scan_id: string;
      title: string;
      description: string | null;
      severity: string;
      cvss_score: number | null;
      status: string;
      endpoint: string | null;
      file_path: string | null;
      cwe: string | null;
      owasp: string | null;
      exploited: number;
      fix_guide_json: string | null;
      ai_commentary: string | null;
      confidence: string;
      created_at: string;
    }>(
      `INSERT INTO findings
        (id, scan_id, title, description, severity, cvss_score, status,
         endpoint, file_path, cwe, owasp, exploited, fix_guide_json, ai_commentary, confidence, created_at)
       VALUES
        (@id, @scan_id, @title, @description, @severity, @cvss_score, @status,
         @endpoint, @file_path, @cwe, @owasp, @exploited, @fix_guide_json, @ai_commentary, @confidence, @created_at)`
    ),
    getById: db.prepare<[string]>(`SELECT * FROM findings WHERE id = ?`),
    list: db.prepare(
      `SELECT * FROM findings ORDER BY cvss_score DESC NULLS LAST`
    ),
    listByScan: db.prepare<[string]>(
      `SELECT * FROM findings WHERE scan_id = ? ORDER BY cvss_score DESC NULLS LAST`
    ),
    update: db.prepare<{
      status?: string | null;
      ai_commentary?: string | null;
      fix_guide_json?: string | null;
      browser_evidence_json?: string | null;
      exploited?: number | null;
      confidence?: string | null;
      id: string;
    }>(
      `UPDATE findings SET
        status        = COALESCE(@status, status),
        ai_commentary = COALESCE(@ai_commentary, ai_commentary),
        fix_guide_json = COALESCE(@fix_guide_json, fix_guide_json),
        browser_evidence_json = COALESCE(@browser_evidence_json, browser_evidence_json),
        exploited     = COALESCE(@exploited, exploited),
        confidence    = COALESCE(@confidence, confidence)
       WHERE id = @id`
    ),
  },
  agentLog: {
    insert: db.prepare<{
      id: string;
      scan_id: string;
      timestamp: string;
      phase: string;
      message: string;
      metadata: string;
    }>(
      `INSERT INTO agent_log (id, scan_id, timestamp, phase, message, metadata)
       VALUES (@id, @scan_id, @timestamp, @phase, @message, @metadata)`
    ),
    getById: db.prepare<[string]>(`SELECT * FROM agent_log WHERE id = ?`),
    getByScan: db.prepare<[string]>(
      `SELECT * FROM agent_log WHERE scan_id = ? ORDER BY timestamp ASC`
    ),
    getByScanAfter: db.prepare<[string, string]>(
      `SELECT * FROM agent_log WHERE scan_id = ? AND timestamp > ? ORDER BY timestamp ASC`
    ),
    getLastN: db.prepare<[string, number]>(
      `SELECT * FROM (
         SELECT * FROM agent_log WHERE scan_id = ? ORDER BY timestamp DESC LIMIT ?
       ) ORDER BY timestamp ASC`
    ),
  },
};

export const scans = {
  create(data: { url: string; scan_type: string; model: string; metadata?: Record<string, unknown> }): Scan {
    const id = uuidv4();
    const created_at = new Date().toISOString();
    stmts.scans.insert.run({
      id,
      url: data.url,
      scan_type: data.scan_type,
      model: data.model,
      status: "pending",
      metadata: data.metadata ? JSON.stringify(data.metadata) : "{}",
      created_at,
    });
    return mapScan(stmts.scans.getById.get(id) as ScanRow);
  },

  get(id: string): Scan | null {
    const row = stmts.scans.getById.get(id) as ScanRow | undefined;
    return row ? mapScan(row) : null;
  },

  list(): Scan[] {
    return (stmts.scans.list.all() as ScanRow[]).map(mapScan);
  },

  previousCompleted(url: string, excludeId: string): Scan | null {
    const row = stmts.scans.previousCompleted.get(url, excludeId) as ScanRow | undefined;
    return row ? mapScan(row) : null;
  },

  latestCompleted(url: string): Scan | null {
    const row = stmts.scans.latestCompleted.get(url) as ScanRow | undefined;
    return row ? mapScan(row) : null;
  },

  update(
    id: string,
    data: Partial<
      Pick<Scan, "status" | "started_at" | "completed_at" | "risk_score" | "metadata">
    >
  ): void {
    stmts.scans.update.run({
      status: data.status ?? null,
      started_at: data.started_at ?? null,
      completed_at: data.completed_at ?? null,
      risk_score: data.risk_score ?? null,
      metadata: data.metadata !== undefined ? JSON.stringify(data.metadata) : null,
      id,
    });
  },
};

export const findings = {
  create(data: {
    scan_id: string;
    title: string;
    description?: string | null;
    severity: string;
    cvss_score?: number | null;
    endpoint?: string | null;
    file_path?: string | null;
    cwe?: string | null;
    owasp?: string | null;
    exploited?: boolean;
    fix_guide_json?: FixGuide | null;
    ai_commentary?: string | null;
    confidence?: Confidence;
  }): Finding {
    const id = uuidv4();
    const created_at = new Date().toISOString();
    stmts.findings.insert.run({
      id,
      scan_id: data.scan_id,
      title: data.title,
      description: data.description ?? null,
      severity: data.severity,
      cvss_score: data.cvss_score ?? null,
      status: "new",
      endpoint: data.endpoint ?? null,
      file_path: data.file_path ?? null,
      cwe: data.cwe ?? null,
      owasp: data.owasp ?? null,
      exploited: data.exploited ? 1 : 0,
      fix_guide_json: data.fix_guide_json ? JSON.stringify(data.fix_guide_json) : null,
      ai_commentary: data.ai_commentary ?? null,
      confidence: data.confidence ?? "tentative",
      created_at,
    });
    return mapFinding(stmts.findings.getById.get(id) as FindingRow);
  },

  get(id: string): Finding | null {
    const row = stmts.findings.getById.get(id) as FindingRow | undefined;
    return row ? mapFinding(row) : null;
  },

  list(scanId?: string): Finding[] {
    if (scanId !== undefined) {
      return (stmts.findings.listByScan.all(scanId) as FindingRow[]).map(
        mapFinding
      );
    }
    return (stmts.findings.list.all() as FindingRow[]).map(mapFinding);
  },

  update(
    id: string,
    data: Partial<Pick<Finding, "status" | "ai_commentary" | "fix_guide_json" | "browser_evidence_json" | "exploited" | "confidence">>
  ): void {
    stmts.findings.update.run({
      status: data.status ?? null,
      ai_commentary: data.ai_commentary ?? null,
      fix_guide_json:
        data.fix_guide_json !== undefined
          ? JSON.stringify(data.fix_guide_json)
          : null,
      browser_evidence_json:
        data.browser_evidence_json !== undefined
          ? JSON.stringify(data.browser_evidence_json)
          : null,
      exploited:
        data.exploited !== undefined
          ? (data.exploited ? 1 : 0)
          : null,
      confidence: data.confidence ?? null,
      id,
    });
  },
};

export const agentLog = {
  insert(data: {
    scan_id: string;
    phase: string;
    message: string;
    metadata?: Record<string, unknown>;
  }): AgentLogEntry {
    const id = uuidv4();
    const timestamp = new Date().toISOString();
    stmts.agentLog.insert.run({
      id,
      scan_id: data.scan_id,
      timestamp,
      phase: data.phase,
      message: data.message,
      metadata: JSON.stringify(data.metadata ?? {}),
    });
    return mapAgentLog(stmts.agentLog.getById.get(id) as AgentLogRow);
  },

  getByScan(scanId: string, afterTimestamp?: string): AgentLogEntry[] {
    if (afterTimestamp !== undefined) {
      return (
        stmts.agentLog.getByScanAfter.all(
          scanId,
          afterTimestamp
        ) as AgentLogRow[]
      ).map(mapAgentLog);
    }
    return (stmts.agentLog.getByScan.all(scanId) as AgentLogRow[]).map(
      mapAgentLog
    );
  },

  getLastN(scanId: string, n: number): AgentLogEntry[] {
    return (stmts.agentLog.getLastN.all(scanId, n) as AgentLogRow[]).map(
      mapAgentLog
    );
  },
};

export const settings = {
  get(key: string): string | null {
    const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
    return row?.value ?? null;
  },

  set(key: string, value: string): void {
    db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
  },

  all(): Record<string, string> {
    const rows = db.prepare(`SELECT key, value FROM settings`).all() as { key: string; value: string }[];
    const result: Record<string, string> = {};
    for (const row of rows) result[row.key] = row.value;
    return result;
  },
};

// ── Scheduled Scans ──────────────────────────────────

const INTERVAL_MS: Record<string, number> = {
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

export function intervalToMs(schedule: ScheduleInterval): number {
  return INTERVAL_MS[schedule] ?? INTERVAL_MS["daily"]!;
}

interface ScheduledScanRow {
  id: string;
  url: string;
  scan_type: string;
  schedule: string;
  auth_headers: string;
  enabled: number;
  last_run_id: string | null;
  last_run_at: string | null;
  next_run_at: string;
  created_at: string;
  updated_at: string;
}

function mapScheduledScan(row: ScheduledScanRow): ScheduledScan {
  return {
    id: row.id,
    url: row.url,
    scan_type: row.scan_type as ScanType,
    schedule: row.schedule as ScheduleInterval,
    auth_headers: JSON.parse(row.auth_headers) as Record<string, string>,
    enabled: row.enabled === 1,
    last_run_id: row.last_run_id,
    last_run_at: row.last_run_at,
    next_run_at: row.next_run_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export const scheduledScans = {
  create(data: {
    url: string;
    scan_type: string;
    schedule: ScheduleInterval;
    auth_headers?: Record<string, string>;
  }): ScheduledScan {
    const id = uuidv4();
    const now = new Date().toISOString();
    const next_run_at = new Date(Date.now() + intervalToMs(data.schedule)).toISOString();
    db.prepare(
      `INSERT INTO scheduled_scans (id, url, scan_type, schedule, auth_headers, enabled, next_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
    ).run(id, data.url, data.scan_type, data.schedule, JSON.stringify(data.auth_headers ?? {}), next_run_at, now, now);
    return mapScheduledScan(
      db.prepare(`SELECT * FROM scheduled_scans WHERE id = ?`).get(id) as ScheduledScanRow
    );
  },

  get(id: string): ScheduledScan | null {
    const row = db.prepare(`SELECT * FROM scheduled_scans WHERE id = ?`).get(id) as ScheduledScanRow | undefined;
    return row ? mapScheduledScan(row) : null;
  },

  list(): ScheduledScan[] {
    return (
      db.prepare(`SELECT * FROM scheduled_scans ORDER BY created_at DESC`).all() as ScheduledScanRow[]
    ).map(mapScheduledScan);
  },

  update(id: string, data: Partial<Pick<ScheduledScan, "url" | "scan_type" | "enabled" | "schedule" | "auth_headers">>): void {
    const now = new Date().toISOString();
    const current = this.get(id);
    if (!current) return;

    const newSchedule = data.schedule ?? current.schedule;
    const recalcNext = data.schedule !== undefined && data.schedule !== current.schedule;
    const next_run_at = recalcNext
      ? new Date(Date.now() + intervalToMs(newSchedule)).toISOString()
      : current.next_run_at;

    db.prepare(
      `UPDATE scheduled_scans SET
        url = ?, scan_type = ?, enabled = ?, schedule = ?, auth_headers = ?, next_run_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      data.url ?? current.url,
      data.scan_type ?? current.scan_type,
      data.enabled !== undefined ? (data.enabled ? 1 : 0) : (current.enabled ? 1 : 0),
      newSchedule,
      data.auth_headers !== undefined ? JSON.stringify(data.auth_headers) : JSON.stringify(current.auth_headers),
      next_run_at,
      now,
      id,
    );
  },

  remove(id: string): void {
    db.prepare(`DELETE FROM scheduled_scans WHERE id = ?`).run(id);
  },

  getDue(): ScheduledScan[] {
    // Compare against JS-generated ISO timestamp to match the format stored by markRun/create
    // (SQLite datetime('now') uses 'YYYY-MM-DD HH:MM:SS' but we store 'YYYY-MM-DDTHH:MM:SS.mmmZ')
    const now = new Date().toISOString();
    return (
      db.prepare(
        `SELECT * FROM scheduled_scans WHERE enabled = 1 AND next_run_at <= ?`
      ).all(now) as ScheduledScanRow[]
    ).map(mapScheduledScan);
  },

  markRun(id: string, scanId: string, schedule: ScheduleInterval): void {
    const now = new Date().toISOString();
    const next_run_at = new Date(Date.now() + intervalToMs(schedule)).toISOString();
    db.prepare(
      `UPDATE scheduled_scans SET last_run_id = ?, last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?`
    ).run(scanId, now, next_run_at, now, id);
  },
};

// ── Shared Reports ──────────────────────────────────

interface SharedReportRow {
  id: string;
  scan_id: string;
  token: string;
  excluded_ids: string;
  expires_at: string | null;
  created_at: string;
}

export interface SharedReport {
  id: string;
  scan_id: string;
  token: string;
  excluded_ids: string[];
  expires_at: string | null;
  created_at: string;
}

function mapSharedReport(row: SharedReportRow): SharedReport {
  return {
    id: row.id,
    scan_id: row.scan_id,
    token: row.token,
    excluded_ids: JSON.parse(row.excluded_ids) as string[],
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}

export const sharedReports = {
  create(data: { scan_id: string; excluded_ids?: string[]; expires_at?: string | null }): SharedReport {
    const id = uuidv4();
    const token = uuidv4();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO shared_reports (id, scan_id, token, excluded_ids, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, data.scan_id, token, JSON.stringify(data.excluded_ids ?? []), data.expires_at ?? null, now);
    return mapSharedReport(
      db.prepare(`SELECT * FROM shared_reports WHERE id = ?`).get(id) as SharedReportRow
    );
  },

  getByToken(token: string): SharedReport | null {
    const row = db.prepare(`SELECT * FROM shared_reports WHERE token = ?`).get(token) as SharedReportRow | undefined;
    return row ? mapSharedReport(row) : null;
  },

  getByScanId(scanId: string): SharedReport | null {
    const row = db.prepare(`SELECT * FROM shared_reports WHERE scan_id = ? ORDER BY created_at DESC LIMIT 1`).get(scanId) as SharedReportRow | undefined;
    return row ? mapSharedReport(row) : null;
  },

  list(): SharedReport[] {
    return (
      db.prepare(`SELECT * FROM shared_reports ORDER BY created_at DESC`).all() as SharedReportRow[]
    ).map(mapSharedReport);
  },

  remove(id: string): void {
    db.prepare(`DELETE FROM shared_reports WHERE id = ?`).run(id);
  },
};
