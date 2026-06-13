"""
MeetingMetric Glue ETL job: silver JSON → gold Parquet.

Upload this script when creating a Glue job in the console (or via IaC):
  - Type: Spark, Glue version 4.0+, Language: Python 3
  - Job bookmarks: ENABLED (set below in code as well) — only new silver
    files are processed on each run, so the daily Airflow trigger is cheap.
  - Job parameters expected:
      --S3_BUCKET_NAME   bucket holding the data lake (e.g. meetingmetric-data-lake)

Reads:
  s3://$S3_BUCKET_NAME/silver/   flat per-speaker JSON records, partitioned
                                 by org= / year= / month=

Writes three gold datasets as partitioned Parquet:
  gold/org_daily_benchmarks/             avg of each score dimension per org per day
  gold/speaker_weekly_performance/       avg scores per speaker per ISO week
  gold/meeting_efficiency_distribution/  meeting counts in efficiency buckets
                                         [0-0.25, 0.25-0.5, 0.5-0.75, 0.75-1.0]
                                         per org per month
"""

import sys

from awsglue.context import GlueContext
from awsglue.job import Job
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from pyspark.sql import functions as F

# ── Job bootstrap ─────────────────────────────────────────────────────────────
# getResolvedOptions pulls required parameters passed by the trigger
# (Airflow's start_job_run sends --S3_BUCKET_NAME; JOB_NAME is added by Glue).
args = getResolvedOptions(sys.argv, ["JOB_NAME", "S3_BUCKET_NAME"])
BUCKET = args["S3_BUCKET_NAME"]

sc = SparkContext()
glue_context = GlueContext(sc)
spark = glue_context.spark_session

# Job.init/commit are what make job bookmarks work: on commit, Glue records
# which input files were processed so the next run only reads new ones.
job = Job(glue_context)
job.init(args["JOB_NAME"], args)

# ── Read silver layer ─────────────────────────────────────────────────────────
# create_dynamic_frame.from_options with a connection_type of s3 + recurse
# picks up every partition. "withPartitionKeys" style partition columns
# (org=, year=, month=) are materialised from the path automatically when
# attachFilename-style options are unnecessary — we re-derive org from the
# record itself (org_id is in every silver record), so path partitions are
# only used for pruning by the bookmark.
silver_dyf = glue_context.create_dynamic_frame.from_options(
    connection_type="s3",
    connection_options={
        "paths": [f"s3://{BUCKET}/silver/"],
        "recurse": True,
    },
    format="json",
    transformation_ctx="silver_source",  # transformation_ctx enables bookmarks
)

df = silver_dyf.toDF()

SCORE_COLS = [
    "score_engagement",
    "score_sentiment",
    "score_collaboration",
    "score_initiative",
    "score_clarity",
]

# Empty incremental run (bookmarks filtered everything out). Do NOT sys.exit
# here: in Glue, ANY SystemExit — even code 0 — is recorded as a FAILED run.
# Instead skip the processing and fall through to job.commit() so the run is a
# clean SUCCESS that Airflow's sensor accepts.
if df.rdd.isEmpty():
    print("No new silver records since last bookmark — nothing to do.")
else:
    # ── Common derived columns ────────────────────────────────────────────────
    # Silver timestamps are ISO-8601 strings; derive date/week/month dimensions.
    df = (
        df.withColumn("event_ts", F.coalesce(F.col("scheduled_at"), F.col("created_at")).cast("timestamp"))
          .withColumn("event_date", F.to_date("event_ts"))
          # ISO week label like 2026-W23 — stable across year boundaries.
          # Spark 3 dropped week-based date_format patterns (Y/ww), so derive the
          # pieces with EXTRACT (YEAROFWEEK/WEEK are ISO-8601 in Spark SQL).
          .withColumn(
              "iso_week",
              F.concat_ws(
                  "-W",
                  F.expr("extract(YEAROFWEEK FROM event_ts)").cast("string"),
                  F.lpad(F.expr("extract(WEEK FROM event_ts)").cast("string"), 2, "0"),
              ),
          )
          .withColumn("event_month", F.date_format("event_ts", "yyyy-MM"))
    )

    # ── Gold dataset 1: org_daily_benchmarks ──────────────────────────────────
    # One row per org per day: the average of every score dimension plus volume
    # counts. This is the dataset the dashboard benchmarks read in batch mode.
    org_daily = (
        df.groupBy("org_id", "event_date")
          .agg(
              *[F.round(F.avg(c), 4).alias(f"avg_{c.replace('score_', '')}") for c in SCORE_COLS],
              F.countDistinct("meeting_id").alias("meeting_count"),
              F.countDistinct("speaker_name").alias("speaker_count"),
          )
    )

    org_daily.write.mode("append").partitionBy("org_id").parquet(
        f"s3://{BUCKET}/gold/org_daily_benchmarks/"
    )

    # ── Gold dataset 2: speaker_weekly_performance ────────────────────────────
    # One row per speaker per ISO week: average scores + talk metrics. Used for
    # trend lines and the dbt top_performers mart.
    speaker_weekly = (
        df.groupBy("org_id", "speaker_name", "iso_week")
          .agg(
              *[F.round(F.avg(c), 4).alias(f"avg_{c.replace('score_', '')}") for c in SCORE_COLS],
              F.round(F.avg("talk_ratio"), 4).alias("avg_talk_ratio"),
              F.sum("word_count").alias("total_words"),
              F.countDistinct("meeting_id").alias("meeting_count"),
          )
    )

    speaker_weekly.write.mode("append").partitionBy("org_id").parquet(
        f"s3://{BUCKET}/gold/speaker_weekly_performance/"
    )

    # ── Gold dataset 3: meeting_efficiency_distribution ───────────────────────
    # Bucket each meeting's efficiency score into quartile bands, then count
    # meetings per org per month per bucket. Deduplicate to one row per meeting
    # first (silver has one record per speaker).
    meetings = df.select("org_id", "meeting_id", "efficiency_score", "event_month").dropDuplicates(
        ["org_id", "meeting_id"]
    )

    meetings = meetings.withColumn(
        "efficiency_bucket",
        F.when(F.col("efficiency_score") < 0.25, "0.00-0.25")
         .when(F.col("efficiency_score") < 0.5, "0.25-0.50")
         .when(F.col("efficiency_score") < 0.75, "0.50-0.75")
         .otherwise("0.75-1.00"),
    )

    efficiency_dist = (
        meetings.groupBy("org_id", "event_month", "efficiency_bucket")
                .agg(F.count("meeting_id").alias("meeting_count"))
    )

    efficiency_dist.write.mode("append").partitionBy("org_id").parquet(
        f"s3://{BUCKET}/gold/meeting_efficiency_distribution/"
    )

# Commit advances the job bookmark so the next run skips files read above.
job.commit()
