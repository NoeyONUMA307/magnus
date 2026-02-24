import type { Scan, Finding, FindingStatus, AgentLogEntry, ScheduledScan, ScheduleInterval } from "../types/index";

const API_URL = import.meta.env.VITE_API_URL || "";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function getScans(): Promise<Scan[]> {
  return apiFetch<Scan[]>("/api/scans");
}

export function getScan(id: string): Promise<Scan> {
  return apiFetch<Scan>(`/api/scans/${id}`);
}

export function createScan(payload: {
  url: string;
  scan_type: "whitebox" | "blackbox";
  auth_headers?: Record<string, string>;
  openapi_spec?: Record<string, unknown>;
  write_probes_enabled?: boolean;
}): Promise<Scan> {
  return apiFetch<Scan>("/api/scans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getFindings(params?: { scan_id?: string }): Promise<Finding[]> {
  const query = params?.scan_id
    ? `?scan_id=${encodeURIComponent(params.scan_id)}`
    : "";
  return apiFetch<Finding[]>(`/api/findings${query}`);
}

export function getFindingsByScan(scanId: string): Promise<Finding[]> {
  return getFindings({ scan_id: scanId });
}

export function getLogs(scanId: string): Promise<AgentLogEntry[]> {
  return apiFetch<AgentLogEntry[]>(`/api/scans/${scanId}/logs`);
}

export function getSettings(): Promise<Record<string, string>> {
  return apiFetch<Record<string, string>>("/api/settings");
}

export function updateSetting(key: string, value: string): Promise<Record<string, string>> {
  return apiFetch<Record<string, string>>("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
}

export function getEvidenceUrl(scanId: string, findingId: string, filename: string): string {
  return `${API_URL}/api/evidence/${encodeURIComponent(scanId)}/${encodeURIComponent(findingId)}/${encodeURIComponent(filename)}`;
}

export function getScheduledScans(): Promise<ScheduledScan[]> {
  return apiFetch<ScheduledScan[]>("/api/scheduled-scans");
}

export function createScheduledScan(payload: {
  url: string;
  scan_type: "whitebox" | "blackbox";
  schedule: ScheduleInterval;
  auth_headers?: Record<string, string>;
}): Promise<ScheduledScan> {
  return apiFetch<ScheduledScan>("/api/scheduled-scans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateScheduledScan(
  id: string,
  data: { url?: string; scan_type?: string; enabled?: boolean; schedule?: ScheduleInterval; auth_headers?: Record<string, string> },
): Promise<ScheduledScan> {
  return apiFetch<ScheduledScan>(`/api/scheduled-scans/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function deleteScheduledScan(id: string): Promise<void> {
  return apiFetch<void>(`/api/scheduled-scans/${id}`, { method: "DELETE" });
}

export function updateFindingStatus(id: string, status: FindingStatus): Promise<Finding> {
  return apiFetch<Finding>(`/api/findings/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

export interface ScanDiff {
  previous_scan_id: string | null;
  new_ids: string[];
  unchanged_ids: string[];
  fixed: Finding[];
  min_severity: string;
}

export function getScanDiff(scanId: string): Promise<ScanDiff> {
  return apiFetch<ScanDiff>(`/api/scans/${scanId}/diff`);
}

export function testWebhook(): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/api/integrations/test-webhook", { method: "POST" });
}

export interface SharedReport {
  id: string;
  scan_id: string;
  token: string;
  url: string;
  excluded_ids: string[];
  expires_at: string | null;
  created_at: string;
}

export function createSharedReport(payload: {
  scan_id: string;
  excluded_ids?: string[];
  expires_in?: string;
}): Promise<SharedReport> {
  return apiFetch<SharedReport>("/api/shared-reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getSharedReports(): Promise<SharedReport[]> {
  return apiFetch<SharedReport[]>("/api/shared-reports");
}

export function deleteSharedReport(id: string): Promise<void> {
  return apiFetch<void>(`/api/shared-reports/${id}`, { method: "DELETE" });
}

export function testGithub(): Promise<{ ok: boolean; login: string }> {
  return apiFetch<{ ok: boolean; login: string }>("/api/integrations/test-github", { method: "POST" });
}

export function getOllamaModels(): Promise<{
  models: { id: string; name: string; size: string }[];
  available: boolean;
}> {
  return apiFetch("/api/ollama/models");
}
