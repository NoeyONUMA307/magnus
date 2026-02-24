# Contributing to Magnus

Thanks for your interest in contributing. Here's how to get started.

## Setup

```bash
git clone git@github.com:carolinacherry/magnus.git
cd magnus
npm install
cp .env.example .env    # add at least one API key
npm run dev
```

Frontend runs on `http://localhost:5173`, backend on `http://localhost:3001`.

## Project Structure

```
magnus/
├── frontend/          # React + TypeScript + Vite
│   └── src/
│       ├── components/
│       ├── pages/
│       └── App.tsx
├── backend/           # Node.js + Express + TypeScript (ESM)
│   └── src/
│       ├── agent/     # Scan pipeline (recon, planning, exploitation, browser-confirm, reporting)
│       ├── lib/       # Shared utilities (db, llm, http, tokens)
│       ├── routes/    # Express route handlers
│       └── types/     # TypeScript types
└── docker-compose.yml
```

## Development Workflow

1. **Check existing issues** — look for `good first issue` or `help wanted` labels
2. **Create a branch** — `git checkout -b your-feature`
3. **Make changes** — follow existing patterns in the codebase
4. **Test** — run `cd backend && npm test` to verify nothing broke
5. **Type check** — run `cd backend && npx tsc --noEmit`
6. **Submit a PR** — describe what you changed and why

## Code Style

- TypeScript everywhere (frontend and backend)
- `const` over `let`, named exports, early returns
- No comments for self-evident code; explain "why" for non-obvious decisions
- Backend uses ESM (`.js` extensions in imports)
- Frontend uses plain CSS with custom properties (no CSS-in-JS, no Tailwind)

## Testing

```bash
cd backend
npm test          # run all tests
npx tsc --noEmit  # type check
```

Tests use Vitest. Add tests for new pure functions. Integration tests for Puppeteer or LLM features are not required.

## Architecture Notes

**Agent pipeline** — each scan runs through 5 phases sequentially. Each phase is in `backend/src/agent/phases/`. Prompts are in `backend/src/agent/prompts/`.

**LLM abstraction** — `backend/src/lib/llm.ts` provides a unified streaming interface across Anthropic, OpenAI, and Ollama. All LLM calls go through `streamChat()`.

**Database** — SQLite via better-sqlite3. Schema is in `backend/src/lib/db.ts`. No migrations — the schema is created on first run.

**SSE streaming** — agent logs are written to the database and streamed to the frontend via Server-Sent Events at `/api/stream/:scanId`.

## What to Work On

Check the [issues](https://github.com/carolinacherry/magnus/issues) for current priorities. Good areas for contribution:

- **New detection rules** — add probe patterns in the exploitation phase
- **Frontend improvements** — UX polish, accessibility, mobile experience
- **Documentation** — usage guides, examples, deployment docs
- **Testing** — more unit tests for pure functions in `backend/src/agent/`
