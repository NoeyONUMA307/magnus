import { scans, agentLog, findings as findingsDb } from "../lib/db.js";
import { runRecon } from "./phases/recon.js";
import { runPlanning } from "./phases/planning.js";
import { runExploitation } from "./phases/exploitation.js";
import { runReporting } from "./phases/reporting.js";
import { runBrowserConfirm } from "./phases/browser-confirm.js";
import { getActiveModel } from "../lib/llm.js";
import { notifyScanComplete, notifyGithubPR } from "../lib/notify.js";
import { TokenAccumulator } from "../lib/tokens.js";
import type { ScanType } from "../types/index.js";

function fallbackRiskScore(scanId: string): number {
  const all = findingsDb.list(scanId);
  if (all.length === 0) return 0;
  const weights: Record<string, number> = { critical: 10, high: 8, medium: 5, low: 2, info: 0 };

  // Base: highest single finding severity
  const maxWeight = Math.max(...all.map((f) => weights[f.severity] ?? 0));

  // Boost: count of serious findings (critical/high/medium) adds up to +2
  const serious = all.filter((f) => weights[f.severity]! >= 4).length;
  const boost = Math.min(2, serious * 0.5);

  return Math.min(10, parseFloat((maxWeight + boost).toFixed(1)));
}

export async function runScan(
  scanId: string,
  url: string,
  scanType: ScanType
): Promise<void> {
  // Read auth headers from scan metadata (stored at creation time)
  const scanRecord = scans.get(scanId);
  const authHeaders = (scanRecord?.metadata?.auth_headers ?? undefined) as Record<string, string> | undefined;
  const openapiSpec = (scanRecord?.metadata?.openapi_spec ?? undefined) as Record<string, unknown> | undefined;
  const writeProbesEnabled = scanRecord?.metadata?.write_probes_enabled === true;
  const isAuthenticated = authHeaders !== undefined && Object.keys(authHeaders).length > 0;

  // Strip openapi_spec from stored metadata — it's consumed once during recon
  // and shouldn't bloat every GET /api/scans response
  const cleanMeta = { ...(scanRecord?.metadata ?? {}) };
  delete cleanMeta.openapi_spec;

  scans.update(scanId, {
    status: "running",
    started_at: new Date().toISOString(),
    metadata: cleanMeta,
  });

  await agentLog.insert({
    scan_id: scanId,
    phase: "recon",
    message: `Scan started — model: ${getActiveModel()}${isAuthenticated ? " (authenticated)" : ""}${openapiSpec ? " (with OpenAPI spec)" : ""}${writeProbesEnabled ? " (write probes enabled)" : ""}`,
    metadata: {
      url,
      scan_type: scanType,
      // Log header names only, never values
      ...(isAuthenticated ? { auth_header_names: Object.keys(authHeaders) } : {}),
    },
  });

  const tokens = new TokenAccumulator();

  try {
    // Phase 1: Recon
    await agentLog.insert({
      scan_id: scanId,
      phase: "recon",
      message: "Beginning recon phase",
      metadata: {},
    });

    const recon = await runRecon(scanId, url, scanType, authHeaders, openapiSpec, tokens);

    await agentLog.insert({
      scan_id: scanId,
      phase: "recon",
      message: "Recon phase complete",
      metadata: {
        endpoint_count: Array.isArray(recon.claudeAnalysis["endpoints"])
          ? recon.claudeAnalysis["endpoints"].length
          : 0,
        finding_candidates: Array.isArray(recon.claudeAnalysis["finding_candidates"])
          ? recon.claudeAnalysis["finding_candidates"].length
          : 0,
      },
    });

    // Phase 2: Planning
    await agentLog.insert({
      scan_id: scanId,
      phase: "planning",
      message: "Beginning planning phase",
      metadata: {},
    });

    const attackPlan = await runPlanning(scanId, url, recon, isAuthenticated, writeProbesEnabled, tokens);

    await agentLog.insert({
      scan_id: scanId,
      phase: "planning",
      message: "Planning phase complete",
      metadata: { chain_count: attackPlan.attack_chains.length },
    });

    // Phase 3: Exploitation
    await agentLog.insert({
      scan_id: scanId,
      phase: "exploitation",
      message: "Beginning exploitation phase",
      metadata: {},
    });

    const exploitFindings = await runExploitation(
      scanId,
      url,
      attackPlan,
      recon.httpData,
      authHeaders,
      writeProbesEnabled,
      tokens,
    );

    await agentLog.insert({
      scan_id: scanId,
      phase: "exploitation",
      message: "Exploitation phase complete",
      metadata: { finding_count: exploitFindings.length },
    });

    // Phase 3.5: Browser Confirmation (non-fatal)
    let confirmedFindings = exploitFindings;
    try {
      confirmedFindings = await runBrowserConfirm(scanId, exploitFindings, tokens);
    } catch (confirmErr) {
      const msg = confirmErr instanceof Error ? confirmErr.message : String(confirmErr);
      agentLog.insert({
        scan_id: scanId,
        phase: "browser-confirm",
        message: `Browser confirmation failed (non-fatal): ${msg}`,
        metadata: { error: msg },
      });
    }

    // Phase 4: Reporting (non-fatal — findings already saved)
    await agentLog.insert({
      scan_id: scanId,
      phase: "reporting",
      message: "Beginning reporting phase",
      metadata: {},
    });

    let report: Awaited<ReturnType<typeof runReporting>> | null = null;
    try {
      report = await runReporting(scanId, confirmedFindings, tokens);

      await agentLog.insert({
        scan_id: scanId,
        phase: "reporting",
        message: "Reporting phase complete",
        metadata: { risk_score: report.risk_score },
      });
    } catch (reportErr) {
      const msg = reportErr instanceof Error ? reportErr.message : String(reportErr);
      await agentLog.insert({
        scan_id: scanId,
        phase: "reporting",
        message: `Reporting phase failed (non-fatal): ${msg}`,
        metadata: { error: msg },
      });
    }

    // Calculate risk score from DB findings as fallback
    const riskScore = report?.risk_score ?? fallbackRiskScore(scanId);
    const tokenUsage = tokens.summarize(getActiveModel());

    scans.update(scanId, {
      status: "complete",
      completed_at: new Date().toISOString(),
      risk_score: riskScore,
      metadata: {
        ...(isAuthenticated ? { auth_headers: authHeaders } : {}),
        ...(writeProbesEnabled ? { write_probes_enabled: true } : {}),
        executive_summary: report?.executive_summary ?? "",
        attack_narrative: report?.attack_narrative ?? "",
        token_usage: tokenUsage,
      },
    });

    await agentLog.insert({
      scan_id: scanId,
      phase: "reporting",
      message: "Scan complete",
      metadata: {
        risk_score: riskScore,
        finding_count: report?.finding_count ?? confirmedFindings.length,
        critical: report?.critical_count ?? 0,
        high: report?.high_count ?? 0,
        medium: report?.medium_count ?? 0,
        low: report?.low_count ?? 0,
      },
    });

    notifyScanComplete(scanId).catch((e) =>
      console.error(`[notify] webhook error: ${e instanceof Error ? e.message : e}`));
    notifyGithubPR(scanId).catch((e) =>
      console.error(`[notify] github PR error: ${e instanceof Error ? e.message : e}`));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    scans.update(scanId, {
      status: "failed",
      completed_at: new Date().toISOString(),
    });

    await agentLog.insert({
      scan_id: scanId,
      phase: "reporting",
      message: `Scan failed: ${message}`,
      metadata: { error: message },
    });

    notifyScanComplete(scanId).catch((e) =>
      console.error(`[notify] webhook error: ${e instanceof Error ? e.message : e}`));
    notifyGithubPR(scanId).catch((e) =>
      console.error(`[notify] github PR error: ${e instanceof Error ? e.message : e}`));
  }
}
