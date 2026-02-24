import { Router } from "express";
import type { Request, Response } from "express";
import { scans, findings, sharedReports } from "../lib/db.js";
import type { Finding } from "../types/index.js";

// ── HTML helpers ──────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function sevColor(severity: string): string {
  switch (severity) {
    case "critical": return "#C0392B";
    case "high":     return "#B84C00";
    case "medium":   return "#8A6900";
    case "low":      return "#1A6490";
    default:         return "#A8A7A2";
  }
}

function sevBg(severity: string): string {
  switch (severity) {
    case "critical": return "#FBF3F2";
    case "high":     return "#FCF5ED";
    case "medium":   return "#FBF8ED";
    case "low":      return "#EFF6FA";
    default:         return "#F5F5F4";
  }
}

function scoreColor(score: number): string {
  if (score >= 8) return "#C0392B";
  if (score >= 6) return "#B84C00";
  if (score >= 4) return "#8A6900";
  return "#276241";
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

// ── Report renderer ───────────────────────────────────────────────────────────

interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

function renderFindingCard(f: Finding): string {
  const color = sevColor(f.severity);
  const bg = sevBg(f.severity);
  const cvss = f.cvss_score !== null ? f.cvss_score.toFixed(1) : "—";
  const exploitedTag = f.exploited
    ? `<span style="background:#FBF3F2;color:#C0392B;border:1px solid #C0392B;border-radius:4px;font-size:11px;padding:2px 8px;font-weight:600;letter-spacing:.3px;">EXPLOITED</span>`
    : "";
  const confLabel = f.confidence === "confirmed" ? "Confirmed" : f.confidence === "firm" ? "Firm" : "Suspected";
  const confStyle = f.confidence === "confirmed"
    ? "background:#E7F6EC;color:#276241;"
    : f.confidence === "firm"
      ? "background:#F5F5F4;color:#6B6A66;"
      : "background:#FFFFFF;color:#A8A7A2;border:1px solid #E8E7E3;";
  const confTag = `<span style="${confStyle}border-radius:4px;font-size:10px;padding:2px 6px;font-weight:600;letter-spacing:.3px;text-transform:uppercase;">${confLabel}</span>`;

  const metaParts: string[] = [];
  if (f.endpoint) metaParts.push(`Endpoint: ${escapeHtml(f.endpoint)}`);
  if (f.cwe)      metaParts.push(escapeHtml(f.cwe));
  if (f.owasp)    metaParts.push(escapeHtml(f.owasp));
  const metaLine = metaParts.length > 0
    ? `<p style="font-size:12px;color:#6B6A66;margin:8px 0 0;">${metaParts.join(" &nbsp;·&nbsp; ")}</p>`
    : "";

  const description = f.description
    ? `<p style="font-size:14px;color:#323230;margin:12px 0 0;line-height:1.6;">${escapeHtml(f.description)}</p>`
    : "";

  let fixGuide = "";
  if (f.fix_guide_json && f.fix_guide_json.steps.length > 0) {
    const steps = f.fix_guide_json.steps
      .map((s) => `<li style="margin-bottom:6px;">${escapeHtml(s)}</li>`)
      .join("");
    fixGuide = `
      <div style="margin-top:16px;background:#F7F6F3;border-radius:6px;padding:14px 18px;">
        <p style="font-size:12px;font-weight:600;color:#6B6A66;margin:0 0 10px;text-transform:uppercase;letter-spacing:.5px;">Remediation</p>
        <ol style="margin:0;padding-left:20px;font-size:13px;color:#323230;line-height:1.6;">${steps}</ol>
      </div>`;
  }

  return `
    <div style="background:#FFFFFF;border:1px solid #E8E7E3;border-radius:8px;padding:20px 24px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span style="background:${bg};color:${color};border:1px solid ${color}33;border-radius:4px;font-size:11px;padding:2px 10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;">${escapeHtml(f.severity)}</span>
        <span style="font-size:13px;color:#6B6A66;font-weight:600;">CVSS&nbsp;${cvss}</span>
        ${confTag}
        ${exploitedTag}
      </div>
      <h3 style="font-size:16px;font-weight:700;color:#191918;margin:12px 0 0;">${escapeHtml(f.title)}</h3>
      ${metaLine}
      ${description}
      ${fixGuide}
    </div>`;
}

function renderReport(
  scan: { url: string; scan_type: string; risk_score: number | null; completed_at: string | null; metadata: Record<string, unknown> },
  visibleFindings: Finding[],
  counts: SeverityCounts,
): string {
  const host = hostname(scan.url);
  const riskScore = scan.risk_score ?? 0;
  const ringColor = scoreColor(riskScore);
  const scanDate = scan.completed_at ? formatDate(scan.completed_at) : "In progress";
  const scanTypeLabel = scan.scan_type === "whitebox" ? "Whitebox" : "Blackbox";

  const summaryCard = typeof scan.metadata.executive_summary === "string" && scan.metadata.executive_summary
    ? `<section style="margin-bottom:32px;">
        <h2 style="font-size:14px;font-weight:700;color:#6B6A66;text-transform:uppercase;letter-spacing:.6px;margin:0 0 12px;">Executive Summary</h2>
        <div style="background:#FFFFFF;border:1px solid #E8E7E3;border-radius:8px;padding:20px 24px;font-size:14px;color:#323230;line-height:1.7;">
          ${escapeHtml(scan.metadata.executive_summary)}
        </div>
      </section>`
    : "";

  const findingCards = visibleFindings.length > 0
    ? visibleFindings.map(renderFindingCard).join("")
    : `<p style="color:#6B6A66;font-size:14px;text-align:center;padding:32px 0;">No findings to display.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Security Report — ${escapeHtml(host)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      background: #F7F6F3;
      color: #323230;
    }
    a { color: inherit; }
    @media (max-width: 600px) {
      .stat-grid { flex-direction: column !important; }
      .stat-box  { flex: 1 1 100% !important; }
      .meta-row  { flex-direction: column !important; gap: 8px !important; }
    }
  </style>
</head>
<body>
  <!-- Header -->
  <header style="background:#191918;padding:0 32px;display:flex;align-items:center;justify-content:space-between;height:56px;">
    <span style="color:#FFFFFF;font-weight:700;font-size:17px;letter-spacing:-.2px;">Magnus</span>
    <span style="color:#A8A7A2;font-size:12px;letter-spacing:.3px;text-transform:uppercase;">Security Assessment Report</span>
  </header>

  <main style="max-width:900px;margin:0 auto;padding:40px 24px 80px;">

    <!-- Target info -->
    <section style="display:flex;align-items:flex-start;justify-content:space-between;gap:24px;flex-wrap:wrap;margin-bottom:36px;">
      <div>
        <h1 style="font-size:26px;font-weight:800;color:#191918;margin:0 0 8px;">${escapeHtml(host)}</h1>
        <div class="meta-row" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
          <span style="font-size:13px;color:#6B6A66;background:#FFFFFF;border:1px solid #E8E7E3;border-radius:4px;padding:3px 10px;">${escapeHtml(scanTypeLabel)} scan</span>
          <span style="font-size:13px;color:#6B6A66;">${escapeHtml(scanDate)}</span>
          <span style="font-size:13px;color:#6B6A66;word-break:break-all;">${escapeHtml(scan.url)}</span>
        </div>
      </div>
      <div style="text-align:center;flex-shrink:0;">
        <div style="width:72px;height:72px;border-radius:50%;border:3px solid ${ringColor};display:flex;align-items:center;justify-content:center;background:#FFFFFF;">
          <span style="font-size:22px;font-weight:800;color:${ringColor};">${riskScore > 0 ? riskScore.toFixed(1) : "—"}</span>
        </div>
        <p style="font-size:11px;color:#6B6A66;margin:6px 0 0;text-transform:uppercase;letter-spacing:.4px;">Risk score</p>
      </div>
    </section>

    <!-- Severity summary -->
    <section style="margin-bottom:36px;">
      <div class="stat-grid" style="display:flex;gap:12px;flex-wrap:wrap;">
        ${(["critical", "high", "medium", "low", "info"] as const).map((sev) => `
        <div class="stat-box" style="flex:1 1 0;min-width:120px;background:#FFFFFF;border:1px solid #E8E7E3;border-top:3px solid ${sevColor(sev)};border-radius:8px;padding:16px 20px;">
          <p style="font-size:11px;color:#6B6A66;text-transform:uppercase;letter-spacing:.5px;margin:0 0 6px;font-weight:600;">${sev.charAt(0).toUpperCase() + sev.slice(1)}</p>
          <p style="font-size:28px;font-weight:800;color:${sevColor(sev)};margin:0;">${counts[sev]}</p>
        </div>`).join("")}
      </div>
    </section>

    ${summaryCard}

    <!-- Findings -->
    <section>
      <h2 style="font-size:14px;font-weight:700;color:#6B6A66;text-transform:uppercase;letter-spacing:.6px;margin:0 0 16px;">Findings</h2>
      ${findingCards}
    </section>

  </main>

  <!-- Footer -->
  <footer style="border-top:1px solid #E8E7E3;padding:20px 32px;text-align:center;font-size:12px;color:#A8A7A2;background:#FFFFFF;">
    Powered by <a href="https://github.com/carolinacherry/magnus" target="_blank" rel="noopener noreferrer" style="color:#323230;font-weight:600;text-decoration:none;">Magnus</a> — open-source AI security scanning
  </footer>
</body>
</html>`;
}

function renderErrorPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)} — Magnus</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      background: #F7F6F3;
      color: #323230;
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }
  </style>
</head>
<body>
  <header style="background:#191918;padding:0 32px;display:flex;align-items:center;height:56px;">
    <span style="color:#FFFFFF;font-weight:700;font-size:17px;letter-spacing:-.2px;">Magnus</span>
  </header>
  <main style="flex:1;display:flex;align-items:center;justify-content:center;padding:40px 24px;">
    <div style="text-align:center;max-width:420px;">
      <h1 style="font-size:22px;font-weight:800;color:#191918;margin:0 0 12px;">${escapeHtml(title)}</h1>
      <p style="font-size:14px;color:#6B6A66;margin:0;">${escapeHtml(message)}</p>
    </div>
  </main>
  <footer style="border-top:1px solid #E8E7E3;padding:20px 32px;text-align:center;font-size:12px;color:#A8A7A2;background:#FFFFFF;">
    Powered by <a href="https://github.com/carolinacherry/magnus" target="_blank" rel="noopener noreferrer" style="color:#323230;font-weight:600;text-decoration:none;">Magnus</a> — open-source AI security scanning
  </footer>
</body>
</html>`;
}

// ── Expiry helper ─────────────────────────────────────────────────────────────

type ExpiresIn = "24h" | "7d" | "30d" | "never";

function resolveExpiresAt(expiresIn: ExpiresIn | undefined): string | null {
  const now = Date.now();
  switch (expiresIn) {
    case "24h": return new Date(now + 24 * 60 * 60 * 1000).toISOString();
    case "7d":  return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
    case "30d": return new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
    default:    return null;
  }
}

// ── API router (mounted at /api/shared-reports) ───────────────────────────────

const shareApiRouter = Router();

// POST / — Create a share link
shareApiRouter.post("/", (req: Request, res: Response): void => {
  const { scan_id, excluded_ids, expires_in } = req.body as {
    scan_id?: unknown;
    excluded_ids?: unknown;
    expires_in?: unknown;
  };

  if (!scan_id || typeof scan_id !== "string") {
    res.status(400).json({ error: "scan_id is required and must be a string" });
    return;
  }

  if (excluded_ids !== undefined && !Array.isArray(excluded_ids)) {
    res.status(400).json({ error: "excluded_ids must be an array of strings" });
    return;
  }

  if (excluded_ids !== undefined && Array.isArray(excluded_ids)) {
    for (const id of excluded_ids) {
      if (typeof id !== "string") {
        res.status(400).json({ error: "excluded_ids must be an array of strings" });
        return;
      }
    }
  }

  const VALID_EXPIRES_IN = new Set(["24h", "7d", "30d", "never"]);
  if (expires_in !== undefined && (typeof expires_in !== "string" || !VALID_EXPIRES_IN.has(expires_in))) {
    res.status(400).json({ error: "expires_in must be '24h', '7d', '30d', or 'never'" });
    return;
  }

  try {
    const scan = scans.get(scan_id);
    if (!scan) {
      res.status(404).json({ error: "Scan not found" });
      return;
    }

    const expires_at = resolveExpiresAt(expires_in as ExpiresIn | undefined);

    const share = sharedReports.create({
      scan_id,
      excluded_ids: (excluded_ids as string[] | undefined) ?? [],
      expires_at,
    });

    const url = `${req.protocol}://${req.get("host")}/share/${share.token}`;

    res.status(201).json({
      id: share.id,
      scan_id: share.scan_id,
      token: share.token,
      url,
      excluded_ids: share.excluded_ids,
      expires_at: share.expires_at,
      created_at: share.created_at,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    res.status(500).json({ error: message });
  }
});

// GET / — List all shares
shareApiRouter.get("/", (_req: Request, res: Response): void => {
  try {
    const protocol = _req.protocol;
    const host = _req.get("host") ?? "";
    const list = sharedReports.list().map((share) => ({
      ...share,
      url: `${protocol}://${host}/share/${share.token}`,
    }));
    res.json(list);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    res.status(500).json({ error: message });
  }
});

// DELETE /:id — Revoke a share
shareApiRouter.delete("/:id", (req: Request<{ id: string }>, res: Response): void => {
  const { id } = req.params;

  try {
    sharedReports.remove(id);
    res.status(204).end();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    res.status(500).json({ error: message });
  }
});

// ── Public router (mounted at /share) ────────────────────────────────────────

export const shareRouter = Router();

// GET /:token — Server-rendered public report page
shareRouter.get("/:token", (req: Request<{ token: string }>, res: Response): void => {
  const { token } = req.params;

  try {
    const share = sharedReports.getByToken(token);
    if (!share) {
      res.status(404).send(renderErrorPage("Report Not Found", "This link is invalid or has been revoked."));
      return;
    }

    if (share.expires_at !== null && new Date(share.expires_at) < new Date()) {
      res.status(410).send(renderErrorPage("Report Expired", "This shared report link has expired."));
      return;
    }

    const scan = scans.get(share.scan_id);
    if (!scan) {
      res.status(404).send(renderErrorPage("Scan Not Found", "The scan associated with this report no longer exists."));
      return;
    }

    const excludedSet = new Set(share.excluded_ids);
    const HIDDEN_STATUSES = new Set(["dismissed", "accepted_risk"]);

    const allFindings = findings.list(share.scan_id);
    const visibleFindings = allFindings
      .filter((f) => !excludedSet.has(f.id) && !HIDDEN_STATUSES.has(f.status))
      .sort((a, b) => (b.cvss_score ?? 0) - (a.cvss_score ?? 0));

    const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of visibleFindings) {
      const sev = f.severity as keyof SeverityCounts;
      if (sev in counts) counts[sev]++;
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderReport(scan, visibleFindings, counts));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    res.status(500).send(renderErrorPage("Server Error", message));
  }
});

export default shareApiRouter;
