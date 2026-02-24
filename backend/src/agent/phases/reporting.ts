import { streamChat } from "../../lib/llm.js";
import { agentLog, findings as findingsDb, scans } from "../../lib/db.js";
import { SYSTEM_PROMPT } from "../prompts/system.js";
import type { Finding } from "../../types/index.js";
import type { TokenAccumulator } from "../../lib/tokens.js";

interface ReportSummary {
  risk_score: number;
  finding_count: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  info_count: number;
  executive_summary: string;
  attack_narrative: string;
}

function calculateRiskScore(scanFindings: Finding[]): number {
  if (scanFindings.length === 0) return 0;

  const weights: Record<string, number> = {
    critical: 10,
    high: 7,
    medium: 4,
    low: 1,
    info: 0,
  };

  const total = scanFindings.reduce(
    (sum, f) => sum + (weights[f.severity] ?? 0),
    0
  );
  const maxPossible = scanFindings.length * 10;
  return Math.min(10, parseFloat(((total / maxPossible) * 10).toFixed(1)));
}

function buildCommentaryPrompt(finding: Finding): string {
  return `## Reporting Phase — AI Commentary

Generate a concise security advisory paragraph (3–5 sentences) for a developer or security team. Cover:
- What the vulnerability is and why it matters in this context
- The realistic impact if exploited
- Recommended remediation

Finding:
\`\`\`json
${JSON.stringify(
  {
    title: finding.title,
    description: finding.description,
    severity: finding.severity,
    cvss_score: finding.cvss_score,
    endpoint: finding.endpoint,
    cwe: finding.cwe,
    owasp: finding.owasp,
    exploited: finding.exploited,
  },
  null,
  2
)}
\`\`\`

Write only the commentary paragraph — plain prose, no JSON, no headers, no lists.`;
}

function buildReportPrompt(scanFindings: Finding[]): string {
  const findingSummaries = scanFindings.map((f) => ({
    title: f.title,
    severity: f.severity,
    cvss_score: f.cvss_score,
    endpoint: f.endpoint,
    exploited: f.exploited,
    description: f.description,
  }));

  return `## Reporting Phase — Executive Summary

You have completed a full security scan. Below are all findings. Synthesize them into an executive and technical summary.

### All Findings
\`\`\`json
${JSON.stringify(findingSummaries, null, 2)}
\`\`\`

### Your Tasks

1. **Executive Summary** (3–5 sentences, non-technical): What was found, how serious is it, what should leadership prioritize?

2. **Attack Narrative**: Tell the story of the worst-case attack chain. Start from initial access and trace through to maximum impact. Use plain English.

3. **Positive Observations**: What security controls were in place? What was done well?

Emit your output as JSON:

\`\`\`json
{
  "executive_summary": "3-5 sentence non-technical summary",
  "attack_narrative": "Step-by-step worst-case attack story",
  "positive_observations": ["observation 1", "observation 2"],
  "top_priorities": ["Fix #1 — why it is urgent", "Fix #2", "Fix #3"]
}
\`\`\``;
}

function extractJsonBlock(text: string): Record<string, unknown> | null {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function runReporting(
  scanId: string,
  passedFindings: Finding[],
  tokens?: TokenAccumulator,
): Promise<ReportSummary> {
  const phase = "reporting";

  // Prefer DB findings to ensure latest state
  const dbFindings = findingsDb.list(scanId);
  const allFindings = dbFindings.length > 0 ? dbFindings : passedFindings;

  await agentLog.insert({
    scan_id: scanId,
    phase,
    message: `Starting reporting phase for ${allFindings.length} finding(s)`,
    metadata: { finding_count: allFindings.length },
  });

  // Generate AI commentary for critical/high findings that don't already have it
  const actionableFindings = allFindings.filter(
    (f) => (f.severity === "critical" || f.severity === "high") && !f.ai_commentary
  );

  for (const finding of actionableFindings) {
    await agentLog.insert({
      scan_id: scanId,
      phase,
      message: `Generating AI commentary for: ${finding.title}`,
      metadata: { finding_id: finding.id, severity: finding.severity },
    });

    const { stream: commentaryStream, getUsage: getCommentaryUsage } = await streamChat(SYSTEM_PROMPT, buildCommentaryPrompt(finding));
    let commentary = "";

    for await (const chunk of commentaryStream) {
      if (
        chunk.type === "content_block_delta" &&
        chunk.delta.type === "text_delta"
      ) {
        commentary += chunk.delta.text;
      }
    }

    tokens?.add(await getCommentaryUsage());
    commentary = commentary.trim();
    findingsDb.update(finding.id, { ai_commentary: commentary });
  }

  // Generate executive summary and attack narrative
  let executiveSummary = "";
  let attackNarrative = "";

  if (allFindings.length > 0) {
    await agentLog.insert({
      scan_id: scanId,
      phase,
      message: "Generating executive summary and attack narrative",
      metadata: {},
    });

    const { stream: reportStream, getUsage: getReportUsage } = await streamChat(SYSTEM_PROMPT, buildReportPrompt(allFindings));
    let fullText = "";
    let buffer = "";

    for await (const chunk of reportStream) {
      if (
        chunk.type === "content_block_delta" &&
        chunk.delta.type === "text_delta"
      ) {
        const text = chunk.delta.text;
        fullText += text;
        buffer += text;

        if (buffer.length >= 300) {
          await agentLog.insert({
            scan_id: scanId,
            phase,
            message: buffer.trim(),
            metadata: { chunk: true },
          });
          buffer = "";
        }
      }
    }

    if (buffer.trim().length > 0) {
      await agentLog.insert({
        scan_id: scanId,
        phase,
        message: buffer.trim(),
        metadata: { chunk: true },
      });
    }

    tokens?.add(await getReportUsage());

    const reportJson = extractJsonBlock(fullText);
    if (reportJson) {
      executiveSummary =
        typeof reportJson["executive_summary"] === "string"
          ? reportJson["executive_summary"]
          : "";
      attackNarrative =
        typeof reportJson["attack_narrative"] === "string"
          ? reportJson["attack_narrative"]
          : "";
    }
  }

  const riskScore = calculateRiskScore(allFindings);

  const counts = allFindings.reduce(
    (acc, f) => {
      acc[f.severity] = (acc[f.severity] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const summary: ReportSummary = {
    risk_score: riskScore,
    finding_count: allFindings.length,
    critical_count: counts["critical"] ?? 0,
    high_count: counts["high"] ?? 0,
    medium_count: counts["medium"] ?? 0,
    low_count: counts["low"] ?? 0,
    info_count: counts["info"] ?? 0,
    executive_summary: executiveSummary,
    attack_narrative: attackNarrative,
  };

  scans.update(scanId, { risk_score: riskScore });

  await agentLog.insert({
    scan_id: scanId,
    phase,
    message: `Reporting complete — risk score: ${riskScore}/10`,
    metadata: summary as unknown as Record<string, unknown>,
  });

  return summary;
}
