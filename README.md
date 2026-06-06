# MeetingMetric

AI meeting productivity tool for HR teams: **transcript → structured contribution metrics**, coaching, **Executive Suite** navigation (overview, calendar, projects), and semantic search.

## Features

- **Executive Suite UI** — sidebar: Overview, Calendar, Projects, Analyze, Intelligence (search), Reports, Archive, Settings
- **Auth** — register, login (JWT), protected routes
- **Projects** — create projects and tag analyses; meetings show project on detail + archive
- **Calendar** — month view of meetings (uses **scheduled date** from Analyze, or analyzed-at time)
- **Analyze** — meeting title, optional project, **datetime** for calendar, paste transcript, drag-and-drop upload
- **Scores** — engagement, sentiment, collaboration, initiative, clarity (0–1)
- **Structure** — talk ratio, turns, utterance breakdown (ideas / questions / decisions / filler)
- **Meeting detail** — efficiency gauge, executive summary, coaching panel, participant cards with radar charts
- **Dashboard** — efficiency trend, **last-30-day stats** (meetings, avg efficiency, participation index, unique participants), alerts
- **Archive** — sortable table of all meetings
- **Search** — semantic search over indexed chunks (requires `USE_ML` for embeddings)

## Requirements

- **Node.js 22+** (uses built-in [`node:sqlite`](https://nodejs.org/api/sqlite.html))
- Two terminals for local development

## Run locally

**1. Backend** (API + SQLite DB):

```bash
cd website/backend
npm install
npm start
```

Default: `http://localhost:5200`. Optional env:

| Variable | Meaning |
|----------|---------|
| `ANTHROPIC_API_KEY` | **Claude AI** — best quality scoring + AI coaching (recommended) |
| `USE_ML=0` | Fast **heuristic** scoring only (no model download, no API) |
| `USE_ML=1` or unset | **Transformers.js** zero-shot + embeddings (first run downloads models) |
| `JWT_SECRET` | Secret for production |
| `PORT` | API port (default `5200`) |
| `MEETINGMETRIC_DB` | Path to SQLite file |

**AI priority:** `ANTHROPIC_API_KEY` (Claude) → Transformers.js (`USE_ML`) → heuristic fallback. When Claude is configured, scoring uses Claude Sonnet for 5-dimension analysis and personalized coaching per speaker.

**2. Frontend (React)**

```bash
cd website/pdf-upload-app
npm install
npm start
```

Opens `http://localhost:3000` with a **proxy** to the API on port 5200.

### Demo data (optional)

Seed a **dummy user** and **three realistic multi-speaker transcripts** (projects + calendar dates):

```bash
cd website/backend
npm run seed
```

Then sign in on the app:

| Field | Value |
|-------|--------|
| **Email** | `demo@meetingmetric.local` |
| **Password** | `Demo123!` |

If the user already has meetings, the seed script skips inserts (delete `website/backend/data/meetingmetric.db` to start fresh).

**Brand:** Logo and UI accents use **cyan → blue** (`#55E7FC` → `#2B80FF`) on **`#0B0E14`** background — see `website/pdf-upload-app/public/brand-logo.png`.

**Production build** (serve `build/` from any static host; set `REACT_APP_API_URL` to your API origin if not same-origin).

## Architecture (high level)

- **Backend**: Node `express` — auth, `POST /api/meetings/analyze` (multipart: `title`, `text`, `file`, `project_id`, `scheduled_at`), `GET /api/meetings`, `GET /api/meetings/:id`, `GET /api/dashboard`, `GET /api/calendar?month=YYYY-MM`, `GET/POST /api/projects`, `POST /api/search`, Teams integration routes (`/api/teams/*`)
- **DB**: SQLite (`website/backend/data/meetingmetric.db` by default); migrations add `project_id` and `scheduled_at` on `meetings`; `teams_tokens` table for OAuth tokens
- **ML**: `@xenova/transformers` — zero-shot + MiniLM embeddings when `USE_ML` is on
- **Teams**: `@azure/msal-node` — OAuth2 authorization code flow with Microsoft Graph API

---

## Microsoft Teams Integration (Level 2)

Connect your Microsoft account to import meeting transcripts directly from Teams.

### Azure AD app registration

1. Go to **[portal.azure.com](https://portal.azure.com)** → **Azure Active Directory** → **App registrations** → **New registration**
2. **Name**: `MeetingMetric`
3. **Supported account types**: Accounts in any organizational directory and personal Microsoft accounts
4. **Redirect URI**: Select **Web** and enter:
   - Development: `http://localhost:5200/api/teams/callback`
   - Production: `https://<your-api-host>/api/teams/callback`
5. After creation, copy the **Application (client) ID**
6. Go to **Certificates & secrets** → **New client secret** → copy the **Value**
7. Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions**, add:
   - `User.Read`
   - `Calendars.Read`
   - `OnlineMeetings.Read`
   - `OnlineMeetingTranscript.Read.All`
8. Click **Grant admin consent** (or have your tenant admin do it)

### Environment variables

Add these to the backend (`.env` or hosting dashboard):

| Variable | Value |
|----------|-------|
| `AZURE_CLIENT_ID` | Application (client) ID from step 5 |
| `AZURE_CLIENT_SECRET` | Client secret value from step 6 |
| `AZURE_REDIRECT_URI` | `http://localhost:5200/api/teams/callback` (dev) |
| `FRONTEND_URL` | `http://localhost:3000` (dev) — where the OAuth callback redirects |

### How it works

1. User clicks **Connect with Microsoft** on the Teams page
2. They're redirected to Microsoft's login, consent to read-only meeting access
3. The backend exchanges the auth code for an access token, stores it in `teams_tokens`
4. The Teams page lists recent online meetings via the Graph API
5. Clicking **Import & Analyze** fetches the `.vtt` transcript, parses it to `Speaker: text` format, and runs the full analysis pipeline

---

## Roadmap: Teams Bot (Level 3)

> **Not built — documented here as an interview talking point for the enterprise vision.**

The next evolution is a **Teams meeting bot** that joins meetings automatically and captures transcripts in real time:

- **Bot Framework + Azure Communications Services** — register a Teams app with a bot that auto-joins scheduled meetings
- **Live transcription** — the bot captures meeting audio, pipes it to **Azure Speech-to-Text** (or Whisper) for real-time speaker-diarized transcription
- **Automatic analysis** — when the meeting ends, the bot triggers `analyzeTranscript()` with zero manual intervention; results appear in the dashboard immediately
- **Tech requirements**: Azure Bot Service registration, Teams app manifest (with `media` permissions), RSC (Resource-Specific Consent) for auto-join
- **Privacy**: Participants see a bot icon in the meeting; consent is transparent; recordings follow org policy

This transforms MeetingMetric from a manual import tool into an **always-on, zero-touch meeting intelligence platform** — the enterprise-grade vision.

---

## Deploy online (Vercel frontend + Render backend)

The **frontend** (React) is hosted on **Vercel**; the **backend** (Node API) runs on **Render**. They talk over HTTPS, locked down by CORS.

### Step 1: Deploy the backend to Render

1. Sign up at [render.com](https://render.com) (free tier works for portfolio)
2. **New → Web Service** → connect your GitHub repo
3. **Root directory**: `website/backend`
4. **Build command**: `npm install`
5. **Start command**: `node server.js`
6. **Node version**: Set to `22` in Render's environment (or add `.node-version` file with `22`)
7. **Environment variables** (add in Render dashboard):

| Variable | Value |
|----------|-------|
| `JWT_SECRET` | A strong random string (`openssl rand -hex 32`) — **required** |
| `CORS_ORIGIN` | Your Vercel origin, e.g. `https://meetingmetric.vercel.app` (set this **after** Step 2). Supports a comma-separated list and `*.vercel.app` for preview URLs |
| `FRONTEND_URL` | Same Vercel origin (used for the Teams OAuth redirect) |
| `ANTHROPIC_API_KEY` | Your Claude API key (for AI scoring + coaching) |
| `USE_ML` | `0` (skip local models — use Claude instead) |
| `AZURE_CLIENT_ID` | *(from Azure AD — optional for Teams)* |
| `AZURE_CLIENT_SECRET` | *(from Azure AD — optional for Teams)* |
| `AZURE_REDIRECT_URI` | `https://<your-render-url>/api/teams/callback` |

Note your Render URL (e.g. `https://meetingmetric-api.onrender.com`).

> **Persistence note:** Render's free tier has an **ephemeral filesystem** — the SQLite DB and uploads are wiped on every restart/redeploy. For data that survives, attach a Render **persistent disk** mounted where `MEETINGMETRIC_DB` points (and the `uploads/` dir), or migrate to a hosted Postgres.

### Step 2: Deploy the frontend to Vercel

1. Sign up at [vercel.com](https://vercel.com) and **Add New → Project** → import the `MeetingMetric` repo
2. **Root Directory**: `website/pdf-upload-app` (click *Edit* and select it — this is a monorepo subfolder)
3. **Framework Preset**: Create React App (auto-detected). Build command `npm run build`, output `build/`
4. **Environment Variable**: add `REACT_APP_API_URL` = your Render URL (e.g. `https://meetingmetric-api.onrender.com`)
5. **Deploy.** Vercel gives you a URL like `https://meetingmetric.vercel.app`
6. Go back to Render and set `CORS_ORIGIN` / `FRONTEND_URL` to that Vercel URL, then redeploy the backend

SPA deep links are handled by `vercel.json` (rewrites all paths to `index.html`).

### How it works

- **Frontend** (React) is served by Vercel at your `.vercel.app` URL (or a custom domain)
- **Backend** (Node.js API) runs on Render at your `.onrender.com` URL
- The frontend calls the backend using `REACT_APP_API_URL`, **baked in at build time** — changing it requires a redeploy
- CORS only accepts the origin(s) in `CORS_ORIGIN`

### Redeploying

- **Frontend**: push to `main` — Vercel auto-deploys (and builds a preview for every PR)
- **Backend**: Render auto-deploys on push (if connected to the repo)
- Changed `REACT_APP_API_URL`? Trigger a fresh Vercel build so the new value is baked in

---

## Privacy & ethics

Use for **development and meeting effectiveness**, with clear employee consent. Outputs are **explainable** (scores + transcript excerpts); tune policies for your jurisdiction.

## Legacy

Older scripts live under `.github/src/` (standalone Hugging Face CLI demo) and are not required for the web app.
