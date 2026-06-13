"""
Creates the Glue data catalog database and a crawler over the silver layer.

What it does (idempotently — safe to re-run):
  1. Creates Glue database 'meetingmetric_db' if it does not exist.
  2. Creates (or updates) crawler 'meetingmetric-silver-crawler' targeting
     s3://$S3_BUCKET_NAME/silver/ with partition detection — the lake's
     org=/year=/month= key layout becomes Hive-style partition columns.
  3. Optionally starts the crawler with --run.

Environment:
  S3_BUCKET_NAME   bucket holding the data lake (required)
  AWS_REGION       defaults to us-east-1
  GLUE_CRAWLER_ROLE_ARN  IAM role the crawler assumes (required; needs
                   AWSGlueServiceRole policy + s3:GetObject/ListBucket on the bucket)

Usage:
  pip install -r requirements.txt
  export S3_BUCKET_NAME=meetingmetric-data-lake
  export GLUE_CRAWLER_ROLE_ARN=arn:aws:iam::YOUR_AWS_ACCOUNT_ID:role/meetingmetric-glue-role
  python glue_crawler_setup.py [--run]
"""

import os
import sys

import boto3
from botocore.exceptions import ClientError

DATABASE_NAME = "meetingmetric_db"
CRAWLER_NAME = "meetingmetric-silver-crawler"


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"Missing required environment variable: {name}")
    return value


def ensure_database(glue) -> None:
    """Create the Glue catalog database if it does not already exist."""
    try:
        glue.create_database(
            DatabaseInput={
                "Name": DATABASE_NAME,
                "Description": "MeetingMetric data lake catalog (silver + gold layers)",
            }
        )
        print(f"Created Glue database '{DATABASE_NAME}'")
    except ClientError as e:
        if e.response["Error"]["Code"] == "AlreadyExistsException":
            print(f"Glue database '{DATABASE_NAME}' already exists — skipping")
        else:
            raise


def ensure_crawler(glue, bucket: str, role_arn: str) -> None:
    """Create or update the crawler over the silver layer."""
    crawler_config = {
        "Name": CRAWLER_NAME,
        "Role": role_arn,
        "DatabaseName": DATABASE_NAME,
        "Description": "Crawls MeetingMetric silver JSON (flat per-speaker records)",
        "Targets": {"S3Targets": [{"Path": f"s3://{bucket}/silver/"}]},
        # Group all partitions (org=/year=/month=) under one table instead of
        # one table per leaf folder.
        "Configuration": (
            '{"Version":1.0,'
            '"Grouping":{"TableGroupingPolicy":"CombineCompatibleSchemas"},'
            '"CrawlerOutput":{"Partitions":{"AddOrUpdateBehavior":"InheritFromTable"}}}'
        ),
        "SchemaChangePolicy": {
            "UpdateBehavior": "UPDATE_IN_DATABASE",
            "DeleteBehavior": "LOG",
        },
        # Daily at 02:00 UTC, before the Airflow pipeline kicks off Glue ETL.
        "Schedule": "cron(0 2 * * ? *)",
    }
    try:
        glue.create_crawler(**crawler_config)
        print(f"Created crawler '{CRAWLER_NAME}' over s3://{bucket}/silver/")
    except ClientError as e:
        if e.response["Error"]["Code"] == "AlreadyExistsException":
            glue.update_crawler(**crawler_config)
            print(f"Crawler '{CRAWLER_NAME}' already exists — updated configuration")
        else:
            raise


def main() -> None:
    bucket = require_env("S3_BUCKET_NAME")
    role_arn = require_env("GLUE_CRAWLER_ROLE_ARN")
    region = os.environ.get("AWS_REGION", "us-east-1")

    glue = boto3.client("glue", region_name=region)

    ensure_database(glue)
    ensure_crawler(glue, bucket, role_arn)

    if "--run" in sys.argv:
        try:
            glue.start_crawler(Name=CRAWLER_NAME)
            print(f"Started crawler '{CRAWLER_NAME}'")
        except ClientError as e:
            if e.response["Error"]["Code"] == "CrawlerRunningException":
                print("Crawler is already running")
            else:
                raise


if __name__ == "__main__":
    main()
