import { scans, findings, settings } from "./db.js";
import type { Finding } from "../types/index.js";

const DISMISSED = new Set(["dismissed", "accepted_risk"]);
const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
const COMMENT_SIGNATURE = "<!-- magnus-scan -->";

function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function normalizeEndpoint(ep: string | null): string {
  if (!ep) return "";
  try { return new URL(ep, "http://x").pathname; } catch { return ep.split("?")[0]; }
}

function fingerprint(f: { severity: string; endpoint: string | null; file_path: string | null; cwe: string | null }, isWhitebox: boolean): string {
  const ep = isWhitebox ? (f.file_path ?? "") : normalizeEndpoint(f.endpoint);
  return `${f.severity}||${ep}||${f.cwe ?? ""}`;
}

function computeDiff(scanId: string, scanUrl: string, scanType: string, active: Finding[]): { newCount: number; fixedCount: number } | null {
  const prev = scans.previousCompleted(scanUrl, scanId);
  if (!prev) return null;
  const prevFindings = findings.list(prev.id).filter((f) => !DISMISSED.has(f.status));
  const isWhitebox = scanType === "whitebox";
  const prevSet = new Set(prevFindings.map((f) => fingerprint(f, isWhitebox)));
  const currSet = new Set(active.map((f) => fingerprint(f, isWhitebox)));
  const newCount = active.filter((f) => !prevSet.has(fingerprint(f, isWhitebox))).length;
  const fixedCount = prevFindings.filter((f) => !currSet.has(fingerprint(f, isWhitebox))).length;
  return (newCount > 0 || fixedCount > 0) ? { newCount, fixedCount } : null;
}

export async function notifyScanComplete(scanId: string): Promise<void> {
  const webhookUrl = settings.get("webhook_url");
  if (!webhookUrl) return;

  try {
    const scan = scans.get(scanId);
    if (!scan) return;

    const allFindings = findings.list(scanId);
    const active = allFindings.filter((f) => !DISMISSED.has(f.status));

    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of active) {
      if (f.severity in counts) counts[f.severity as keyof typeof counts] += 1;
    }

    const minSev = settings.get("min_severity") ?? "low";
    const minRank = SEV_RANK[minSev] ?? 1;
    const pass = scan.status === "complete"
      ? !active.some((f) => (SEV_RANK[f.severity] ?? 0) >= minRank)
      : false;

    const status = scan.status === "complete" ? "complete" : "failed";
    const passLabel = scan.status === "complete" ? (pass ? "PASS" : "FAIL") : "FAILED";
    const riskLabel = scan.risk_score !== null ? `${scan.risk_score.toFixed(1)}/10` : "N/A";
    const host = hostname(scan.url);

    let diffLine = "";
    if (scan.status === "complete") {
      const diff = computeDiff(scanId, scan.url, scan.scan_type, active);
      if (diff) {
        diffLine = `\n${diff.newCount} new · ${diff.fixedCount} fixed since last scan`;
      }
    }

    const lines = [
      `Magnus scan ${status}: ${host}`,
      `Status: ${status} | Risk: ${riskLabel} | ${passLabel}`,
      `Critical: ${counts.critical} | High: ${counts.high} | Medium: ${counts.medium} | Low: ${counts.low}`,
    ];
    if (diffLine) lines.push(diffLine.trim());

    const message = lines.join("\n");

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message, content: message }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[notify] Webhook failed: ${msg}`);
  }
}

export async function notifyGithubPR(scanId: string): Promise<void> {
  const token = settings.get("github_token");
  if (!token) return;

  try {
    const scan = scans.get(scanId);
    if (!scan) return;

    const githubRepo = scan.metadata.github_repo as string | undefined;
    const prNumber = scan.metadata.pr_number as number | undefined;
    if (!githubRepo || !prNumber) return;

    const allFindings = findings.list(scanId);
    const active = allFindings.filter((f) => !DISMISSED.has(f.status));

    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of active) {
      if (f.severity in counts) counts[f.severity as keyof typeof counts] += 1;
    }

    const minSev = settings.get("min_severity") ?? "low";
    const minRank = SEV_RANK[minSev] ?? 1;
    const pass = scan.status === "complete"
      ? !active.some((f) => (SEV_RANK[f.severity] ?? 0) >= minRank)
      : false;

    const riskLabel = scan.risk_score !== null ? `${scan.risk_score.toFixed(1)}/10` : "N/A";
    const passLabel = scan.status === "complete" ? (pass ? "PASS" : "FAIL") : "FAILED";
    const passEmoji = pass ? "\u2705" : "\u274C";
    const host = hostname(scan.url);

    let diffLine = "";
    if (scan.status === "complete") {
      const diff = computeDiff(scanId, scan.url, scan.scan_type, active);
      if (diff) {
        diffLine = `\n> ${diff.newCount} new \u00b7 ${diff.fixedCount} fixed since previous scan\n`;
      }
    }

    // Top 3 findings by CVSS
    const top3 = [...active]
      .sort((a, b) => (b.cvss_score ?? 0) - (a.cvss_score ?? 0))
      .slice(0, 3);
    let top3Section = "";
    if (top3.length > 0) {
      top3Section = "\n### Top Findings\n\n";
      for (const f of top3) {
        const sevBadge = f.severity.toUpperCase();
        const cvss = f.cvss_score !== null ? ` (CVSS ${f.cvss_score.toFixed(1)})` : "";
        const exploited = f.exploited ? " \u26a0\ufe0f **Exploited**" : "";
        top3Section += `**${sevBadge}**${cvss}${exploited} ${f.title}\n`;
        if (f.endpoint) top3Section += `> Endpoint: \`${f.endpoint}\`\n`;
        if (f.fix_guide_json?.steps?.[0]) {
          top3Section += `> **Fix:** ${f.fix_guide_json.steps[0]}\n`;
        }
        top3Section += "\n";
      }
    }

    const magnusUrl = process.env.MAGNUS_URL ?? "http://localhost:5173";
    const body = [
      COMMENT_SIGNATURE,
      `## ${passEmoji} Magnus Security Scan \u2014 ${passLabel}`,
      "",
      `**Target:** ${host} | **Risk Score:** ${riskLabel} | **Type:** ${scan.scan_type} | **Findings:** ${active.length}`,
      "",
      "| Critical | High | Medium | Low | Info |",
      "|:--------:|:----:|:------:|:---:|:----:|",
      `| ${counts.critical} | ${counts.high} | ${counts.medium} | ${counts.low} | ${counts.info} |`,
      diffLine,
      top3Section,
      "---",
      `[View full scan details](${magnusUrl}/?scan=${scan.id})`,
    ].join("\n");

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const baseUrl = `https://api.github.com/repos/${githubRepo}/issues/${prNumber}`;

    // Search for existing Magnus comment
    const listRes = await fetch(`${baseUrl}/comments?per_page=100`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });

    if (!listRes.ok) {
      console.error(`[notify] GitHub list comments returned ${listRes.status}`);
      return;
    }

    const comments = (await listRes.json()) as Array<{ id: number; body: string }>;
    const existing = comments.find((c) => c.body.includes(COMMENT_SIGNATURE));

    if (existing) {
      await fetch(
        `https://api.github.com/repos/${githubRepo}/issues/comments/${existing.id}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ body }),
          signal: AbortSignal.timeout(15_000),
        },
      );
    } else {
      await fetch(`${baseUrl}/comments`, {
        method: "POST",
        headers,
        body: JSON.stringify({ body }),
        signal: AbortSignal.timeout(15_000),
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[notify] GitHub PR comment failed: ${msg}`);
  }
}
