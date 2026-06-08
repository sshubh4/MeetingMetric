# MeetingMetric

![CI](https://github.com/sshubh4/MeetingMetric/actions/workflows/ci.yml/badge.svg)

AI-powered meeting intelligence platform. Analyzes transcripts to surface engagement, sentiment, collaboration, initiative, and clarity scores per speaker — with multi-tenant RBAC, Teams auto-ingestion, and a modern dark-mode React UI.

## Features

- **5-dimension AI scoring** per speaker: engagement, sentiment, collaboration, initiative, clarity
- **Meeting efficiency index** — single 0–100 score per meeting
- **Semantic search** across all transcript chunks (embeddings via Xenova Transformers)
- **Multi-tenant organizations** — isolated data per org, no cross-org leakage
- **RBAC** — four roles: `admin`, `hr`, `manager`, `employee`
- **Speaker alias system** — link transcript names to user accounts, backfills past meetings
- **Microsoft Teams auto-ingestion** — background poll every 5 minutes for new meeting transcripts
- **VTT parser** — WebVTT transcript ingestion with full edge-case handling
- **PDF export** — per-user review export via pdfkit
- **Org roster & invite system** — invite-link based onboarding with token expiry
- **Projects** — group meetings by initiative, track performance per project
- **Reports** — 5-dimension trend charts, top performers, project breakdown, CSV export
- **Calendar** — local + Teams events merged on a monthly grid
- **Pino structured logging** — machine-readable JSON logs
- **Zod validation** + express-rate-limit on auth endpoints

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 (`node:sqlite` DatabaseSync) |
| API server | Express 4, multer, cors, dotenv |
| Auth | JWT (jsonwebtoken), bcryptjs |
| AI | Anthropic Claude (analysis), Xenova Transformers (embeddings) |
| Teams | Microsoft Graph API via `@azure/msal-node` |
| Logging | pino |
| Validation | zod |
| Frontend | React 18, React Router 6, Recharts, Tailwind CSS v3 |
| Toast | react-hot-toast |

## Quick start

### Prerequisites

- Node.js 22.5+
- An Anthropic API key

### 1. Install dependencies

```bash
cd server && npm install
cd ../client && npm install
```

### 2. Configure environment

```bash
cp server/.env.example server/.env
# Edit server/.env — set JWT_SECRET and ANTHROPIC_API_KEY at minimum
```

### 3. Start the server

```bash
cd server && npm start
```

The server auto-creates the SQLite database, runs additive migrations, and seeds the demo account on first boot.

**Demo credentials:** `demo@meetingmetric.local` / `Demo123!`

### 4. Start the client

```bash
cd client && npm start
```

Visit `http://localhost:3000`.

## Environment variables

See `server/.env.example` for the full list with descriptions.

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | Yes | Secret for signing JWTs (min 32 chars in production) |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for transcript analysis |
| `PORT` | No | Server port (default 3001) |
| `USE_ML` | No | Enable embeddings for semantic search (`1` = enabled, default) |
| `AZURE_CLIENT_ID` | No | Azure AD app ID for Teams integration |
| `AZURE_CLIENT_SECRET` | No | Azure AD client secret |
| `AZURE_REDIRECT_URI` | No | OAuth callback URL (must match Azure app registration) |
| `LOG_LEVEL` | No | Pino log level: `trace`, `debug`, `info`, `warn`, `error` (default `info`) |

## Teams integration

See [SETUP.md](./SETUP.md) for step-by-step Azure AD app registration.

## Running tests

```bash
cd server && npm test
```

Runs all test files under `server/tests/` with Node's built-in test runner.

- `tests/vttParser.test.js` — 8 unit tests for the WebVTT parser
- `tests/rbac.test.js` — 10 integration tests covering auth, RBAC, and org management

## Project structure

```
MeetingMetric/
├── server/
│   ├── src/
│   │   ├── server.js           # Express app, all routes
│   │   ├── lib/
│   │   │   ├── db.js           # DatabaseSync schema + migrations
│   │   │   ├── auth.js         # JWT sign/verify helpers
│   │   │   ├── vttParser.js    # WebVTT -> [{speaker, text, timestamp}]
│   │   │   ├── teams.js        # TeamsService (Graph API)
│   │   │   └── pollService.js  # Background Teams auto-ingestion
│   │   ├── middleware/
│   │   │   └── auth.js         # requireAuth, requireRole, requireSameOrg
│   │   └── analyzePipeline.js  # AI analysis pipeline
│   ├── tests/
│   │   ├── vttParser.test.js
│   │   └── rbac.test.js
│   └── seed.js                 # Demo account auto-seed
└── client/
    └── src/
        ├── components/         # All React page components
        ├── hooks/useAuth.js    # JWT decode hook
        └── api.js              # Axios API client
```

## RBAC roles

| Role | Capabilities |
|---|---|
| `admin` | Full access: manage users, change roles, deactivate accounts, view org roster |
| `hr` | View org roster, generate invite links, export reviews |
| `manager` | Team view (direct reports), org benchmarks |
| `employee` | Own meetings, personal profile, speaker aliases |

## Speaker aliases

Users can add aliases (e.g. "Sarah C.", "Sarah Chen") under My Profile. MeetingMetric links historical transcript entries to the user account and backfills speaker_results retroactively.

## API reference

All endpoints require `Authorization: Bearer <token>` except `/health` and `/api/auth/*`.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | Public | Create org or join via invite |
| POST | `/api/auth/login` | Public | Get JWT |
| GET | `/api/me` | Any | Own profile + stats |
| GET | `/api/me/aliases` | Any | Speaker aliases |
| POST | `/api/me/aliases` | Any | Add alias |
| DELETE | `/api/me/aliases/:alias` | Any | Remove alias |
| GET | `/api/org/roster` | hr/admin | All org members |
| POST | `/api/org/invite` | hr/admin | Create invite link |
| PATCH | `/api/org/users/:id` | hr/admin | Update role/manager |
| DELETE | `/api/org/users/:id` | admin | Deactivate user |
| GET | `/api/org/benchmarks` | Any | Org-level avg scores (5-min cache) |
| POST | `/api/org/review-export` | hr/admin | PDF review export via pdfkit |
| POST | `/api/meetings/analyze` | Any | Upload + analyze transcript |
| GET | `/api/meetings` | Any | List meetings (scoped by role) |
| GET | `/api/meetings/:id` | Any | Meeting detail + speakers |
| GET | `/api/dashboard` | Any | Executive stats + trend data |
| GET | `/api/reports` | Any | Aggregated reports |
| GET | `/api/team/participants` | Any | Team performance roster |
| POST | `/api/search` | Any | Semantic search |
| GET | `/api/teams/poll-status` | Any | Auto-ingestion status |
| POST | `/api/teams/poll-now` | Any | Trigger immediate poll |
| GET | `/health` | Public | Health check |

## License

MIT
