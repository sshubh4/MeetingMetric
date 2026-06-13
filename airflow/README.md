# MeetingMetric — Airflow orchestration

One DAG, `meetingmetric_daily_pipeline`, runs daily at 03:00 UTC (an hour
after the Glue crawler's 02:00 refresh):

```
check_silver_has_new_data → trigger_glue_job → wait_for_glue → dbt_run → dbt_test
```

- **check_silver_has_new_data** — lists `s3://$S3_BUCKET_NAME/silver/`; skips
  the run if nothing changed in 24h.
- **trigger_glue_job / wait_for_glue** — starts the `meetingmetric-gold-etl`
  Glue job (see `../aws/README.md`) and polls until it finishes.
- **dbt_run / dbt_test** — builds and tests the marts in `../dbt/` against Athena.
- Any failure fires an `on_failure_callback` that logs a single greppable
  `MEETINGMETRIC PIPELINE FAILURE` line with dag/task/run/log-URL.

## Run locally

```bash
cd airflow
cp .env.example .env        # fill in your AWS values (placeholders provided)
docker compose up
```

- UI: http://localhost:8080 — username `admin`, password printed in the
  container logs (`docker compose logs airflow | grep "Login with"`).
- The dbt project is mounted read-write at `/opt/airflow/dbt`; dags at
  `/opt/airflow/dags`.

## Trigger the DAG

From the UI: unpause `meetingmetric_daily_pipeline` and press ▶ (Trigger DAG).

Or from the CLI:

```bash
docker compose exec airflow airflow dags trigger meetingmetric_daily_pipeline
docker compose exec airflow airflow dags list-runs -d meetingmetric_daily_pipeline
```

## Credentials

AWS credentials are passed as environment variables from `.env` (the standard
boto3 chain picks them up). For production, prefer an Airflow AWS connection
or an instance role and drop the env vars from the compose file.

Note: with an empty/cold bucket the first task will skip the run (no new
silver data); run `npm run backfill:lake` with `STORAGE_MODE=s3` from
`server/` first to populate the lake.
