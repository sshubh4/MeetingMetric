-- Cleaned per-speaker records from the silver layer: explicit casts,
-- friendly score names, and a usable meeting timestamp.
with source as (

    select * from {{ source('meetingmetric_lake', 'silver') }}

)

select
    cast(meeting_id as bigint)                 as meeting_id,
    cast(org_id as bigint)                     as org_id,
    speaker_name,
    cast(user_id as bigint)                    as user_id,
    cast(word_count as bigint)                 as word_count,
    cast(turn_count as bigint)                 as turn_count,
    cast(talk_ratio as double)                 as talk_ratio,
    cast(score_engagement as double)           as engagement,
    cast(score_sentiment as double)            as sentiment,
    cast(score_collaboration as double)        as collaboration,
    cast(score_initiative as double)           as initiative,
    cast(score_clarity as double)              as clarity,
    cast(ub_ideas as bigint)                   as ideas_count,
    cast(ub_questions as bigint)               as questions_count,
    cast(ub_decisions as bigint)               as decisions_count,
    cast(ub_filler as bigint)                  as filler_count,
    source                                     as ingest_source,
    cast(from_iso8601_timestamp(coalesce(scheduled_at, created_at)) as timestamp)
                                               as meeting_ts
from source
where speaker_name is not null
