# MeetingMetric — Architecture

MeetingMetric turns a meeting transcript into per-speaker contribution metrics,
an efficiency score, an executive summary, and coaching. This document explains
how the pieces fit together.

## 1. System topology

```
┌─────────────────────────┐         HTTPS / JSON          ┌──────────────────────────┐
│  client/  (React SPA)   │  ───────────────────────────▶ │  server/  (Express API)  │
│  Vercel static hosting  │   Authorization: Bearer <JWT> │  Render web service      │
│  REACT_APP_API_URL ─────┼──▶                            │                          │
└─────────────────────────┘                               │  ┌────────────────────┐  │
                                                          │  │ analyze pipeline   │  │
                                                          │  └─────────┬──────────┘  │
                                                          │            ▼             │
                                                          │  SQLite (node:sqlite)    │
                                                          └────────────┬─────────────┘
                                                                       ▼
                                              Anthropic API  ·  Transformers.js  ·  MS Graph
```

- **client/** — Create React App SPA. Talks to the API only through `REACT_APP_API_URL`
  (baked in at build time). The JWT is held in `localStorage` and attached to every
  request by an Axios interceptor.
- **server/** — Express REST API. Stateless except for the SQLite database file.
- **Data** — a single SQLite database accessed via Node's built-in `node:sqlite`
  (synchronous). No external DB server.

## 2. Request flow

### Authentication
1. `POST /api/register` or `POST /api/login` → backend verifies credentials with
   `bcryptjs` and returns a signed JWT (`jsonwebtoken`, 7-day expiry).
2. The SPA stores the token and sends `Authorization: Bearer <token>` on every call.
3. `authMiddleware` validates the token and sets `req.user` for protected routes.

### Analyze a transcript
```
POST /api/meetings/analyze   (multipart: title, text | file, project_id?, scheduled_at?)
        │
        ├─ if a file is uploaded → pdf-parse extracts text (PDF) or read as UTF-8
        ├─ segmentTranscript()      → split into { speaker, text } turns
        ├─ aggregateTurnsBySpeaker()→ word counts, turn counts, talk ratios, utterance mix
        ├─ scoreDimensions()  ── 5 scores per speaker (see §3 cascade)
        ├─ buildCoaching[Claude]()  → per-speaker coaching text
        ├─ meetingEfficiencyScore() → 0–1 index (balance + decision density)
        ├─ embedText()/chunkText()  → embeddings for search (only when USE_ML=1)
        └─ persist meeting + speaker_results + meeting_chunks, return the full result
```

### Semantic search
`POST /api/search` embeds the query, compares it by cosine similarity against the
stored `meeting_chunks` embeddings, and returns the closest snippets. Requires
`USE_ML=1` (otherwise no embeddings exist to search).

## 3. Three-tier scoring cascade

Scoring degrades gracefully depending on what is configured. Each speaker's five
dimensions — **engagement, sentiment, collaboration, initiative, clarity** (0–1) —
are produced by the first available tier:

```
                   ┌─────────────────────────────────────────────┐
  ANTHROPIC_API_KEY set?  ──yes──▶ Tier 1: Claude (Sonnet)        │
                   │               5-dim scoring + tailored coaching
                   └──no──┐        (highest quality)              │
                          ▼                                       │
        USE_ML=1 (or unset)?  ──yes──▶ Tier 2: Transformers.js    │
                          │            zero-shot classification +  │
                          │            MiniLM embeddings (local)   │
                          └──no──┐     (no API, downloads models)  │
                                 ▼                                 │
                          Tier 3: Heuristic                        │
                          regex/keyword + talk-ratio math          │
                          (deterministic, zero dependencies)       │
                   └─────────────────────────────────────────────┘
```

- **Tier 1 — Claude.** Best quality; one call per speaker for scores, one for coaching.
- **Tier 2 — Transformers.js.** `Xenova/all-MiniLM-L6-v2` for embeddings and zero-shot
  labels. Runs locally; first run downloads model weights.
- **Tier 3 — Heuristic.** Pure functions over talk ratio, turn counts, and keyword
  classification (`metrics.js`, `classify.js`). Always available and used by the test
  suite — no network, no model, fully deterministic.

The meeting **efficiency score** is always computed by `meetingEfficiencyScore()`:
it starts from average engagement, penalises a dominant speaker (talk-ratio gap),
and rewards decision density.

## 4. Database schema (SQLite)

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `users` | accounts | `email` (unique), `password_hash`, `full_name`, `organisation`, `role` |
| `meetings` | one per analysis | `user_id`, `title`, `raw_text`, `summary`, `efficiency_score`, `dominant_speaker_alert`, `low_engagement_alert`, `project_id`, `scheduled_at` |
| `speaker_results` | per-speaker output | `meeting_id`, `speaker_name`, `word_count`, `turn_count`, `talk_ratio`, `scores_json`, `utterance_breakdown_json`, `coaching_text`, `embedding_json` |
| `meeting_chunks` | search index | `meeting_id`, `chunk_index`, `text_snippet`, `embedding_json` |
| `projects` | grouping | `user_id`, `name`, `description`, `color`, `department` |
| `teams_tokens` | MS Graph tokens | `user_id` (PK), `access_token`, `refresh_token`, `expires_at` |

Schema and lightweight migrations live in `server/src/lib/db.js` (idempotent
`CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN` guarded by `PRAGMA table_info`).

> **Persistence note:** on a free-tier host with an ephemeral filesystem the SQLite
> file is wiped on restart. For durable data, point `MEETINGMETRIC_DB` at a mounted
> persistent disk or migrate to a hosted Postgres.

## 5. Microsoft Teams OAuth flow (optional)

Enabled only when `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` are set
(`teams.isConfigured()`), using `@azure/msal-node` (authorization-code flow):

```
User ─▶ GET /api/teams/connect ─▶ getAuthUrl() ─▶ Microsoft login + consent
                                                        │  (scopes: User.Read,
                                                        │   Calendars.Read,
                                                        │   OnlineMeetings.Read,
                                                        │   OnlineMeetingTranscript.Read.All)
                                                        ▼
Microsoft ─▶ GET /api/teams/callback?code=… ─▶ acquireTokenByCode()
                                                        ▼
                                            saveTokens(userId, accessToken)  → teams_tokens
                                                        ▼
                          redirect back to FRONTEND_URL
```

Import path:
1. `GET /api/teams/meetings` → `listMeetings()` over `/me/onlineMeetings` (MS Graph).
2. `POST /api/teams/import` → fetch the `.vtt` transcript, `parseVttToPlaintext()`
   converts `<v Speaker>text</v>` cues into `Speaker: text`, then the standard
   analyze pipeline (§2) runs on it.

All Graph access is read-only and delegated (acts as the signed-in user).

## 6. Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React 18, React Router 6, Recharts, Axios (Create React App) |
| Backend | Node 22+, Express, `node:sqlite`, Multer, pdf-parse |
| Auth | bcryptjs, jsonwebtoken (JWT) |
| AI | Anthropic SDK (Claude), `@xenova/transformers` (MiniLM), heuristic fallback |
| Integrations | `@azure/msal-node` + Microsoft Graph |
| Tests / CI | `node:test`, GitHub Actions |
| Hosting | Vercel (client) · Render (server) |
