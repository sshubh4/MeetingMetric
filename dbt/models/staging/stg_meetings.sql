-- One row per meeting, deduplicated from the flat silver records
-- (silver stores meeting-level fields on every speaker record).
with source as (

    select * from {{ source('meetingmetric_lake', 'silver') }}

),

deduped as (

    select
        cast(meeting_id as bigint)        as meeting_id,
        cast(org_id as bigint)            as org_id,
        max(title)                        as title,
        max(cast(efficiency_score as double)) as efficiency_score,
        max(source)                       as ingest_source,
        max(cast(from_iso8601_timestamp(coalesce(scheduled_at, created_at)) as timestamp))
                                          as meeting_ts,
        count(*)                          as speaker_count
    from source
    group by 1, 2

)

select * from deduped
