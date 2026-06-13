-- Average scores per speaker per ISO week, for trend lines and reviews.
with speaker_results as (

    select * from {{ ref('stg_speaker_results') }}

)

select
    org_id,
    speaker_name,
    date_trunc('week', meeting_ts)        as week_start,
    round(avg(engagement), 4)             as avg_engagement,
    round(avg(sentiment), 4)              as avg_sentiment,
    round(avg(collaboration), 4)          as avg_collaboration,
    round(avg(initiative), 4)             as avg_initiative,
    round(avg(clarity), 4)                as avg_clarity,
    round(avg(talk_ratio), 4)             as avg_talk_ratio,
    sum(word_count)                       as total_words,
    count(distinct meeting_id)            as meeting_count
from speaker_results
group by 1, 2, 3
