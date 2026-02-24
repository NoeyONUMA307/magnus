import { agentLog } from "../lib/db.js";
import { safeFetch, MAX_BODY_BYTES } from "../lib/http.js";

// --- Types ---

export interface CrawlOptions {
  maxPages: number;
  maxDepth: number;
  authHeaders?: Record<string, string>;
}

export interface CrawlResult {
  pages: CrawledPage[];
  sitemapUrls: string[];
  robotsDisallowed: string[];
  jsRoutes: string[];
}

export interface CrawledPage {
  url: string;
  status: number;
  contentType: string | null;
  links: string[];
  forms: FormInfo[];
  depth: number;
}

export interface FormInfo {
  action: string;
  method: string;
  inputs: string[];
}

const DEFAULT_OPTIONS: CrawlOptions = {
  maxPages: 50,
  maxDepth: 3,
};

// --- Pure helpers (exported for testing) ---

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    // Lowercase scheme + host
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    // Strip fragment
    u.hash = "";
    // Sort query params
    const params = new URLSearchParams(u.search);
    const sorted = new URLSearchParams([...params.entries()].sort());
    u.search = sorted.toString();
    // Strip trailing slash (unless path is just "/")
    let href = u.href;
    if (href.endsWith("/") && u.pathname !== "/") {
      href = href.slice(0, -1);
    }
    return href;
  } catch {
    return raw;
  }
}

export function isSameOrigin(candidate: string, base: string): boolean {
  try {
    return new URL(candidate).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

export function parseRobotsTxt(text: string): { disallowed: string[]; sitemaps: string[] } {
  const disallowed: string[] = [];
  const sitemaps: string[] = [];
  let inWildcardBlock = false;

  const lines = text.split("\n");
  const maxLines = Math.min(lines.length, 2000);

  for (let idx = 0; idx < maxLines; idx++) {
    const line = lines[idx].trim();
    if (line.startsWith("#") || line === "") continue;

    const lower = line.toLowerCase();

    if (lower.startsWith("user-agent:")) {
      const agent = line.slice("user-agent:".length).trim();
      inWildcardBlock = agent === "*";
      continue;
    }

    if (lower.startsWith("sitemap:") && sitemaps.length < 50) {
      const url = line.slice("sitemap:".length).trim();
      if (url) sitemaps.push(url);
      continue;
    }

    if (inWildcardBlock && lower.startsWith("disallow:") && disallowed.length < 1000) {
      const path = line.slice("disallow:".length).trim();
      if (path) disallowed.push(path);
    }
  }

  return { disallowed, sitemaps };
}

export function isDisallowed(path: string, disallowed: string[]): boolean {
  return disallowed.some((rule) => path.startsWith(rule));
}

export function parseSitemap(xml: string, baseOrigin: string): string[] {
  const urls: string[] = [];
  const matches = xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi);
  for (const m of matches) {
    const url = m[1];
    if (!url) continue;
    try {
      if (new URL(url).origin === baseOrigin) {
        urls.push(url);
      }
    } catch {
      // skip malformed URLs
    }
  }
  return urls;
}

export function extractLinks(
  html: string,
  pageUrl: string,
): { links: string[]; forms: FormInfo[] } {
  const base = new URL(pageUrl);
  const linkSet = new Set<string>();
  const forms: FormInfo[] = [];

  // <a href="...">
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#][^"']*)["']/gi)) {
    const href = m[1];
    if (!href) continue;
    // Skip javascript:, mailto:, tel:, data:
    if (/^(javascript|mailto|tel|data):/i.test(href)) continue;
    try {
      const resolved = new URL(href, base).href;
      if (new URL(resolved).origin === base.origin) {
        linkSet.add(resolved);
      }
    } catch {
      // skip malformed
    }
  }

  // <form ...> ... </form> — extract tag, then parse action/method from it
  for (const m of html.matchAll(/<form\s([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = m[1] ?? "";
    const formBody = m[2] ?? "";

    // Extract action and method from the tag attributes separately
    const actionMatch = attrs.match(/action=["']([^"']*)["']/i);
    const methodMatch = attrs.match(/method=["']([^"']*)["']/i);

    const action = actionMatch?.[1] ?? "";
    const method = (methodMatch?.[1] ?? "GET").toUpperCase();

    let resolvedAction: string;
    try {
      resolvedAction = new URL(action || pageUrl, base).pathname;
    } catch {
      continue;
    }

    const inputs: string[] = [];
    for (const inp of formBody.matchAll(/<input\s[^>]*name=["']([^"']+)["']/gi)) {
      if (inp[1]) inputs.push(inp[1]);
    }
    for (const inp of formBody.matchAll(/<textarea\s[^>]*name=["']([^"']+)["']/gi)) {
      if (inp[1]) inputs.push(inp[1]);
    }
    for (const inp of formBody.matchAll(/<select\s[^>]*name=["']([^"']+)["']/gi)) {
      if (inp[1]) inputs.push(inp[1]);
    }

    forms.push({ action: resolvedAction, method, inputs });
  }

  return { links: [...linkSet], forms };
}

export function extractJsRoutes(bundleText: string): string[] {
  const routes = new Set<string>();

  // Literal API paths: "/api/users", "/v1/auth/login"
  for (const m of bundleText.matchAll(/["'`](\/api\/[a-z][a-z0-9/_-]*)["'`]/gi)) {
    if (m[1]) routes.add(m[1]);
  }
  for (const m of bundleText.matchAll(/["'`](\/v[0-9]+\/[a-z][a-z0-9/_-]*)["'`]/gi)) {
    if (m[1]) routes.add(m[1]);
  }

  // fetch("/some/path") or fetch('/some/path')
  for (const m of bundleText.matchAll(/fetch\s*\(\s*["'`](\/[a-z][a-z0-9/_.-]*)["'`]/gi)) {
    if (m[1]) routes.add(m[1]);
  }

  // Router path definitions: path: "/admin", path: '/settings'
  for (const m of bundleText.matchAll(/path\s*:\s*["'`](\/[a-z][a-z0-9/_-]*)["'`]/gi)) {
    if (m[1]) routes.add(m[1]);
  }

  return [...routes];
}

// --- Main crawl function ---

export async function crawl(
  startUrl: string,
  scanId: string,
  options?: Partial<CrawlOptions>,
): Promise<CrawlResult> {
  const opts: CrawlOptions = { ...DEFAULT_OPTIONS, ...options };
  const origin = new URL(startUrl).origin;

  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [];
  const pages: CrawledPage[] = [];
  const allJsRoutes = new Set<string>();
  let robotsDisallowed: string[] = [];
  let sitemapUrls: string[] = [];

  // Step 1: Fetch robots.txt
  const robotsResp = await safeFetch(`${origin}/robots.txt`, {}, opts.authHeaders);
  if (robotsResp && robotsResp.ok) {
    const robotsText = await robotsResp.text().catch(() => "");
    const parsed = parseRobotsTxt(robotsText);
    robotsDisallowed = parsed.disallowed;
    sitemapUrls = parsed.sitemaps;

    await agentLog.insert({
      scan_id: scanId,
      phase: "recon",
      message: `robots.txt: ${robotsDisallowed.length} disallowed path(s), ${sitemapUrls.length} sitemap(s)`,
      metadata: { disallowed: robotsDisallowed.slice(0, 20), sitemaps: sitemapUrls },
    });
  }

  // Step 2: Fetch sitemaps
  const sitemapUrlsToFetch = sitemapUrls.length > 0
    ? sitemapUrls
    : [`${origin}/sitemap.xml`];

  for (const smUrl of sitemapUrlsToFetch.slice(0, 3)) {
    const smResp = await safeFetch(smUrl);
    if (smResp && smResp.ok) {
      const smText = await smResp.text().catch(() => "");
      const discovered = parseSitemap(smText, origin);
      for (const u of discovered) {
        queue.push({ url: u, depth: 1 });
      }
      if (discovered.length > 0) {
        await agentLog.insert({
          scan_id: scanId,
          phase: "recon",
          message: `Sitemap ${smUrl}: ${discovered.length} URL(s)`,
          metadata: { count: discovered.length },
        });
      }
    }
  }

  // Step 3: Seed with start URL
  queue.push({ url: startUrl, depth: 0 });

  // Step 4: BFS
  while (queue.length > 0 && visited.size < opts.maxPages) {
    const item = queue.shift()!;
    const normalized = normalizeUrl(item.url);

    if (visited.has(normalized)) continue;
    if (item.depth > opts.maxDepth) continue;

    // Check robots.txt
    try {
      const path = new URL(item.url).pathname;
      if (isDisallowed(path, robotsDisallowed)) continue;
    } catch {
      continue;
    }

    // Same-origin check
    if (!isSameOrigin(item.url, startUrl)) continue;

    visited.add(normalized);

    const resp = await safeFetch(item.url, {}, opts.authHeaders);
    if (!resp) continue;

    const status = resp.status;
    const contentType = resp.headers.get("content-type") ?? null;

    const buffer = await resp.arrayBuffer().catch(() => null);
    if (!buffer) {
      pages.push({
        url: item.url,
        status,
        contentType,
        links: [],
        forms: [],
        depth: item.depth,
      });
      continue;
    }

    const body = new TextDecoder().decode(
      new Uint8Array(buffer.slice(0, MAX_BODY_BYTES)),
    );

    const isHtml = contentType?.includes("text/html") ?? false;
    const isJs = (contentType?.includes("javascript") ?? false) ||
      (!contentType?.includes("application/json") && item.url.endsWith(".js"));

    let links: string[] = [];
    let forms: FormInfo[] = [];

    if (isHtml && status >= 200 && status < 400) {
      const extracted = extractLinks(body, item.url);
      links = extracted.links;
      forms = extracted.forms;

      // Queue discovered links
      for (const link of links) {
        const norm = normalizeUrl(link);
        if (!visited.has(norm)) {
          queue.push({ url: link, depth: item.depth + 1 });
        }
      }
    }

    if (isJs && status >= 200 && status < 400) {
      for (const route of extractJsRoutes(body)) {
        allJsRoutes.add(route);
      }
    }

    pages.push({
      url: item.url,
      status,
      contentType,
      links,
      forms,
      depth: item.depth,
    });

    // Log progress every 10 pages
    if (pages.length % 10 === 0) {
      await agentLog.insert({
        scan_id: scanId,
        phase: "recon",
        message: `Crawled ${pages.length} page(s), ${queue.length} in queue`,
        metadata: { visited: pages.length, queued: queue.length },
      });
    }
  }

  return {
    pages,
    sitemapUrls,
    robotsDisallowed,
    jsRoutes: [...allJsRoutes],
  };
}
