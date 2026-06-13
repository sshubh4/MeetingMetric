# MeetingMetric — dbt project

Models the lake (via the Glue catalog + Athena) into analytics marts:

- **staging** (`stg_meetings`, `stg_speaker_results`) — typed, renamed views
  over the crawled `silver` table
- **marts** — `speaker_weekly_performance`, `org_meeting_health`,
  `meeting_efficiency_distribution`, `top_performers`

Tests cover score ranges (0-1 via `dbt_utils.accepted_range`), `not_null` on
keys, and a relationships test from speaker results to meetings.

## Setup

Prerequisite: the Glue crawler has run at least once (see `../aws/README.md`)
so `meetingmetric_db.silver` exists.

```bash
pip install dbt-core dbt-athena-community

export AWS_REGION=us-east-1
export DBT_ATHENA_S3_STAGING_DIR=s3://meetingmetric-data-lake/athena-results/
export DBT_ATHENA_S3_DATA_DIR=s3://meetingmetric-data-lake/dbt/
export DBT_ATHENA_SCHEMA=meetingmetric_marts
# AWS credentials via the standard chain (env vars / ~/.aws)
```

`profiles.yml` lives in this directory and uses only `env_var()` placeholders,
so point dbt at it with `--profiles-dir .`.

## Commands

```bash
cd dbt
dbt deps                  # install dbt_utils
dbt parse --profiles-dir .   # validate the project (no AWS needed)
dbt run  --profiles-dir .    # build staging views + mart tables in Athena
dbt test --profiles-dir .    # run schema tests
```

`dbt parse` works without AWS access or data — it only validates project
structure, Jinja, and refs. `run`/`test` need the Athena setup from
`../aws/README.md`.
