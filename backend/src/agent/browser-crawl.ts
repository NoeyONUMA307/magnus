/** Browser-rendered crawling: Puppeteer-based SPA endpoint discovery */

import puppeteer from "puppeteer";
import type { Page, HTTPRequest } from "puppeteer";
import { agentLog } from "../lib/db.js";
import type { CrawlResult, CrawledPage, FormInfo } from "./crawl.js";
import { normalizeUrl, isSameOrigin } from "./crawl.js";

// --- Types ---

export interface BrowserCrawlOptions {
  maxPages: number;
  navigationTimeout: number;
  waitAfterLoad: number;
  authHeaders?: Record<string, string>;
}

export interface BrowserCrawlResult {
  pages: CrawledPage[];
  apiEndpoints: InterceptedRequest[];
  skipped: boolean;
}

export interface InterceptedRequest {
  url: string;
  method: string;
  resourceType: string;
}

const DEFAULT_OPTIONS: BrowserCrawlOptions = {
  maxPages: 5,
  navigationTimeout: 30_000,
  waitAfterLoad: 2_000,
};

const BROWSER_LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
];

// --- Pure helpers (exported for testing) ---

export function looksLikeSpaShell(page: CrawledPage, htmlSnippet?: string): boolean {
  const isHtml = page.contentType?.includes("text/html") ?? false;
  if (!isHtml) return false;
  if (page.status < 200 || page.status >= 400) return false;

  // Few links is the strongest signal: SPAs often have 0-3 links in raw HTML
  if (page.links.length <= 3) return true;

  // If we have HTML, check script-to-link ratio
  if (htmlSnippet) {
    const scriptCount = (htmlSnippet.match(/<script[\s>]/gi) ?? []).length;
    if (scriptCount > 3 && page.links.length < scriptCount) return true;
  }

  return false;
}

// --- Auth injection (mirrors browser-confirm.ts) ---

async function setupPageAuth(
  page: Page,
  baseUrl: string,
  authHeaders?: Record<string, string>,
): Promise<void> {
  if (!authHeaders) return;

  const cookieHeader = authHeaders["Cookie"] ?? authHeaders["cookie"];
  if (cookieHeader) {
    const domain = new URL(baseUrl).hostname;
    const cookies = cookieHeader.split(";").map((c) => {
      const [name, ...rest] = c.trim().split("=");
      return { name: name.trim(), value: rest.join("=").trim(), domain };
    });
    await page.setCookie(...cookies);
  }

  const nonCookieHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(authHeaders)) {
    if (k.toLowerCase() !== "cookie") nonCookieHeaders[k] = v;
  }
  if (Object.keys(nonCookieHeaders).length > 0) {
    await page.setExtraHTTPHeaders(nonCookieHeaders);
  }
}

// --- Network request observation ---

function setupRequestObserver(
  page: Page,
  baseUrl: string,
): { getIntercepted: () => InterceptedRequest[] } {
  const intercepted: InterceptedRequest[] = [];
  const seen = new Set<string>();

  page.on("request", (request: HTTPRequest) => {
    const url = request.url();
    const method = request.method();
    const resourceType = request.resourceType();

    // Only capture fetch/XHR — skip images, stylesheets, fonts, etc.
    if (resourceType !== "fetch" && resourceType !== "xhr") return;

    // Same-origin only
    if (!isSameOrigin(url, baseUrl)) return;

    // Dedup by method:url
    const key = `${method}:${url}`;
    if (seen.has(key)) return;
    seen.add(key);

    intercepted.push({ url, method, resourceType });
  });

  return { getIntercepted: () => intercepted };
}

// --- DOM extraction from rendered page ---

async function extractFromRenderedDom(
  page: Page,
  pageUrl: string,
): Promise<{ links: string[]; forms: FormInfo[] }> {
  const origin = new URL(pageUrl).origin;

  // Uses string-based evaluate to avoid DOM type issues (tsconfig has no "dom" lib)
  const result = await page.evaluate(`
    (() => {
      const origin = ${JSON.stringify(origin)};
      const links = [];
      const forms = [];

      for (const a of document.querySelectorAll("a[href]")) {
        const href = a.href;
        if (!href) continue;
        if (/^(javascript|mailto|tel|data):/.test(href)) continue;
        try {
          if (new URL(href).origin === origin) {
            links.push(href);
          }
        } catch {}
      }

      for (const form of document.querySelectorAll("form")) {
        const action = form.action
          ? new URL(form.action, document.baseURI).pathname
          : window.location.pathname;
        const method = (form.method || "GET").toUpperCase();
        const inputs = [];
        for (const el of form.querySelectorAll("input[name], textarea[name], select[name]")) {
          if (el.name) inputs.push(el.name);
        }
        forms.push({ action, method, inputs });
      }

      return { links: [...new Set(links)], forms };
    })()
  `) as { links: string[]; forms: FormInfo[] };

  return result;
}

// --- Main browser crawl function ---

export async function browserCrawl(
  startUrl: string,
  scanId: string,
  httpCrawlResult: CrawlResult,
  htmlSnippet: string,
  options?: Partial<BrowserCrawlOptions>,
): Promise<BrowserCrawlResult> {
  const opts: BrowserCrawlOptions = { ...DEFAULT_OPTIONS, ...options };

  // Decide which pages to render
  const pagesToRender: string[] = [startUrl];

  for (const page of httpCrawlResult.pages) {
    if (pagesToRender.length >= opts.maxPages) break;
    if (normalizeUrl(page.url) === normalizeUrl(startUrl)) continue;
    if (looksLikeSpaShell(page)) {
      pagesToRender.push(page.url);
    }
  }

  // Skip if target doesn't look like a SPA
  const startPage = httpCrawlResult.pages.find(
    (p) => normalizeUrl(p.url) === normalizeUrl(startUrl),
  );
  if (
    pagesToRender.length === 1 &&
    startPage &&
    !looksLikeSpaShell(startPage, htmlSnippet) &&
    (startPage.links.length ?? 0) > 5
  ) {
    await agentLog.insert({
      scan_id: scanId,
      phase: "recon",
      message: "Skipping browser crawl — target does not appear to be a SPA",
      metadata: { link_count: startPage.links.length },
    });
    return { pages: [], apiEndpoints: [], skipped: true };
  }

  await agentLog.insert({
    scan_id: scanId,
    phase: "recon",
    message: `Browser crawl: rendering ${pagesToRender.length} page(s)`,
    metadata: { urls: pagesToRender },
  });

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: BROWSER_LAUNCH_ARGS,
  });

  const pages: CrawledPage[] = [];
  const allApiEndpoints: InterceptedRequest[] = [];

  try {
    for (const url of pagesToRender) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await setupPageAuth(page, startUrl, opts.authHeaders);

      const { getIntercepted } = setupRequestObserver(page, startUrl);

      try {
        await page.goto(url, {
          waitUntil: "networkidle2",
          timeout: opts.navigationTimeout,
        });

        // Wait for deferred JS (lazy routes, setTimeout API calls)
        await new Promise((r) => setTimeout(r, opts.waitAfterLoad));

        const { links, forms } = await extractFromRenderedDom(page, url);
        const intercepted = getIntercepted();

        pages.push({
          url,
          status: 200,
          contentType: "text/html",
          links,
          forms,
          depth: 0,
        });

        allApiEndpoints.push(...intercepted);

        await agentLog.insert({
          scan_id: scanId,
          phase: "recon",
          message: `Browser rendered: ${url} — ${links.length} links, ${forms.length} forms, ${intercepted.length} API calls`,
          metadata: {
            url,
            links: links.length,
            forms: forms.length,
            api_calls: intercepted.length,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await agentLog.insert({
          scan_id: scanId,
          phase: "recon",
          message: `Browser render failed: ${url} — ${msg.slice(0, 150)}`,
          metadata: { url, error: msg.slice(0, 300) },
        });
      } finally {
        if (!page.isClosed()) await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  return { pages, apiEndpoints: allApiEndpoints, skipped: false };
}
