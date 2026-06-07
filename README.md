# MeetingMetric

Turn a meeting transcript into per-speaker contribution metrics, an efficiency score, an executive summary, and coaching — for HR and team-effectiveness use.

![CI](https://github.com/sshubh4/MeetingMetric/actions/workflows/ci.yml/badge.svg)

**Live demo:** _deploying to Vercel — URL coming soon_
**Architecture:** [docs/architecture.md](docs/architecture.md)

<!-- Add a screenshot at docs/screenshots/dashboard.png and reference it here:
![Dashboard](docs/screenshots/dashboard.png) -->

---

## What it does

Paste or upload a transcript (`Speaker: text`, plain text, or PDF) and MeetingMetric returns:

- **Per-speaker scores** — engagement, sentiment, collaboration, initiative, clarity (0–1)
- **Conversation structure** — talk ratio, turn count, and an utterance mix (ideas / questions / decisions / filler)
- **Meeting efficiency index** — a 0–100 score that penalises a dominant speaker and rewards decision density
- **Executive summary + coaching** — a short summary and per-speaker coaching notes
- **Dashboards & history** — efficiency trends, last-30-day stats, alerts, and a searchable meeting archive
- **Semantic search** — find moments across past meetings by meaning (requires `USE_ML=1`)

### App sections (sidebar)

`Dashboard` · `Analyze` · `Meetings` · `Intelligence` (semantic search) · `Reports` · `Team` · `Projects` · `Calendar` · `Settings`

## How scoring works (three-tier cascade)

Scoring degrades gracefully based on what you configure — the first available tier is used:

1. **Claude** (`ANTHROPIC_API_KEY` set) — Sonnet does 5-dimension scoring and tailored coaching. Highest quality.
2. **Transformers.js** (`USE_ML=1`) — local MiniLM embeddings + zero-shot classification. No API; downloads models on first run.
3. **Heuristic** (`USE_ML=0`) — deterministic talk-ratio math and keyword classification. Always available, zero dependencies, and what the test suite runs against.

Full details, diagrams, and the DB schema are in [docs/architecture.md](docs/architecture.md).

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React 18, React Router 6, Recharts, Axios (Create React App) |
| Backend | Node 22+, Express, `node:sqlite`, Multer, pdf-parse |
| Auth | bcryptjs + JWT |
| AI | Anthropic SDK · `@xenova/transformers` · heuristic fallback |
| Integrations | `@azure/msal-node` + Microsoft Graph |
| Tests / CI | `node:test` · GitHub Actions |
| Hosting | Vercel (client) · Render (server) |

## Project structure

```
MeetingMetric/
├── client/                 # React SPA (Vercel)
│   ├── src/
│   │   ├── components/      # pages + UI
│   │   └── api.js           # API client (uses REACT_APP_API_URL)
│   └── vercel.json          # SPA rewrites
├── server/                  # Express API (Render)
│   ├── src/
│   │   ├── lib/             # auth, db, segment, metrics, classify, embeddings, teams, analyzePipeline
│   │   └── server.js
│   ├── test/                # node:test suites
│   ├── seed.js              # demo user + sample transcripts
│   └── .env.example
├── docs/
│   ├── architecture.md
│   └── screenshots/
└── .github/workflows/ci.yml
```

## Requirements

- **Node.js 22+** (the backend uses the built-in [`node:sqlite`](https://nodejs.org/api/sqlite.html))

## Local development

Run the API and the client in two terminals.

**1. Backend**
```bash
cd server
cp .env.example .env      # fill in secrets — or leave defaults for heuristic mode
npm install
npm start                 # http://localhost:5200
```

**2. Frontend**
```bash
cd client
npm install
npm start                 # http://localhost:3000  (proxies /api to :5200)
```

### Seed demo data (optional)

```bash
cd server
npm run seed
```

Then sign in with:

| Field | Value |
|-------|-------|
| Email | `demo@meetingmetric.local` |
| Password | `Demo123!` |

The seed adds three multi-speaker transcripts across two projects with calendar dates. The backend also auto-seeds this account on first startup against an empty database.

### Tests

```bash
cd server
npm test                  # node:test — scoring pipeline + auth
```

## Environment variables

See [`server/.env.example`](server/.env.example) for the full list. The essentials:

| Variable | Meaning |
|----------|---------|
| `JWT_SECRET` | Token signing secret — **required in production** (`openssl rand -hex 32`) |
| `CORS_ORIGIN` | Allowed browser origin(s); comma-separated, supports `*.vercel.app` |
| `ANTHROPIC_API_KEY` | Enables Claude scoring + coaching (Tier 1) |
| `USE_ML` | `1` = local Transformers.js models (Tier 2); `0` = heuristic only (Tier 3) |
| `PORT` | API port (default `5200`) |
| `MEETINGMETRIC_DB` | Path to the SQLite file (default `server/data/meetingmetric.db`) |

## Deployment

**Backend → Render**
1. **New → Web Service**, connect the repo, **Root Directory:** `server`
2. Build: `npm install` · Start: `npm start` · Node `22`
3. Set env vars: `JWT_SECRET`, `ANTHROPIC_API_KEY`, `USE_ML=0`, and `CORS_ORIGIN` / `FRONTEND_URL` = your Vercel URL

**Frontend → Vercel**
1. **Add New → Project**, import the repo, **Root Directory:** `client`
2. Framework preset: Create React App (auto-detected)
3. Env var: `REACT_APP_API_URL` = your Render URL (baked in at build time)
4. Deploy, then set Render's `CORS_ORIGIN` to the Vercel URL and redeploy the backend

> **Persistence:** Render's free tier has an ephemeral filesystem — the SQLite DB and uploads are wiped on restart. For durable data, attach a persistent disk (point `MEETINGMETRIC_DB` at it) or migrate to a hosted Postgres.

## Microsoft Teams integration (optional)

Import meeting transcripts directly from Teams via Microsoft Graph (read-only, delegated).

1. **[portal.azure.com](https://portal.azure.com)** → **App registrations** → **New registration**
2. Redirect URI (Web): `http://localhost:5200/api/teams/callback` (dev) / `https://<your-api-host>/api/teams/callback` (prod)
3. **Certificates & secrets** → new client secret
4. **API permissions** → Microsoft Graph → Delegated: `User.Read`, `Calendars.Read`, `OnlineMeetings.Read`, `OnlineMeetingTranscript.Read.All`
5. Set `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_REDIRECT_URI`, `FRONTEND_URL` on the backend

Flow: connect → Microsoft consent → token stored per-user → list online meetings → import a `.vtt` transcript → it runs through the standard analyze pipeline. Details in [docs/architecture.md](docs/architecture.md#5-microsoft-teams-oauth-flow-optional).

## Roadmap — not built

A **real-time Teams bot** (Level 3) is the intended next step but is **not implemented**. It would auto-join scheduled meetings, capture diarized transcription live (Azure Speech-to-Text / Whisper), and trigger analysis automatically when the meeting ends. This needs Azure Bot Service registration, a Teams app manifest with media permissions, and resource-specific consent for auto-join. Documented here as direction, not a current feature.

## Privacy & ethics

Intended for team-effectiveness and development use **with clear participant consent**. Outputs are explainable (scores plus transcript excerpts). Tune retention and policy for your jurisdiction.
