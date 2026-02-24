import { describe, it, expect } from "vitest";
import { looksLikeSpaShell } from "./browser-crawl.js";
import type { CrawledPage } from "./crawl.js";

function makePage(overrides: Partial<CrawledPage> = {}): CrawledPage {
  return {
    url: "https://example.com",
    status: 200,
    contentType: "text/html",
    links: [],
    forms: [],
    depth: 0,
    ...overrides,
  };
}

describe("looksLikeSpaShell", () => {
  it("detects page with zero links as SPA shell", () => {
    expect(looksLikeSpaShell(makePage())).toBe(true);
  });

  it("detects page with 1-3 links as SPA shell", () => {
    expect(looksLikeSpaShell(makePage({ links: ["a", "b"] }))).toBe(true);
    expect(looksLikeSpaShell(makePage({ links: ["a", "b", "c"] }))).toBe(true);
  });

  it("rejects page with many links (server-rendered)", () => {
    const links = Array.from({ length: 20 }, (_, i) => `https://example.com/page${i}`);
    expect(looksLikeSpaShell(makePage({ links }))).toBe(false);
  });

  it("rejects non-HTML pages regardless of link count", () => {
    expect(looksLikeSpaShell(makePage({ contentType: "application/json", links: [] }))).toBe(false);
    expect(looksLikeSpaShell(makePage({ contentType: "text/plain", links: [] }))).toBe(false);
  });

  it("rejects error status codes", () => {
    expect(looksLikeSpaShell(makePage({ status: 404, links: [] }))).toBe(false);
    expect(looksLikeSpaShell(makePage({ status: 500, links: [] }))).toBe(false);
  });

  it("accepts 3xx redirects with few links", () => {
    expect(looksLikeSpaShell(makePage({ status: 301, links: [] }))).toBe(true);
  });

  it("uses script-to-link ratio when HTML snippet provided", () => {
    const html = '<html><script src="a.js"></script><script src="b.js"></script><script src="c.js"></script><script src="d.js"></script></html>';
    // 4 scripts > 3 links → SPA-like
    expect(looksLikeSpaShell(makePage({ links: ["a", "b", "c", "d"] }), html)).toBe(false);
    expect(looksLikeSpaShell(makePage({ links: ["a", "b", "c"] }), html)).toBe(true);
  });

  it("ignores script ratio when fewer than 4 scripts", () => {
    const html = '<html><script src="a.js"></script><script src="b.js"></script></html>';
    // Only 2 scripts — doesn't meet >3 threshold
    const page = makePage({ links: Array.from({ length: 10 }, (_, i) => `${i}`) });
    expect(looksLikeSpaShell(page, html)).toBe(false);
  });

  it("handles null content type", () => {
    expect(looksLikeSpaShell(makePage({ contentType: null, links: [] }))).toBe(false);
  });
});
