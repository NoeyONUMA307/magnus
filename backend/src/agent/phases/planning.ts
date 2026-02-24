import { agentLog } from "../../lib/db.js";
import { streamChat } from "../../lib/llm.js";
import { SYSTEM_PROMPT } from "../prompts/system.js";
import { buildPlanningPrompt } from "../prompts/planning.js";
import type { ReconResult } from "./recon.js";
import type { TokenAccumulator } from "../../lib/tokens.js";

interface SafeProbe {
  method: string;
  url: string;
  headers: Record<string, string>;
  expected_evidence: string;
}

export type WriteProbeCategory = "idor" | "auth_bypass" | "mass_assignment" | "csrf";

export interface WriteProbe {
  method: "POST" | "PUT" | "DELETE" | "PATCH";
  url: string;
  headers: Record<string, string>;
  body: string | null;
  content_type: string;
  expected_evidence: string;
  probe_category: WriteProbeCategory;
}

export interface AttackChain {
  id: string;
  target_endpoint: string;
  vulnerability_type: string;
  estimated_severity: string;
  estimated_cvss: number;
  rationale: string;
  attack_steps: string[];
  safe_probe: SafeProbe | null;
  write_probe: WriteProbe | null;
  idor_test_urls?: string[];
  prerequisites: string;
  chainable_with: string[];
  worst_case_impact: string;
}

interface DeprioritizedItem {
  target_endpoint: string;
  reason: string;
}

export interface AttackPlan {
  attack_chains: AttackChain[];
  attack_narrative: string;
  deprioritized: DeprioritizedItem[];
}

function extractJsonBlock(text: string): Record<string, unknown> | null {
  // Try complete fenced block first
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]) as Record<string, unknown>;
    } catch {
      // fall through to truncation repair
    }
  }

  // Handle truncated response: find ```json and extract everything after it
  const startIdx = text.indexOf("```json");
  if (startIdx === -1) return null;

  let jsonStr = text.slice(startIdx + 7).trim();
  // Remove trailing ``` if present
  if (jsonStr.endsWith("```")) {
    jsonStr = jsonStr.slice(0, -3).trim();
  }

  // Try parsing as-is
  try {
    return JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    // Try to repair truncated JSON by closing open structures
    const repaired = repairTruncatedJson(jsonStr);
    if (repaired) {
      try {
        return JSON.parse(repaired) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function repairTruncatedJson(json: string): string | null {
  // Find the last complete array element in attack_chains by looking for
  // the last complete object boundary
  const chainsMatch = json.match(/"attack_chains"\s*:\s*\[/);
  if (!chainsMatch) return null;

  const chainsStart = json.indexOf(chainsMatch[0]);
  const afterBracket = chainsStart + chainsMatch[0].length;

  // Track brace/bracket depth to find last complete object
  let depth = 0;
  let lastCompleteObj = -1;
  let inString = false;
  let escape = false;

  for (let i = afterBracket; i < json.length; i++) {
    const ch = json[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) lastCompleteObj = i;
    }
  }

  if (lastCompleteObj === -1) return null;

  // Truncate after last complete object, close the array and root object
  return json.slice(0, lastCompleteObj + 1) + "]}";
}

export async function runPlanning(
  scanId: string,
  url: string,
  recon: ReconResult,
  isAuthenticated = false,
  writeProbesEnabled = false,
  tokens?: TokenAccumulator,
): Promise<AttackPlan> {
  const phase = "planning";

  await agentLog.insert({
    scan_id: scanId,
    phase,
    message: `Generating adversarial attack plan from recon data${writeProbesEnabled ? " (write probes enabled)" : ""}`,
    metadata: { url, write_probes_enabled: writeProbesEnabled },
  });

  const prompt = buildPlanningPrompt(url, recon, isAuthenticated, writeProbesEnabled);
  const { stream, getUsage } = await streamChat(SYSTEM_PROMPT, prompt);

  let fullText = "";
  let buffer = "";
  const chunkSize = 300;

  for await (const chunk of stream) {
    if (
      chunk.type === "content_block_delta" &&
      chunk.delta.type === "text_delta"
    ) {
      const text = chunk.delta.text;
      fullText += text;
      buffer += text;

      if (buffer.length >= chunkSize) {
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

  tokens?.add(await getUsage());

  const parsed = extractJsonBlock(fullText);

  if (!parsed) {
    await agentLog.insert({
      scan_id: scanId,
      phase,
      message: "Planning complete — no structured attack plan found in response",
      metadata: { raw_length: fullText.length },
    });
    return { attack_chains: [], attack_narrative: "", deprioritized: [] };
  }

  const chains = Array.isArray(parsed["attack_chains"])
    ? (parsed["attack_chains"] as AttackChain[])
    : [];
  const narrative =
    typeof parsed["attack_narrative"] === "string"
      ? parsed["attack_narrative"]
      : "";

  await agentLog.insert({
    scan_id: scanId,
    phase,
    message: `Attack plan ready — ${chains.length} chain(s) queued for exploitation`,
    metadata: { chain_count: chains.length },
  });

  return {
    attack_chains: chains,
    attack_narrative: narrative,
    deprioritized: Array.isArray(parsed["deprioritized"])
      ? (parsed["deprioritized"] as DeprioritizedItem[])
      : [],
  };
}
