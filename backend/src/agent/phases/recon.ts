import { agentLog } from "../../lib/db.js";
import { safeFetch, MAX_BODY_BYTES } from "../../lib/http.js";
import { streamChat, getActiveModel } from "../../lib/llm.js";
import { SYSTEM_PROMPT } from "../prompts/system.js";
import { buildReconPrompt } from "../prompts/recon.js";
import type { ReconHttpData } from "../prompts/recon.js";
import type { ScanType } from "../../types/index.js";
import { extractEndpoints } from "../../lib/openapi.js";
import type { TokenAccumulator } from "../../lib/tokens.js";
import { crawl } from "../crawl.js";
import { browserCrawl } from "../browser-crawl.js";

export { safeFetch, MAX_BODY_BYTES } from "../../lib/http.js";

export interface ReconResult {
  httpData: ReconHttpData;
  claudeAnalysis: Record<string, unknown>;
  rawResponse: string;
}

const MAX_BUNDLE_BYTES = 500 * 1024;
const MAX_SCRIPT_URLS = 10;
const STREAM_CHUNK_SIZE = 300;

const COMMON_PATHS = [
  "/api",
  "/api/v1",
  "/api/health",
  "/health",
  "/.env",
  "/robots.txt",
  "/sitemap.xml",
  "/graphql",
  "/.git/HEAD",
  "/rest/v1/",
];

function extractScriptUrls(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const matches = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)];
  const urls: string[] = [];

  for (const match of matches) {
    const src = match[1];
    if (!src) continue;
    try {
      const resolved = new URL(src, base).href;
      urls.push(resolved);
    } catch {
      // skip malformed src values
    }
  }

  return urls;
}

interface BundleFinding {
  url: string;
  secrets: string[];
  supabaseUrls: string[];
  apiKeys: string[];
}

async function scanBundle(
  scriptUrl: string,
  scanId: string
): Promise<BundleFinding> {
  const result: BundleFinding = {
    url: scriptUrl,
    secrets: [],
    supabaseUrls: [],
    apiKeys: [],
  };

  const resp = await safeFetch(scriptUrl);
  if (!resp || !resp.ok) return result;

  const buffer = await resp.arrayBuffer().catch((e) => {
    console.error(`[recon] Failed to read bundle ${scriptUrl}: ${e instanceof Error ? e.message : e}`);
    return null;
  });
  if (!buffer) return result;

  const text = new TextDecoder().decode(
    new Uint8Array(buffer.slice(0, MAX_BUNDLE_BYTES))
  );

  const supabaseMatches = text.match(/https:\/\/[a-z0-9-]+\.supabase\.co/g);
  if (supabaseMatches) {
    result.supabaseUrls = [...new Set(supabaseMatches)];
  }

  const jwtMatches = text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g);
  if (jwtMatches) {
    result.secrets.push(...[...new Set(jwtMatches)].slice(0, 5));
  }

  const envLeaks = text.match(
    /(SUPABASE_|NEXT_PUBLIC_|REACT_APP_|VITE_)[A-Z_]+=["'][^"']+["']/g
  );
  if (envLeaks) {
    result.secrets.push(...[...new Set(envLeaks)].slice(0, 10));
  }

  const highEntropy = text.match(/[A-Za-z0-9+/=]{40,}/g);
  if (highEntropy) {
    // Deduplicate and limit to avoid noise from base64-encoded assets
    const unique = [...new Set(highEntropy)].slice(0, 5);
    result.secrets.push(...unique);
  }

  const apiKeyMatches = text.match(
    /(sk-ant-[A-Za-z0-9_-]+|sk_live_[A-Za-z0-9]+|pk_live_[A-Za-z0-9]+|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36})/g
  );
  if (apiKeyMatches) {
    result.apiKeys = [...new Set(apiKeyMatches)].slice(0, 10);
  }

  await agentLog.insert({
    scan_id: scanId,
    phase: "recon",
    message: `Scanned bundle: ${scriptUrl}`,
    metadata: {
      secrets_found: result.secrets.length,
      supabase_urls: result.supabaseUrls.length,
      api_keys: result.apiKeys.length,
    },
  });

  return result;
}

async function probeCommonPaths(
  baseUrl: string,
  scanId: string,
  authHeaders?: Record<string, string>
): Promise<Array<{ path: string; status: number | null; contentType: string | null }>> {
  const base = new URL(baseUrl);
  const results: Array<{
    path: string;
    status: number | null;
    contentType: string | null;
  }> = [];

  for (const path of COMMON_PATHS) {
    const targetUrl = new URL(path, base).href;
    const resp = await safeFetch(targetUrl, {}, authHeaders);
    const status = resp ? resp.status : null;
    const contentType = resp
      ? (resp.headers.get("content-type") ?? null)
      : null;

    results.push({ path, status, contentType });

    if (status !== null) {
      await agentLog.insert({
        scan_id: scanId,
        phase: "recon",
        message: `Path probe: ${path} → ${status}`,
        metadata: { path, status, content_type: contentType },
      });
    }
  }

  return results;
}

async function testCors(
  targetUrl: string,
  scanId: string,
  authHeaders?: Record<string, string>
): Promise<{ allowsArbitraryOrigin: boolean; response: string | null }> {
  const resp = await safeFetch(targetUrl, {
    method: "OPTIONS",
    headers: {
      Origin: "https://evil.com",
      "Access-Control-Request-Method": "GET",
    },
  }, authHeaders);

  if (!resp) return { allowsArbitraryOrigin: false, response: null };

  const acao = resp.headers.get("access-control-allow-origin");
  const allowsArbitraryOrigin =
    acao === "*" || acao === "https://evil.com" || acao === "null";

  await agentLog.insert({
    scan_id: scanId,
    phase: "recon",
    message: `CORS test: Access-Control-Allow-Origin = ${acao ?? "(not set)"}`,
    metadata: { allows_arbitrary_origin: allowsArbitraryOrigin, acao },
  });

  return {
    allowsArbitraryOrigin,
    response: acao,
  };
}

async function probeSupabaseEndpoints(
  supabaseUrls: string[],
  anonKey: string | null,
  scanId: string,
  authHeaders?: Record<string, string>
): Promise<Array<{ url: string; status: number | null; response: string | null }>> {
  const results: Array<{
    url: string;
    status: number | null;
    response: string | null;
  }> = [];

  for (const base of supabaseUrls.slice(0, 3)) {
    const restUrl = `${base}/rest/v1/`;

    // Probe without auth (but with scan auth headers if provided)
    const unauthResp = await safeFetch(restUrl, {}, authHeaders);
    let unauthText: string | null = null;
    if (unauthResp) {
      unauthText = await unauthResp.text().catch((e) => {
        console.error(`[recon] Failed to read Supabase response: ${e instanceof Error ? e.message : e}`);
        return null;
      });
    }
    results.push({
      url: restUrl,
      status: unauthResp ? unauthResp.status : null,
      response: unauthText ? unauthText.slice(0, 500) : null,
    });

    await agentLog.insert({
      scan_id: scanId,
      phase: "recon",
      message: `Supabase REST probe (no auth): ${restUrl} → ${unauthResp?.status ?? "unreachable"}`,
      metadata: { url: restUrl, status: unauthResp?.status ?? null },
    });

    // Probe with anon key if we found one
    if (anonKey) {
      const authResp = await safeFetch(restUrl, {
        headers: {
          Authorization: `Bearer ${anonKey}`,
          apikey: anonKey,
        },
      });
      let authText: string | null = null;
      if (authResp) {
        authText = await authResp.text().catch((e) => {
          console.error(`[recon] Failed to read Supabase auth response: ${e instanceof Error ? e.message : e}`);
          return null;
        });
      }
      results.push({
        url: `${restUrl} (with anon key)`,
        status: authResp ? authResp.status : null,
        response: authText ? authText.slice(0, 500) : null,
      });

      await agentLog.insert({
        scan_id: scanId,
        phase: "recon",
        message: `Supabase REST probe (with anon key): ${restUrl} → ${authResp?.status ?? "unreachable"}`,
        metadata: { url: restUrl, status: authResp?.status ?? null },
      });
    }
  }

  return results;
}

function extractJsonBlock(text: string): Record<string, unknown> | null {
  // Try complete fenced block first
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]) as Record<string, unknown>;
    } catch {
      // fall through
    }
  }

  // Handle truncated response: find ```json and extract everything after it
  const startIdx = text.indexOf("```json");
  if (startIdx === -1) return null;

  let jsonStr = text.slice(startIdx + 7).trim();
  if (jsonStr.endsWith("```")) {
    jsonStr = jsonStr.slice(0, -3).trim();
  }

  try {
    return JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    // Try closing open braces/brackets
    let repaired = jsonStr;
    let open = 0;
    let inStr = false;
    let esc = false;
    for (const ch of repaired) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{" || ch === "[") open++;
      if (ch === "}" || ch === "]") open--;
    }
    // Close any unclosed structures
    while (open > 0) {
      repaired += "}";
      open--;
    }
    try {
      return JSON.parse(repaired) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

export async function runRecon(
  scanId: string,
  url: string,
  scanType: ScanType,
  authHeaders?: Record<string, string>,
  openapiSpec?: Record<string, unknown>,
  tokens?: TokenAccumulator,
): Promise<ReconResult> {
  await agentLog.insert({
    scan_id: scanId,
    phase: "recon",
    message: `Starting HTTP reconnaissance on ${url}`,
    metadata: { url, scan_type: scanType },
  });

  // Step 1: Fetch target URL
  await agentLog.insert({
    scan_id: scanId,
    phase: "recon",
    message: "Fetching target URL",
    metadata: {},
  });

  const mainResp = await safeFetch(url, {}, authHeaders);

  let statusCode: number | null = null;
  let responseHeaders: Record<string, string> = {};
  let cookies: string[] = [];
  let htmlSnippet = "";

  if (mainResp) {
    statusCode = mainResp.status;

    mainResp.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    // Set-Cookie can appear multiple times; the Headers API only exposes one merged value
    const setCookie = mainResp.headers.get("set-cookie");
    if (setCookie) {
      cookies = setCookie.split(/,(?=[^;]+=[^;])/);
    }

    const buffer = await mainResp.arrayBuffer().catch((e) => {
      console.error(`[recon] Failed to read main response body: ${e instanceof Error ? e.message : e}`);
      return null;
    });
    if (buffer) {
      htmlSnippet = new TextDecoder()
        .decode(new Uint8Array(buffer.slice(0, MAX_BODY_BYTES)))
        .trim();
    }

    await agentLog.insert({
      scan_id: scanId,
      phase: "recon",
      message: `Target responded: HTTP ${statusCode}`,
      metadata: {
        status: statusCode,
        content_type: mainResp.headers.get("content-type"),
        header_count: Object.keys(responseHeaders).length,
      },
    });
  } else {
    await agentLog.insert({
      scan_id: scanId,
      phase: "recon",
      message: "Target URL unreachable or timed out",
      metadata: { url },
    });
  }

  // Step 2: Extract script URLs from HTML
  const scriptUrls = extractScriptUrls(htmlSnippet, url);

  await agentLog.insert({
    scan_id: scanId,
    phase: "recon",
    message: `Found ${scriptUrls.length} script URL(s)`,
    metadata: { script_urls: scriptUrls.slice(0, 20) },
  });

  // Step 3: Fetch and scan JS bundles
  const bundleFindings: BundleFinding[] = [];
  for (const scriptUrl of scriptUrls.slice(0, MAX_SCRIPT_URLS)) {
    const finding = await scanBundle(scriptUrl, scanId);
    bundleFindings.push(finding);
  }

  // Collect all unique Supabase URLs found across bundles
  const allSupabaseUrls = [
    ...new Set(bundleFindings.flatMap((b) => b.supabaseUrls)),
  ];

  // Try to extract a Supabase anon key from secrets
  const allSecrets = bundleFindings.flatMap((b) => b.secrets);
  const anonKey =
    allSecrets.find(
      (s) => s.startsWith("eyJ") && s.length > 100
    ) ?? null;

  // Step 4: Check common paths
  await agentLog.insert({
    scan_id: scanId,
    phase: "recon",
    message: `Probing ${COMMON_PATHS.length} common paths`,
    metadata: {},
  });
  const commonPaths = await probeCommonPaths(url, scanId, authHeaders);

  // Step 4.5: Crawl target for endpoint discovery
  await agentLog.insert({
    scan_id: scanId,
    phase: "recon",
    message: "Crawling target for endpoint discovery",
    metadata: {},
  });

  const crawlResult = await crawl(url, scanId, {
    maxPages: 50,
    maxDepth: 3,
    authHeaders,
  });

  await agentLog.insert({
    scan_id: scanId,
    phase: "recon",
    message: `Crawl complete: ${crawlResult.pages.length} pages, ${crawlResult.jsRoutes.length} JS routes`,
    metadata: {
      pages_crawled: crawlResult.pages.length,
      js_routes: crawlResult.jsRoutes.length,
      forms_found: crawlResult.pages.reduce((n, p) => n + p.forms.length, 0),
    },
  });

  // Step 4.6: Browser-rendered crawl for SPA endpoint discovery
  let browserCrawlPages: Awaited<ReturnType<typeof browserCrawl>> | null = null;
  try {
    browserCrawlPages = await browserCrawl(url, scanId, crawlResult, htmlSnippet, {
      maxPages: 5,
      authHeaders,
    });

    if (!browserCrawlPages.skipped) {
      await agentLog.insert({
        scan_id: scanId,
        phase: "recon",
        message: `Browser crawl complete: ${browserCrawlPages.pages.length} pages rendered, ${browserCrawlPages.apiEndpoints.length} API endpoints intercepted`,
        metadata: {
          pages_rendered: browserCrawlPages.pages.length,
          api_endpoints: browserCrawlPages.apiEndpoints.length,
        },
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await agentLog.insert({
      scan_id: scanId,
      phase: "recon",
      message: `Browser crawl failed (non-fatal): ${msg}`,
      metadata: { error: msg },
    });
  }

  // Step 5: Extract security headers
  const securityHeaders = {
    csp: responseHeaders["content-security-policy"] ?? null,
    hsts: responseHeaders["strict-transport-security"] ?? null,
    xFrameOptions: responseHeaders["x-frame-options"] ?? null,
    xContentTypeOptions: responseHeaders["x-content-type-options"] ?? null,
    corsAllowOrigin: responseHeaders["access-control-allow-origin"] ?? null,
  };

  // Step 6: CORS test
  const corsTest = await testCors(url, scanId, authHeaders);

  // Step 7: Supabase probing
  let supabaseEndpoints: Array<{
    url: string;
    status: number | null;
    response: string | null;
  }> = [];

  if (allSupabaseUrls.length > 0) {
    await agentLog.insert({
      scan_id: scanId,
      phase: "recon",
      message: `Found ${allSupabaseUrls.length} Supabase URL(s) — probing REST API`,
      metadata: { supabase_urls: allSupabaseUrls },
    });
    supabaseEndpoints = await probeSupabaseEndpoints(
      allSupabaseUrls,
      anonKey,
      scanId,
      authHeaders
    );
  }

  const httpReconData: ReconHttpData = {
    targetUrl: url,
    statusCode,
    responseHeaders,
    cookies,
    scriptUrls,
    bundleFindings,
    commonPaths,
    securityHeaders,
    corsTest,
    supabaseEndpoints,
    htmlSnippet: htmlSnippet.slice(0, 5000),
    crawledPages: crawlResult.pages.map((p) => ({
      url: p.url,
      status: p.status,
      contentType: p.contentType,
      forms: p.forms,
    })),
    jsRoutes: crawlResult.jsRoutes,
    sitemapUrls: crawlResult.sitemapUrls,
    ...(browserCrawlPages && !browserCrawlPages.skipped
      ? {
          browserRenderedPages: browserCrawlPages.pages.map((p) => ({
            url: p.url,
            links: p.links,
            forms: p.forms,
          })),
          browserApiEndpoints: browserCrawlPages.apiEndpoints.map((r) => ({
            url: r.url,
            method: r.method,
          })),
        }
      : {}),
  };

  // Pass all collected data to Claude for analysis
  await agentLog.insert({
    scan_id: scanId,
    phase: "recon",
    message: `Sending HTTP recon data to ${getActiveModel()} for analysis`,
    metadata: {
      bundle_count: bundleFindings.length,
      path_count: commonPaths.length,
      supabase_urls: allSupabaseUrls.length,
    },
  });

  const prompt = buildReconPrompt(url, scanType, httpReconData);
  const { stream, getUsage } = await streamChat(SYSTEM_PROMPT, prompt);

  let fullText = "";
  let buffer = "";

  for await (const chunk of stream) {
    if (
      chunk.type === "content_block_delta" &&
      chunk.delta.type === "text_delta"
    ) {
      const text = chunk.delta.text;
      fullText += text;
      buffer += text;

      if (buffer.length >= STREAM_CHUNK_SIZE) {
        await agentLog.insert({
          scan_id: scanId,
          phase: "recon",
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
      phase: "recon",
      message: buffer.trim(),
      metadata: { chunk: true },
    });
  }

  tokens?.add(await getUsage());

  const claudeAnalysis = extractJsonBlock(fullText) ?? {};

  // Merge OpenAPI spec endpoints into analysis
  if (openapiSpec) {
    const specEndpoints = extractEndpoints(openapiSpec);
    if (specEndpoints.length > 0) {
      const existing = Array.isArray(claudeAnalysis["endpoints"])
        ? (claudeAnalysis["endpoints"] as Array<Record<string, unknown>>)
        : [];
      const existingPaths = new Set(
        existing.map((e) => `${(e.method ?? "GET") as string}:${e.path as string}`)
      );
      let merged = 0;
      for (const ep of specEndpoints) {
        const key = `${ep.method}:${ep.path}`;
        if (!existingPaths.has(key)) {
          existing.push({
            path: ep.path,
            method: ep.method,
            status: null,
            notes: ep.description ?? "From OpenAPI spec",
            source: "openapi",
          });
          merged++;
        }
      }
      claudeAnalysis["endpoints"] = existing;
      await agentLog.insert({
        scan_id: scanId,
        phase: "recon",
        message: `Merged ${merged} endpoint(s) from OpenAPI spec (${specEndpoints.length} total in spec)`,
        metadata: { openapi_total: specEndpoints.length, openapi_merged: merged },
      });
    }
  }

  // Merge crawl-discovered endpoints into analysis
  if (crawlResult.pages.length > 0 || crawlResult.jsRoutes.length > 0) {
    const existing = Array.isArray(claudeAnalysis["endpoints"])
      ? (claudeAnalysis["endpoints"] as Array<Record<string, unknown>>)
      : [];
    const existingPaths = new Set(
      existing.map((e) => `${(e.method ?? "GET") as string}:${e.path as string}`)
    );
    let merged = 0;

    for (const page of crawlResult.pages) {
      const path = new URL(page.url).pathname;
      const key = `GET:${path}`;
      if (!existingPaths.has(key)) {
        existing.push({
          path,
          method: "GET",
          status: page.status,
          notes: `Discovered via crawl (${page.contentType ?? "unknown"})`,
          source: "crawl",
        });
        existingPaths.add(key);
        merged++;
      }
      for (const form of page.forms) {
        const method = (form.method || "POST").toUpperCase();
        const fKey = `${method}:${form.action}`;
        if (!existingPaths.has(fKey)) {
          existing.push({
            path: form.action,
            method,
            status: null,
            notes: `Form (inputs: ${form.inputs.join(", ")})`,
            source: "crawl",
          });
          existingPaths.add(fKey);
          merged++;
        }
      }
    }

    for (const route of crawlResult.jsRoutes) {
      const key = `GET:${route}`;
      if (!existingPaths.has(key)) {
        existing.push({
          path: route,
          method: "GET",
          status: null,
          notes: "Discovered in JS bundle",
          source: "js_bundle",
        });
        existingPaths.add(key);
        merged++;
      }
    }

    claudeAnalysis["endpoints"] = existing;
    await agentLog.insert({
      scan_id: scanId,
      phase: "recon",
      message: `Merged ${merged} endpoint(s) from crawl (${crawlResult.pages.length} pages, ${crawlResult.jsRoutes.length} JS routes)`,
      metadata: { crawl_merged: merged },
    });
  }

  // Merge browser-crawl-discovered endpoints into analysis
  if (browserCrawlPages && !browserCrawlPages.skipped) {
    const existing = Array.isArray(claudeAnalysis["endpoints"])
      ? (claudeAnalysis["endpoints"] as Array<Record<string, unknown>>)
      : [];
    const existingPaths = new Set(
      existing.map((e) => `${(e.method ?? "GET") as string}:${e.path as string}`)
    );
    let merged = 0;

    for (const page of browserCrawlPages.pages) {
      const pagePath = new URL(page.url).pathname;
      const key = `GET:${pagePath}`;
      if (!existingPaths.has(key)) {
        existing.push({
          path: pagePath,
          method: "GET",
          status: page.status,
          notes: "Discovered via browser rendering",
          source: "browser_crawl",
        });
        existingPaths.add(key);
        merged++;
      }
      for (const form of page.forms) {
        const method = (form.method || "POST").toUpperCase();
        const fKey = `${method}:${form.action}`;
        if (!existingPaths.has(fKey)) {
          existing.push({
            path: form.action,
            method,
            status: null,
            notes: `Form from rendered DOM (inputs: ${form.inputs.join(", ")})`,
            source: "browser_crawl",
          });
          existingPaths.add(fKey);
          merged++;
        }
      }
    }

    for (const req of browserCrawlPages.apiEndpoints) {
      const reqPath = new URL(req.url).pathname;
      const key = `${req.method}:${reqPath}`;
      if (!existingPaths.has(key)) {
        existing.push({
          path: reqPath,
          method: req.method,
          status: null,
          notes: `API call intercepted from browser (${req.resourceType})`,
          source: "browser_intercept",
        });
        existingPaths.add(key);
        merged++;
      }
    }

    claudeAnalysis["endpoints"] = existing;
    if (merged > 0) {
      await agentLog.insert({
        scan_id: scanId,
        phase: "recon",
        message: `Merged ${merged} endpoint(s) from browser crawl`,
        metadata: { browser_crawl_merged: merged },
      });
    }
  }

  const endpointCount = Array.isArray(claudeAnalysis["endpoints"])
    ? claudeAnalysis["endpoints"].length
    : 0;
  const candidateCount = Array.isArray(claudeAnalysis["finding_candidates"])
    ? claudeAnalysis["finding_candidates"].length
    : 0;

  await agentLog.insert({
    scan_id: scanId,
    phase: "recon",
    message: "Recon analysis complete",
    metadata: {
      endpoint_count: endpointCount,
      finding_candidates: candidateCount,
      has_exposed_secrets: Array.isArray(claudeAnalysis["exposed_secrets"])
        ? claudeAnalysis["exposed_secrets"].length > 0
        : false,
    },
  });

  return { httpData: httpReconData, claudeAnalysis, rawResponse: fullText };
}
