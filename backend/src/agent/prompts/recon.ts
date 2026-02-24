export interface ReconHttpData {
  targetUrl: string;
  statusCode: number | null;
  responseHeaders: Record<string, string>;
  cookies: string[];
  scriptUrls: string[];
  bundleFindings: Array<{
    url: string;
    secrets: string[];
    supabaseUrls: string[];
    apiKeys: string[];
  }>;
  commonPaths: Array<{
    path: string;
    status: number | null;
    contentType: string | null;
  }>;
  securityHeaders: {
    csp: string | null;
    hsts: string | null;
    xFrameOptions: string | null;
    xContentTypeOptions: string | null;
    corsAllowOrigin: string | null;
  };
  corsTest: { allowsArbitraryOrigin: boolean; response: string | null };
  supabaseEndpoints: Array<{
    url: string;
    status: number | null;
    response: string | null;
  }>;
  htmlSnippet: string;
  crawledPages?: Array<{
    url: string;
    status: number;
    contentType: string | null;
    forms: Array<{ action: string; method: string; inputs: string[] }>;
  }>;
  jsRoutes?: string[];
  sitemapUrls?: string[];
  browserRenderedPages?: Array<{
    url: string;
    links: string[];
    forms: Array<{ action: string; method: string; inputs: string[] }>;
  }>;
  browserApiEndpoints?: Array<{
    url: string;
    method: string;
  }>;
}

export function buildReconPrompt(
  url: string,
  scanType: string,
  httpReconData: ReconHttpData
): string {
  return `## Reconnaissance Phase

Target URL: ${url}
Scan Type: ${scanType}

I have already performed real HTTP reconnaissance against this target. Below is the raw data collected. Analyze every piece of it — do not ask me to fetch more data, work with what is here.

### HTTP Recon Data

\`\`\`json
${JSON.stringify(httpReconData, null, 2)}
\`\`\`

### Your Analysis Tasks

1. **Technology Stack Identification**
   Identify framework, server, language, database, CDN/WAF, and frontend stack from:
   - Response headers (Server, X-Powered-By, Via, CF-Ray, X-Vercel-Id, etc.)
   - Cookie names and formats
   - Script URLs and bundle naming conventions (chunk hashes, _next, __nuxt, etc.)
   - HTML meta tags, generator comments
   - Supabase/Firebase/BaaS URLs found in bundles

2. **Security Header Analysis**
   Evaluate the security posture from headers:
   - Is CSP present and effective, or missing/weak?
   - Is HSTS present? What max-age?
   - Is X-Frame-Options set (clickjacking protection)?
   - Is X-Content-Type-Options set?
   - What does the CORS configuration allow?

3. **Cookie Security Analysis**
   For each cookie found:
   - Is it HttpOnly? If not, XSS can steal it.
   - Is it Secure? If not, sent over HTTP.
   - Is SameSite set? If not, CSRF is possible.
   - Does the name pattern suggest session, auth JWT, or tracking?

4. **JS Bundle Secret Detection**
   For each bundle finding:
   - Flag any Supabase URLs (high-value: check anon key exposure)
   - Flag any API keys matching known patterns (AWS, GitHub, Stripe, Anthropic)
   - Flag any high-entropy strings that look like secrets
   - Flag any environment variable leaks (NEXT_PUBLIC_, REACT_APP_, VITE_)

5. **Exposed Path Analysis**
   For each path probed:
   - Any 200 responses on /.env, /.git/HEAD, /graphql, /api? High severity.
   - Any 401/403 on sensitive paths? Confirms they exist (still useful).
   - Any paths returning unexpected content types?

6. **CORS Misconfiguration**
   If the CORS test shows the target reflects arbitrary origins:
   - This is likely a high/critical finding depending on cookies/auth
   - What credentials could be stolen?

7. **Supabase-Specific Analysis**
   If Supabase endpoints were found:
   - Is the anon key exposed in any bundle?
   - Does the REST API respond without auth?
   - What tables or schemas are visible?
   - Is RLS likely misconfigured?

8. **Attack Surface Summary**
   Based on all evidence, which areas are highest priority for exploitation?

9. **Crawled Endpoint Analysis**
   If crawled pages are present in the data:
   - Which endpoints were discovered beyond common paths?
   - Are there forms with interesting inputs (hidden fields, file uploads, admin actions)?
   - Do any pages leak information in URLs or content?
   - Are there admin or debug pages that shouldn't be publicly accessible?
   - Do JS-discovered routes suggest API endpoints not linked in the UI?

10. **Browser-Rendered Endpoint Analysis**
   If browser-rendered page data is present:
   - Which links and forms were discovered only after JavaScript execution?
   - Do the intercepted API endpoints reveal authenticated backend routes?
   - Are there API endpoints using non-GET methods (POST, PUT, DELETE) that suggest write operations?
   - Do any intercepted API paths contain user IDs or resource identifiers (potential IDOR)?

Reason step by step through the data. Then emit your structured output:

\`\`\`json
{
  "target_url": "${url}",
  "scan_type": "${scanType}",
  "tech_stack": {
    "server": null,
    "framework": null,
    "language": null,
    "database": null,
    "cdn_waf": null,
    "frontend": null,
    "baas": null
  },
  "endpoints": [
    { "path": "/example", "method": "GET", "status": 200, "notes": "why this is interesting", "confidence": "high" }
  ],
  "exposed_secrets": [
    { "type": "supabase_anon_key", "value": "eyJ...", "location": "bundle url", "confidence": "high" }
  ],
  "auth_mechanism": null,
  "session_flags": {
    "secure": null,
    "http_only": null,
    "same_site": null
  },
  "security_header_findings": [
    { "header": "Content-Security-Policy", "issue": "missing", "severity": "medium", "confidence": "high" }
  ],
  "cors_finding": null,
  "supabase_analysis": null,
  "finding_candidates": [
    {
      "title": "Short title",
      "description": "What was observed and why it matters",
      "severity": "critical | high | medium | low | info",
      "confidence": "low | medium | high",
      "endpoint": "/path",
      "evidence": "The specific header/value/response that indicates this"
    }
  ],
  "attack_surface_notes": "Summary of the most promising areas for exploitation phase"
}
\`\`\``;
}
