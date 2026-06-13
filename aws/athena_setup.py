"""
Sets up Athena for querying the MeetingMetric gold layer.

What it does (idempotently — safe to re-run):
  1. Creates Athena workgroup 'meetingmetric' with results written to
     s3://$S3_BUCKET_NAME/athena-results/.
  2. Creates external tables (via start_query_execution DDL) over the three
     gold Parquet datasets produced by glue_etl_job.py, in database
     'meetingmetric_db'.
  3. Runs MSCK REPAIR TABLE on each so existing org_id= partitions register.

Environment:
  S3_BUCKET_NAME   bucket holding the data lake (required)
  AWS_REGION       defaults to us-east-1

Usage:
  pip install -r requirements.txt
  export S3_BUCKET_NAME=meetingmetric-data-lake
  python athena_setup.py
"""

import os
import sys
import time

import boto3
from botocore.exceptions import ClientError

WORKGROUP = "meetingmetric"
DATABASE = "meetingmetric_db"


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"Missing required environment variable: {name}")
    return value


def ensure_workgroup(athena, bucket: str) -> None:
    try:
        athena.create_work_group(
            Name=WORKGROUP,
            Configuration={
                "ResultConfiguration": {
                    "OutputLocation": f"s3://{bucket}/athena-results/"
                },
                "EnforceWorkGroupConfiguration": True,
                "PublishCloudWatchMetricsEnabled": True,
            },
            Description="MeetingMetric analytics workgroup",
        )
        print(f"Created Athena workgroup '{WORKGROUP}'")
    except ClientError as e:
        if "already" in e.response["Error"].get("Message", "").lower():
            print(f"Workgroup '{WORKGROUP}' already exists — skipping")
        else:
            raise


def run_query(athena, sql: str, description: str) -> None:
    """Submit DDL to Athena and block until it finishes."""
    res = athena.start_query_execution(
        QueryString=sql,
        QueryExecutionContext={"Database": DATABASE},
        WorkGroup=WORKGROUP,
    )
    qid = res["QueryExecutionId"]
    while True:
        state = athena.get_query_execution(QueryExecutionId=qid)["QueryExecution"]["Status"]
        if state["State"] in ("SUCCEEDED", "FAILED", "CANCELLED"):
            break
        time.sleep(1)
    if state["State"] != "SUCCEEDED":
        reason = state.get("StateChangeReason", "unknown")
        sys.exit(f"{description} failed: {reason}")
    print(f"OK: {description}")


SCORE_COLS_DDL = """
  avg_engagement double,
  avg_sentiment double,
  avg_collaboration double,
  avg_initiative double,
  avg_clarity double
"""


def table_ddls(bucket: str):
    return [
        (
            "org_daily_benchmarks",
            f"""
            CREATE EXTERNAL TABLE IF NOT EXISTS org_daily_benchmarks (
              event_date date,
              {SCORE_COLS_DDL},
              meeting_count bigint,
              speaker_count bigint
            )
            PARTITIONED BY (org_id bigint)
            STORED AS PARQUET
            LOCATION 's3://{bucket}/gold/org_daily_benchmarks/'
            """,
        ),
        (
            "speaker_weekly_performance",
            f"""
            CREATE EXTERNAL TABLE IF NOT EXISTS speaker_weekly_performance (
              speaker_name string,
              iso_week string,
              {SCORE_COLS_DDL},
              avg_talk_ratio double,
              total_words bigint,
              meeting_count bigint
            )
            PARTITIONED BY (org_id bigint)
            STORED AS PARQUET
            LOCATION 's3://{bucket}/gold/speaker_weekly_performance/'
            """,
        ),
        (
            "meeting_efficiency_distribution",
            f"""
            CREATE EXTERNAL TABLE IF NOT EXISTS meeting_efficiency_distribution (
              event_month string,
              efficiency_bucket string,
              meeting_count bigint
            )
            PARTITIONED BY (org_id bigint)
            STORED AS PARQUET
            LOCATION 's3://{bucket}/gold/meeting_efficiency_distribution/'
            """,
        ),
    ]


def main() -> None:
    bucket = require_env("S3_BUCKET_NAME")
    region = os.environ.get("AWS_REGION", "us-east-1")
    athena = boto3.client("athena", region_name=region)

    ensure_workgroup(athena, bucket)

    for table, ddl in table_ddls(bucket):
        run_query(athena, ddl, f"create table {table}")
        run_query(athena, f"MSCK REPAIR TABLE {table}", f"repair partitions for {table}")

    print("Athena setup complete. Query via workgroup 'meetingmetric', database 'meetingmetric_db'.")


if __name__ == "__main__":
    main()
