import type { ReconResult } from "../phases/recon.js";

export function buildPlanningPrompt(url: string, recon: ReconResult, isAuthenticated = false, writeProbesEnabled = false): string {
  const authContext = isAuthenticated
    ? `\n\n**AUTHENTICATED SCAN**: You have authenticated access to this target. The scanner is sending valid session credentials with every request. This dramatically expands the attack surface — you can now test for vulnerabilities that require a logged-in session. Prioritize:
- **IDOR** (Insecure Direct Object References) — can you access other users' data by changing IDs?
- **Broken Object-Level Authorization** — are API endpoints enforcing per-object ownership checks?
- **Privilege Escalation** — can a normal user access admin endpoints or escalate roles?
- **Broken Function-Level Authorization** — are sensitive operations (delete, update, admin) properly gated?
- **Mass Assignment** — can you modify fields (role, permissions) that shouldn't be user-controllable?
- **Server-Side Request Forgery** — can authenticated endpoints be abused to reach internal services?

**IDOR READ PROBES (\`idor_test_urls\`)**: For EVERY endpoint that contains a resource identifier (numeric ID, UUID, slug) in the URL path or query parameters, generate \`idor_test_urls\` — an array of 1-3 GET URLs with the resource ID changed to a different plausible value. These will be fetched WITH the authenticated user's credentials to test if the server returns another user's data.

Rules for idor_test_urls:
- Change ONLY the resource identifier — keep the rest of the URL identical
- For numeric IDs: increment or decrement by 1 (e.g., /api/orders/5 → /api/orders/6, /api/orders/4)
- For UUIDs: use \`00000000-0000-0000-0000-000000000001\`
- For slugs: use \`magnus-idor-test\`
- Generate 1-3 URLs max per chain
- These are safe GET requests — they only read data, never modify it
- Do NOT use placeholder syntax like \`{id}\` or \`<id>\` — use concrete values\n`
    : "";

  const writeProbeContext = writeProbesEnabled
    ? `\n\n**WRITE PROBES ENABLED**: The user has opted in to active testing with POST/PUT/DELETE/PATCH requests. You may now design write probes to test for:

- **IDOR** (\`idor\`): Change resource IDs in mutation endpoints to test for broken object-level authorization. Use benign test IDs like \`00000000-0000-0000-0000-000000000000\`.
- **Auth Bypass** (\`auth_bypass\`): Send mutation requests without credentials to test if write endpoints enforce authentication.
- **Mass Assignment** (\`mass_assignment\`): Send PUT/PATCH requests with extra fields like \`"role": "admin"\` or \`"is_admin": true\` to test if the server accepts unintended fields.
- **CSRF** (\`csrf\`): Send POST requests without CSRF tokens or with \`Origin: https://evil.com\` to test if mutation endpoints enforce CSRF protection.

**Rules for write probes:**
- Use ONLY benign, non-destructive payloads — test authorization, not input validation
- Use fake test values: \`magnus-test@example.com\`, \`"role": "admin"\`, IDs like \`00000000-0000-0000-0000-000000000000\`
- NEVER send SQL injection, command injection, or XSS payloads in write probes
- NEVER attempt to actually delete or modify real data
- Each write probe must have a \`probe_category\` from: \`idor\`, \`auth_bypass\`, \`mass_assignment\`, \`csrf\`\n`
    : "";

  return `## Planning Phase

Target URL: ${url}

You have completed reconnaissance. Below is the full recon output — both the raw HTTP data collected and the AI analysis of it. Think like a motivated attacker who has 30 minutes to cause maximum damage.${authContext}${writeProbeContext}

### Raw HTTP Recon Data

\`\`\`json
${JSON.stringify(recon.httpData, null, 2)}
\`\`\`

### Recon Analysis

\`\`\`json
${JSON.stringify(recon.claudeAnalysis, null, 2)}
\`\`\`

### Your Mission

Design a prioritized attack plan. Think adversarially.

**Ask yourself:**
- What would a motivated attacker do FIRST?
- What is the single highest-impact action available given this recon data?
- Are there any attack chains where vulnerability A enables vulnerability B?
- What is the worst-case outcome if all findings are exploited in sequence?

**Prioritize in this order:**
1. Exposed secrets (anon keys, API keys) — immediate critical impact
2. Authentication bypasses — full account takeover
3. Authorization flaws (IDOR, RLS bypass) — data exfiltration
4. Injection vulnerabilities — persistent impact
5. Security misconfigurations — information disclosure or privilege escalation
6. Missing headers/CSRF — moderate impact

**For Supabase targets specifically:**
- If an anon key is exposed: can it access tables directly via REST?
- If RLS is missing or misconfigured: what data is readable/writable?
- If a service_role key is present: that is full database compromise

**For each attack chain, be specific:**
- Exact endpoint URL
- Exact HTTP method and headers to use
- What you expect to see in the response that confirms the vulnerability
- Whether a safe GET/OPTIONS probe can confirm it before attempting anything destructive${writeProbesEnabled ? "\n- Whether a write probe (POST/PUT/DELETE/PATCH) would provide stronger evidence" : ""}
- CVSS estimate with reasoning

Reason step by step through the recon data. Then emit your attack plan:

\`\`\`json
{
  "attack_chains": [
    {
      "id": "chain-1",
      "target_endpoint": "/api/endpoint",
      "vulnerability_type": "SQL Injection",
      "estimated_severity": "high",
      "estimated_cvss": 8.5,
      "rationale": "Why this endpoint is likely vulnerable based on recon evidence",
      "attack_steps": [
        "Step 1: Send GET /api/users with Authorization: Bearer <anon_key>",
        "Step 2: Check if response returns user records without ownership filter",
        "Step 3: Attempt to access /api/users?id=1 vs /api/users?id=2 to confirm IDOR"
      ],
      "safe_probe": {
        "method": "GET",
        "url": "/endpoint",
        "headers": {},
        "expected_evidence": "What a 200 response with user data would prove"
      },
      "write_probe": ${writeProbesEnabled ? `{
        "method": "POST | PUT | DELETE | PATCH",
        "url": "/api/endpoint",
        "headers": {},
        "body": "{\\"key\\": \\"value\\"}",
        "content_type": "application/json",
        "expected_evidence": "What a 200/201 response would prove about the vulnerability",
        "probe_category": "idor | auth_bypass | mass_assignment | csrf"
      }` : "null"} ,
      "idor_test_urls": [],
      "prerequisites": "Supabase anon key from bundle (if applicable)",
      "chainable_with": ["chain-2"],
      "worst_case_impact": "All user records exfiltrated"
    }
  ],
  "attack_narrative": "In the worst-case scenario, an attacker would first... then... leading to...",
  "deprioritized": [
    {
      "target_endpoint": "/endpoint",
      "reason": "Why this was not selected for active exploitation"
    }
  ]
}
\`\`\``;
}
