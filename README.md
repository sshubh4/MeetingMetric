# MeetingMetric

![CI](https://github.com/sshubh4/MeetingMetric/actions/workflows/ci.yml/badge.svg)

> 🎬 **Demo:** _demo GIF coming soon — `docs/demo.gif`_

MeetingMetric is an AI-powered meeting intelligence platform: it ingests
transcripts (manual upload, Microsoft Teams auto-polling, or a live bot) and
scores every speaker on engagement, sentiment, collaboration, initiative, and
clarity. A multi-tenant, RBAC-secured dashboard gives employees personal
trends, managers team views, and HR org-wide benchmarks and review exports.
Under the hood, every analysis feeds both a transactional SQLite store and a
medallion data lake (bronze → silver → gold) that powers a Glue/Athena/dbt
analytics stack orchestrated daily by Airflow.

## Architecture

```
                       ┌────────────────────────────────────────────────┐
                       │                  INGESTION                     │
  Teams Graph API ──►  │  poll service (5 min) ──► VTT parser           │
  Manual upload  ───►  │  text / PDF extraction                         │
  Live bot       ───►  │  JSON transcript                               │
                       └───────────────────┬────────────────────────────┘
                                           ▼
                       ┌────────────────────────────────────────────────┐
                       │        ANALYZE PIPELINE (runMeetingPipeline)   │
                       │  3-tier AI scoring:                            │
                       │    Claude API → Transformers.js → heuristics   │
                       │  + data-quality validation + pipeline_runs     │
                       └─────────┬───────────────────────┬──────────────┘
                                 ▼                       ▼
                  ┌──────────────────────┐   ┌───────────────────────────┐
                  │ SQLite (node:sqlite) │   │  DATA LAKE (local or S3)  │
                  │ transactional store  │   │  bronze/  raw transcripts │
                  │ meetings, speakers,  │   │  silver/  flat speaker    │
                  │ users, orgs, runs    │   │           records (JSON)  │
                  └──────────┬───────────┘   │  gold/    aggregates      │
                             │               └───────────┬───────────────┘
                             ▼                           ▼
                  ┌──────────────────────┐   ┌───────────────────────────┐
                  │  REST API + React    │   │  Glue crawler → catalog   │
                  │  dashboard (live)    │   │  Glue ETL → gold Parquet  │
                  └──────────────────────┘   │  Athena ◄── dbt models    │
                                             │           + tests         │
                                             └───────────┬───────────────┘
                                                         ▼
                                             ┌───────────────────────────┐
                                             │  Airflow daily DAG:       │
                                             │  check silver → Glue ETL  │
                                             │  → dbt run → dbt test     │
                                             └───────────────────────────┘
```

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 (`node:sqlite` DatabaseSync) |
| API server | Express 4, multer, cors, zod, express-rate-limit, pino |
| Auth | JWT (jsonwebtoken), bcryptjs, invite tokens, 4-role RBAC |
| AI scoring | Anthropic Claude → `@xenova/transformers` zero-shot → heuristics |
| Embeddings | Xenova all-MiniLM-L6-v2 (semantic search over transcript chunks) |
| Teams | Microsoft Graph API via `@azure/msal-node`, WebVTT parser |
| Data lake | Medallion (bronze/silver/gold), local FS or S3 (`@aws-sdk/client-s3`) |
| Batch analytics | AWS Glue (crawler + PySpark ETL), Athena, dbt (`dbt-athena-community`) |
| Orchestration | Apache Airflow (daily DAG, local docker-compose) |
| CI | GitHub Actions: server tests (node:test + Jest), client build, dbt parse |
| Frontend | React 18, React Router 6, Recharts, Tailwind CSS |

## Data model

Key tables (SQLite, additive `ALTER TABLE` migrations on boot):

| Table | Purpose |
|---|---|
| `organizations` | Multi-tenant boundary; every query is org-scoped |
| `users` | Accounts with `role` (admin/hr/manager/employee) and `manager_id` hierarchy |
| `meetings` | One row per analyzed meeting: efficiency score, alerts, `source` (manual / teams_auto / teams_import / bot), Teams ids, `scheduled_at` + `created_at` |
| `speaker_results` | One row per speaker per meeting. Scores live in **normalized columns** (`score_engagement`, `score_sentiment`, `score_collaboration`, `score_initiative`, `score_clarity`, plus `ub_ideas/questions/decisions/filler` utterance counts). Legacy `scores_json` is still written for back-compat but no longer read anywhere |
| `pipeline_runs` | Telemetry for every analysis: started/completed timestamps, `duration_ms`, `speaker_count`, `scoring_method` actually used (claude / transformers / heuristic), `source`, success/error, and a JSON array of `quality_warnings` |
| `speaker_aliases` | Maps transcript display names → user accounts per org (with retroactive backfill) |
| `projects` | Groups meetings by initiative |
| `meeting_chunks` | Embedded transcript chunks for semantic search |
| `invite_tokens`, `teams_tokens`, `transcript_poll_state` | Onboarding + Teams integration state |

Silver-layer lake records are the flat, Parquet-ready projection of
`speaker_results` ⋈ `meetings` — one JSON object per speaker with all scores
as top-level numeric fields.

## Tech decisions

- **3-tier scoring fallback (Claude → Transformers.js → heuristics).** Best
  quality when an API key is present, zero-cost local ML when it isn't, and a
  deterministic heuristic floor so the pipeline *never* fails to score — CI
  and demos run with no network and no models. `pipeline_runs.scoring_method`
  records which tier actually ran for every analysis.
- **Polling over webhooks for Teams.** Graph change notifications require a
  public HTTPS endpoint, subscription lifecycle management, and tenant-admin
  consent that many orgs block. A 5-minute poll against
  `transcript_poll_state` is dramatically simpler, works behind NAT and on
  localhost, and transcripts already lag meeting end by minutes anyway.
- **Athena over Redshift.** The lake is small and queries are bursty and
  daily — serverless pay-per-scan beats a 24/7 warehouse cluster. Parquet plus
  org/date partition pruning keeps scans tiny, and `dbt-athena` gives the same
  modeling workflow with zero infrastructure to operate.
- **Dual-mode local/S3 lake.** One `DataLake` class and one key layout write
  to `./data-lake/` in dev and S3 in prod, so the medallion structure is
  testable in CI (the Jest e2e asserts bronze + silver files) and local dev
  never diverges from what Glue crawls. Lake writes are best-effort — a lake
  failure can never fail an ingest.
- **Speaker aliases.** Transcripts identify people by display name, which is
  unstable ("Dan Kim", "Daniel Kim (Eng)"). Aliases map names → accounts per
  org with retroactive backfill, keeping identity resolution explicit and
  auditable instead of guessing with fuzzy matching.

## Local quickstart

```bash
# 1. Server (Node 22.5+)
cd server
npm install
cp .env.example .env          # defaults work for local dev
SEED_DEMO=1 npm start         # boots on :5200, seeds the demo org on an empty DB
```

Seeding creates **Northwind Labs**: 10 users, 4 projects, and 60 meetings over
the past 6 months with deliberate story arcs (one improver, one decliner, a
manager who dominates airtime, low-engagement alerts). Log in as
`avery.thompson@demo.meetingmetric.local` / `Demo123!` (admin — all demo users
share the password).

```bash
# 2. Populate the local data lake from existing meetings (idempotent)
npm run backfill:lake         # writes ./data-lake/bronze + silver

# 3. Client
cd ../client
npm install
npm start                     # http://localhost:3000
```

Tests: `cd server && npm test` (node:test suites + Jest integration tests,
including an end-to-end analyze → lake → pipeline_runs assertion).

Teams integration setup (Azure AD app registration): see [SETUP.md](./SETUP.md).

## AWS deployment (batch analytics)

1. Set `STORAGE_MODE=s3` and the AWS variables in `server/.env`, then re-run
   `npm run backfill:lake` to hydrate the bucket.
2. **[aws/README.md](aws/README.md)** — Glue database + silver crawler, the
   gold PySpark ETL job, Athena workgroup + external tables, required IAM
   policies, and example queries.
3. **[dbt/README.md](dbt/README.md)** — staging + mart models over the Glue
   catalog with schema tests; `dbt deps / parse / run / test`.
4. **[airflow/README.md](airflow/README.md)** — the daily DAG that wires it
   together (`check silver → Glue ETL → dbt run → dbt test`) and how to run
   it locally with docker-compose.

## Environment variables (server)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5200` | API port |
| `JWT_SECRET` | — | **Required in production** (≥32 chars) |
| `CORS_ORIGIN` / `FRONTEND_URL` | `http://localhost:3000` | Allowed origins / redirect base |
| `ANTHROPIC_API_KEY` | unset | Enables Claude scoring + coaching (tier 1) |
| `USE_ML` | `1` | `0` disables Transformers.js scoring/embeddings (tier 2) |
| `MEETINGMETRIC_DB` | `server/data/meetingmetric.db` | SQLite path (`:memory:` for tests) |
| `SEED_DEMO` | auto | `1` force-seed an empty DB, `0` never seed; unset = seed in dev when empty |
| `STORAGE_MODE` | `local` | `local` → `server/data-lake/`, `s3` → bucket below |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` | placeholders | S3 credentials (missing → warn once, fall back to local) |
| `S3_BUCKET_NAME` | `meetingmetric-data-lake` | Lake bucket |
| `DATA_LAKE_DIR` | `server/data-lake` | Override the local lake root |
| `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_REDIRECT_URI` | unset | Teams integration (optional) |
| `LOG_LEVEL` | `info` | pino log level |

## RBAC roles

| Role | Capabilities |
|---|---|
| `admin` | Full access: manage users, change roles, deactivate accounts, org roster |
| `hr` | Org roster, invite links, reports, review exports |
| `manager` | Team view (direct reports), reports, org benchmarks |
| `employee` | Own meetings, personal profile + trends, speaker aliases |
