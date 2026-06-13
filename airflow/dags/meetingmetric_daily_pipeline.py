"""
MeetingMetric daily analytics pipeline.

Flow (daily at 03:00 UTC, after the 02:00 Glue crawler refresh):

  check_silver_has_new_data  → S3 list: any silver objects modified in the
                               last 24h? Skips the run cleanly if not.
  trigger_glue_job           → boto3 start_job_run on the gold ETL job
                               (job bookmarks make this incremental).
  wait_for_glue              → polls get_job_run until SUCCEEDED/era failure.
  dbt_run                    → builds staging views + marts in Athena.
  dbt_test                   → schema tests (score ranges, keys, relationships).

Credentials / configuration come from environment variables (or an Airflow
connection for AWS if you prefer — see README). Placeholders only; nothing
sensitive lives in this file.
"""

import logging
import os
from datetime import datetime, timedelta, timezone

import boto3
from airflow import DAG
from airflow.exceptions import AirflowSkipException
from airflow.operators.bash import BashOperator
from airflow.operators.python import PythonOperator
from airflow.sensors.python import PythonSensor

S3_BUCKET_NAME = os.environ.get("S3_BUCKET_NAME", "meetingmetric-data-lake")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
GLUE_JOB_NAME = os.environ.get("GLUE_JOB_NAME", "meetingmetric-gold-etl")
# Path to the dbt project inside the Airflow container (mounted by docker-compose)
DBT_PROJECT_DIR = os.environ.get("DBT_PROJECT_DIR", "/opt/airflow/dbt")

log = logging.getLogger(__name__)


def _on_failure(context):
    """Failure callback: log a clear, greppable error line with task context."""
    ti = context.get("task_instance")
    log.error(
        "MEETINGMETRIC PIPELINE FAILURE — dag=%s task=%s run=%s try=%s url=%s",
        ti.dag_id,
        ti.task_id,
        context.get("run_id"),
        ti.try_number,
        ti.log_url,
    )


def check_silver_has_new_data(**_):
    """Skip the whole run if no silver files changed in the last 24 hours."""
    s3 = boto3.client("s3", region_name=AWS_REGION)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=S3_BUCKET_NAME, Prefix="silver/"):
        for obj in page.get("Contents", []):
            if obj["LastModified"] >= cutoff:
                log.info("Found fresh silver object: %s (%s)", obj["Key"], obj["LastModified"])
                return True
    raise AirflowSkipException("No new silver data in the last 24h — skipping run")


def trigger_glue_job(**context):
    """Start the gold ETL Glue job and push the run id for the sensor."""
    glue = boto3.client("glue", region_name=AWS_REGION)
    run = glue.start_job_run(
        JobName=GLUE_JOB_NAME,
        Arguments={"--S3_BUCKET_NAME": S3_BUCKET_NAME},
    )
    run_id = run["JobRunId"]
    log.info("Started Glue job %s run %s", GLUE_JOB_NAME, run_id)
    context["ti"].xcom_push(key="glue_run_id", value=run_id)
    return run_id


def glue_job_finished(**context):
    """Sensor callable: True once the Glue run reaches a terminal state."""
    run_id = context["ti"].xcom_pull(task_ids="trigger_glue_job", key="glue_run_id")
    glue = boto3.client("glue", region_name=AWS_REGION)
    state = glue.get_job_run(JobName=GLUE_JOB_NAME, RunId=run_id)["JobRun"]["JobRunState"]
    log.info("Glue run %s state: %s", run_id, state)
    if state in ("FAILED", "ERROR", "TIMEOUT", "STOPPED"):
        raise RuntimeError(f"Glue job run {run_id} ended in state {state}")
    return state == "SUCCEEDED"


default_args = {
    "owner": "data-platform",
    "retries": 1,
    "retry_delay": timedelta(minutes=5),
    "on_failure_callback": _on_failure,
}

with DAG(
    dag_id="meetingmetric_daily_pipeline",
    description="Silver → gold Glue ETL, then dbt run + test against Athena",
    schedule="0 3 * * *",
    start_date=datetime(2026, 1, 1),
    catchup=False,
    default_args=default_args,
    tags=["meetingmetric", "data-lake"],
) as dag:

    check_new_data = PythonOperator(
        task_id="check_silver_has_new_data",
        python_callable=check_silver_has_new_data,
    )

    trigger_glue = PythonOperator(
        task_id="trigger_glue_job",
        python_callable=trigger_glue_job,
    )

    wait_for_glue = PythonSensor(
        task_id="wait_for_glue",
        python_callable=glue_job_finished,
        poke_interval=60,
        timeout=60 * 60,  # give the Glue run up to an hour
        mode="reschedule",  # free the worker slot between pokes
    )

    dbt_run = BashOperator(
        task_id="dbt_run",
        bash_command=f"cd {DBT_PROJECT_DIR} && dbt deps && dbt run --profiles-dir .",
    )

    dbt_test = BashOperator(
        task_id="dbt_test",
        bash_command=f"cd {DBT_PROJECT_DIR} && dbt test --profiles-dir .",
    )

    check_new_data >> trigger_glue >> wait_for_glue >> dbt_run >> dbt_test
