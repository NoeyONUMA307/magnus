# Magnus

AI-powered security scanner for solo developers. Crawl your web app, find vulnerabilities, get fix guides. Self-hosted. Model-agnostic. Your data stays yours.

https://github.com/user-attachments/assets/ef85732a-c8b3-4528-bf97-7969b421578a

<img width="2370" height="1768" alt="Magnus scanning dashboard" src="https://github.com/user-attachments/assets/0c217f83-57eb-4b06-912e-398d3fd24f07" />

## How It Works

Magnus runs a 5-phase autonomous scan against any URL:

1. **Recon** — crawls the target (BFS + Puppeteer SPA rendering), extracts forms, intercepts API calls, scans JS bundles for secrets, checks security headers and CORS
2. **Planning** — LLM generates prioritized attack chains with CVSS estimates
3. **Exploitation** — executes real HTTP probes, LLM analyzes responses to confirm or reject
4. **Browser Confirmation** — Puppeteer proves XSS with a 4-level evidence system and LLM-guided bypass exhaustion
5. **Reporting** — executive summary, per-finding AI commentary, fix guides with code diffs

## Quick Start

```bash
git clone git@github.com:carolinacherry/magnus.git
cd magnus
cp .env.example .env     # add your API key(s)
docker compose up
```

Open `http://localhost:3001`. That's it.

### Try It Out

Scan a deliberately vulnerable target to see Magnus in action:

```bash
# Start OWASP Juice Shop (intentionally vulnerable app)
docker run -d -p 3000:3000 bkimminich/juice-shop

# Then scan it with Magnus at http://localhost:3001
# Target URL: http://host.docker.internal:3000
```

## Features

### Scanning
- **Web crawling** — BFS crawler follows links, parses sitemaps/robots.txt, extracts forms, discovers API routes from JS bundles (50 pages, depth 3)
- **SPA-aware rendering** — Puppeteer renders JavaScript-heavy pages, intercepts fetch/XHR to find API endpoints invisible to HTTP crawlers
- **Authenticated scanning** — thread cookies, JWTs, or API keys through all phases to test behind-login attack surfaces
- **IDOR detection** — auto-generates requests with modified resource IDs, tests with no-auth and alg:none JWT
- **Write probes (opt-in)** — POST/PUT/DELETE/PATCH probes for auth bypass, mass assignment, CSRF with category-specific follow-ups
- **OpenAPI ingestion** — paste a spec, endpoints merge into the attack surface
- **XSS proof system** — 4-level proof hierarchy (blocked → reflected → JS confirmed → impact demonstrated), up to 12 payloads across 4 bypass rounds

### Findings
- **Confidence tiers** — Confirmed (browser-proved), Firm (HTTP evidence), Tentative (LLM inference)
- **CVSS scoring** with CWE/OWASP classification
- **Remediation workflow** — track findings from New through Fixed with status management
- **AI commentary** and fix guides with code diffs on every finding

### Integrations
- **CI/CD** — `POST /api/scan/trigger` with webhook callback and pass/fail signal
- **GitHub PR comments** — auto-posts scan summary on PRs
- **Slack/Discord webhooks** — notifications on every scan completion
- **Security badge** — embeddable SVG risk score for your README
- **Scheduled scans** — recurring scans with full configuration
- **Finding diff** — tracks new/fixed/unchanged between scans
- **PDF export** and shareable report links

### LLM Providers
- **Anthropic** — Claude Opus, Sonnet, Haiku
- **OpenAI** — GPT-5.2, 5.1, o4-mini, 4o
- **Ollama** — any local model, fully on-device (nothing leaves your machine)

Switch providers anytime in Settings. Persisted in SQLite.

## Privacy

Your results stay local. No Magnus account. No cloud. No telemetry.

- Findings stored in SQLite on your machine
- AI analysis routed through your chosen provider
- Run with Ollama for fully air-gapped scanning

## Local Development

```bash
git clone git@github.com:carolinacherry/magnus.git
cd magnus
npm install
cp .env.example .env
npm run dev
```

Frontend: `http://localhost:5173` | Backend: `http://localhost:3001`

### Environment Variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key (required for Anthropic provider) |
| `OPENAI_API_KEY` | OpenAI API key (required for OpenAI provider) |
| `PORT` | Backend server port (default: `3001`) |
| `CORS_ORIGIN` | Allowed CORS origins (default: `http://localhost:5173`) |
| `MAGNUS_URL` | Base URL for GitHub PR comment links (default: `http://localhost:5173`) |
| `VITE_API_URL` | Frontend API base URL (only if backend is on a different origin) |
| `PUPPETEER_EXECUTABLE_PATH` | Custom Chromium path (auto-detected in Docker) |

## Tech Stack

React 18 + TypeScript + Vite | Node.js + Express | SQLite | Puppeteer | Anthropic SDK + OpenAI SDK + Ollama

## CI/CD Integration

Gate deploys on security findings:

```yaml
- name: Security scan
  run: |
    RESULT=$(curl -s -X POST ${{ secrets.MAGNUS_URL }}/api/scan/trigger \
      -H "Content-Type: application/json" \
      -d '{"url": "${{ secrets.STAGING_URL }}"}')
    SCAN_ID=$(echo $RESULT | jq -r .scan_id)
    while true; do
      STATUS=$(curl -s ${{ secrets.MAGNUS_URL }}/api/scan/trigger/$SCAN_ID | jq -r .status)
      [ "$STATUS" = "complete" ] || [ "$STATUS" = "failed" ] && break
      sleep 30
    done
    PASS=$(curl -s ${{ secrets.MAGNUS_URL }}/api/scan/trigger/$SCAN_ID | jq -r .pass)
    [ "$PASS" = "true" ] || (echo "Security scan failed" && exit 1)
```

See the full [API reference](#api-reference) for trigger options including auth headers, OpenAPI specs, write probes, and GitHub PR integration.

## API Reference

<details>
<summary>All endpoints</summary>

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/scans` | Create new scan |
| `GET` | `/api/scans` | List all scans |
| `GET` | `/api/scans/:id` | Get scan with severity counts |
| `GET` | `/api/scans/:id/diff` | Finding diff against previous scan |
| `GET` | `/api/findings` | List findings (optional `?scan_id=`) |
| `GET` | `/api/findings/:id` | Get single finding |
| `PATCH` | `/api/findings/:id` | Update finding status |
| `GET` | `/api/stream/:scanId` | SSE stream of agent logs |
| `GET` | `/api/settings` | Get all settings |
| `PUT` | `/api/settings` | Update setting |
| `POST` | `/api/integrations/test-webhook` | Test webhook delivery |
| `POST` | `/api/integrations/test-github` | Validate GitHub token |
| `GET` | `/api/badge/:url` | SVG risk score badge |
| `GET` | `/api/ollama/models` | List local Ollama models |
| `GET` | `/api/scheduled-scans` | List scheduled scans |
| `POST` | `/api/scheduled-scans` | Create scheduled scan |
| `PATCH` | `/api/scheduled-scans/:id` | Update scheduled scan |
| `DELETE` | `/api/scheduled-scans/:id` | Delete scheduled scan |
| `POST` | `/api/scan/trigger` | CI/CD trigger |
| `GET` | `/api/scan/trigger/:id` | Poll scan status |
| `POST` | `/api/shared-reports` | Create share link |
| `GET` | `/api/shared-reports` | List share links |
| `DELETE` | `/api/shared-reports/:id` | Revoke share link |
| `GET` | `/share/:token` | Public report page |
| `GET` | `/api/evidence/:scanId/:findingId/:filename` | Download evidence |

</details>

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT
