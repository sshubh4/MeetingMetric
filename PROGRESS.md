# Data Platform Upgrade — Progress

One continuous build upgrading MeetingMetric's data layer into a production-grade
data engineering platform. If this session is interrupted, resume from the first
unchecked item below. Each item is checked only after it is complete AND verified.

Key paths:
- Server: `server/src/server.js`, `server/src/lib/db.js`, `server/src/lib/analyzePipeline.js`
- Seeder: `server/seed.js` (invoked from server startup)
- Data lake: `server/src/lib/dataLake.js`, backfill at `server/scripts/backfill-datalake.js`
- AWS scripts: `aws/`, dbt: `dbt/`, Airflow: `airflow/`
- Tests: `server/tests/` (Jest + supertest), CI: `.github/workflows/ci.yml`

## Phase 0 — Recon
- [x] Read entire server/ codebase (db.js, server.js, src/lib/*, seed.js)
- [x] Confirm server boots clean (verified: /health → {ok:true} on temp DB)
- [x] Create PROGRESS.md

## Phase 1 — Schema normalization
- [x] 1a. ALTER TABLE speaker_results: score_engagement/sentiment/collaboration/initiative/clarity REAL, ub_ideas/questions/decisions/filler INTEGER
- [x] 1b. One-time boot migration backfilling new columns from scores_json / utterance_breakdown_json (guarded by WHERE score_engagement IS NULL)
- [x] 1c. Pipeline INSERTs write individual columns (keep scores_json writes); ALL reads in codebase moved to new columns (centralized in runMeetingPipeline; server.js + pollService now share it)
- [x] 1d. Indexes: idx_meetings_created, idx_meetings_org_created, idx_sr_org, idx_sr_user_meeting
- [x] 1e. pipeline_runs table created + wired into analyzePipeline.js (row at start, update on completion/failure with duration + scoring method via scoreDimensionsDetailed)
- [x] 1f. Inline data-quality validation in pipeline (score clamping to [0,1], non-empty speaker names, >=1 turn) recorded into pipeline_runs.quality_warnings

## Phase 2 — Query rewrites (server.js)
- [x] 2a. /api/reports N+1 → single LEFT JOIN + GROUP BY with AVG() on new columns (incl. projectBreakdown N+1)
- [x] 2b. /api/org/benchmarks → one SQL query with AVG() + date-range WHERE (parameterized days)
- [x] 2c. Calendar endpoint → SQL WHERE via strftime on COALESCE(scheduled_at, created_at)
- [x] 2d. Org roster correlated subqueries → LEFT JOINs with GROUP BY
- [x] 2e. filterClause/alertBase parameterized; whole-file audit clean (remaining ${} are fixed column names / ? placeholder lists)
- [x] Existing test suite (28 tests) passes after rewrites; shape spot-check with seeded data happens in final verification

## Phase 3 — Rich demo seeder
- [x] New seeder gated behind SEED_DEMO=1 (default on in dev if DB empty, never runs if data exists)
- [x] 1 org (Northwind Labs), 10 users (1 admin, 1 hr, 2 managers w/ reports, 6 employees) + 10 speaker_aliases
- [x] 60 meetings over past 6 months (verified 2025-12-13 → 2026-06-10), 42 manual / 18 teams_auto
- [x] 4 projects with meetings distributed round-robin
- [x] 4-7 speakers/meeting (verified); Liam trends up, Chloe trends down, Daniel Kim dominates (10 dominant alerts), 5 low-engagement meetings
- [x] Efficiency verified 0.36–0.92; new columns AND legacy JSON populated (0 NULL rows)
- [x] pipeline_runs row per seeded meeting (60); raw_text = plausible 5-10 turn snippets (verified sample)

## Phase 4 — Medallion data lake (local + S3 dual mode)
- [x] server/src/lib/dataLake.js — DataLake class, STORAGE_MODE local/s3, graceful s3→local fallback, all writes wrapped (return false, never throw)
- [x] writeBronze / writeSilver (flat records) / writeGold methods with documented key structure
- [x] @aws-sdk/client-s3 installed (3.x)
- [x] Bronze+silver writes hooked into runMeetingPipeline (single chokepoint for manual, teams_import, teams_auto, bot)
- [x] scripts/backfill-datalake.js (idempotent — verified re-run skips 120/120) + npm script backfill:lake
- [x] Backfill verified: 60 meetings → 120 files in partitioned tree; live analyze also writes bronze+silver (smoke-tested)
- [x] .env.example updated (STORAGE_MODE, AWS_* placeholders, S3_BUCKET_NAME, SEED_DEMO)

## Phase 5 — AWS scripts (aws/)
- [x] aws/requirements.txt (boto3)
- [x] 5a. aws/glue_crawler_setup.py — Glue db 'meetingmetric_db' + crawler over s3://.../silver/, idempotent (py_compile OK)
- [x] 5b. aws/glue_etl_job.py — PySpark Glue job: silver JSON → 3 partitioned Parquet gold datasets, job bookmarks, heavily commented (py_compile OK)
- [x] 5c. aws/athena_setup.py — workgroup 'meetingmetric', results location, external tables over gold datasets (py_compile OK)
- [x] 5d. aws/README.md — run order table, IAM policies, 3 example Athena queries

## Phase 6 — dbt project (dbt/)
- [x] profiles.yml with env_var() placeholders (dbt-athena-community, no hardcoded credentials)
- [x] staging models: stg_meetings.sql, stg_speaker_results.sql (typed casts, renames, sourced from Glue catalog 'silver' table)
- [x] marts: speaker_weekly_performance.sql, org_meeting_health.sql, meeting_efficiency_distribution.sql, top_performers.sql
- [x] schema.yml with descriptions + tests (dbt_utils.accepted_range 0-1, not_null, relationships, accepted_values)
- [x] dbt/README.md
- [x] dbt parse verified locally (dbt 1.11 + dbt-athena 1.10, deps installed, no warnings)

## Phase 7 — Airflow (airflow/)
- [x] airflow/dags/meetingmetric_daily_pipeline.py — daily DAG: check silver (S3 list) → trigger Glue (start_job_run) → wait (PythonSensor) → dbt run → dbt test, on_failure callback (py_compile OK)
- [x] airflow/docker-compose.yml (apache/airflow standalone, dbt mounted; YAML validated — docker not installed locally) + .env.example placeholders
- [x] airflow/README.md (start locally, trigger DAG, credentials notes)

## Phase 8 — Tests + CI
- [x] Jest + supertest integration tests in server/tests/integration.jest.js: employee 403 on /api/team/participants; manager 403 on /api/org/roster; cross-org meeting read blocked (404); hr 200 on /api/reports; e2e analyze → bronze+silver files + successful pipeline_runs row
- [x] All tests pass: 28 node:test + 5 Jest (npm test runs both)
- [x] .github/workflows/ci.yml — server-tests + dbt-parse jobs (kept existing client-build job)

## Phase 9 — README + polish
- [x] Root README.md rewritten (3-sentence description, ASCII architecture diagram, tech stack table, data model incl. pipeline_runs, 5 tech decisions, quickstart with SEED_DEMO=1 + backfill:lake, AWS deployment links, env var table, demo GIF placeholder)
- [x] .idea/, out/, website.iml verified NOT tracked by git; .gitignore already covers them (.idea/, *.iml, out/); added data-lake/ to .gitignore

## Final verification
- [x] Fresh boot with SEED_DEMO=1 → server clean (/health ok), 60 meetings + 10 users + 4 projects seeded
- [x] npm run backfill:lake → 120 files (60 bronze + 60 silver) in partitioned tree; idempotent re-run skips all
- [x] Analyzed new sample transcript e2e → meeting 61, bronze + silver written, pipeline_runs row (duration_ms=8, scoring_method=heuristic, success=1)
- [x] All tests pass: 28 node:test + 5 Jest
- [x] dbt parse succeeds (0 errors/warnings)
- [x] Spot-checked /api/reports, /api/org/benchmarks, /api/dashboard, /api/calendar, /api/me, /api/org/roster, /api/team/participants — all valid JSON with expected shapes and plausible values
- [x] PROGRESS.md fully checked off
- [x] Final report table printed (phase status + manual steps remaining)

## Manual steps remaining (require user / AWS account)
1. Create the S3 bucket + IAM role; fill AWS placeholders in server/.env (and airflow/.env)
2. Run aws/ scripts in order (see aws/README.md): glue_crawler_setup.py --run → create Glue job from glue_etl_job.py → athena_setup.py
3. Set dbt env vars (DBT_ATHENA_*) and run dbt deps/run/test against Athena
4. Start Airflow (airflow/docker-compose.yml) and unpause/trigger meetingmetric_daily_pipeline
5. Optionally set ANTHROPIC_API_KEY for tier-1 Claude scoring and Azure creds for Teams
