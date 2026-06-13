# MeetingMetric — AWS analytics setup

Sets up the cloud half of the medallion lake: Glue catalogs the silver layer,
a Glue ETL job produces gold Parquet, and Athena queries it. Airflow
(`../airflow/`) orchestrates the daily batch; dbt (`../dbt/`) models on top of
the catalog tables.

## Prerequisites

- An S3 bucket (default name used throughout: `meetingmetric-data-lake`)
- The app running with `STORAGE_MODE=s3` (or a one-off
  `npm run backfill:lake` from `server/` with S3 env vars set) so the bucket
  contains `silver/` data
- Python 3.9+ and credentials configured (`aws configure` or env vars)

```bash
cd aws
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export AWS_REGION=us-east-1
export S3_BUCKET_NAME=meetingmetric-data-lake
export GLUE_CRAWLER_ROLE_ARN=arn:aws:iam::YOUR_AWS_ACCOUNT_ID:role/meetingmetric-glue-role
```

## Run order

| Step | Command | What it does |
| --- | --- | --- |
| 1 | `python glue_crawler_setup.py --run` | Creates Glue database `meetingmetric_db` + crawler over `s3://$S3_BUCKET_NAME/silver/`, starts a first crawl |
| 2 | Console/IaC: create Glue job `meetingmetric-gold-etl` from `glue_etl_job.py` | Spark job, Glue 4.0, **job bookmarks enabled**, job parameter `--S3_BUCKET_NAME` |
| 3 | Run the Glue job once (console or `aws glue start-job-run --job-name meetingmetric-gold-etl`) | Produces the three gold Parquet datasets |
| 4 | `python athena_setup.py` | Workgroup `meetingmetric`, results to `s3://$S3_BUCKET_NAME/athena-results/`, external tables over gold |

After that, the Airflow DAG (`../airflow/`) automates steps 3-4's refresh daily.

## IAM policies needed

**Your user/role running these scripts:**
`glue:CreateDatabase`, `glue:CreateCrawler`, `glue:UpdateCrawler`,
`glue:StartCrawler`, `glue:CreateJob`, `glue:StartJobRun`, `glue:GetJobRun`,
`athena:CreateWorkGroup`, `athena:StartQueryExecution`,
`athena:GetQueryExecution`, `iam:PassRole` (for the crawler/job role), and
`s3:GetObject`/`s3:PutObject`/`s3:ListBucket` on the lake bucket.

**The Glue role (`GLUE_CRAWLER_ROLE_ARN`, also used by the ETL job):**
- Managed policy `service-role/AWSGlueServiceRole`
- Inline policy allowing `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`,
  `s3:ListBucket` on `arn:aws:s3:::$S3_BUCKET_NAME` and
  `arn:aws:s3:::$S3_BUCKET_NAME/*`

**Athena** uses your caller credentials; query results land in
`s3://$S3_BUCKET_NAME/athena-results/`.

## Example Athena queries

Run in workgroup `meetingmetric`, database `meetingmetric_db`:

```sql
-- 1. Org engagement trend, last 30 days
SELECT event_date, avg_engagement, avg_sentiment, meeting_count
FROM org_daily_benchmarks
WHERE org_id = 1
  AND event_date >= date_add('day', -30, current_date)
ORDER BY event_date;
```

```sql
-- 2. Top 5 speakers by average engagement over the last 8 ISO weeks
SELECT speaker_name,
       round(avg(avg_engagement), 3) AS engagement,
       sum(meeting_count)            AS meetings
FROM speaker_weekly_performance
WHERE org_id = 1
GROUP BY speaker_name
HAVING sum(meeting_count) >= 3
ORDER BY engagement DESC
LIMIT 5;
```

```sql
-- 3. How meeting efficiency is distributed per month
SELECT event_month, efficiency_bucket, sum(meeting_count) AS meetings
FROM meeting_efficiency_distribution
WHERE org_id = 1
GROUP BY event_month, efficiency_bucket
ORDER BY event_month, efficiency_bucket;
```
