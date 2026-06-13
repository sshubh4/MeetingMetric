-- Top performers per org over the trailing 90 days, ranked by a composite of
-- the five score dimensions. Requires at least 3 meetings to qualify so a
-- single great meeting does not top the chart.
with speaker_results as (

    select * from {{ ref('stg_speaker_results') }}

),

recent as (

    select *
    from speaker_results
    where meeting_ts >= date_add('day', -90, current_date)

),

aggregated as (

    select
        org_id,
        speaker_name,
        count(distinct meeting_id)       as meeting_count,
        round(avg(engagement), 4)        as avg_engagement,
        round(avg(sentiment), 4)         as avg_sentiment,
        round(avg(collaboration), 4)     as avg_collaboration,
        round(avg(initiative), 4)        as avg_initiative,
        round(avg(clarity), 4)           as avg_clarity,
        round(
            (avg(engagement) + avg(sentiment) + avg(collaboration)
             + avg(initiative) + avg(clarity)) / 5.0, 4
        )                                as composite_score
    from recent
    group by 1, 2
    having count(distinct meeting_id) >= 3

)

select
    *,
    row_number() over (partition by org_id order by composite_score desc) as org_rank
from aggregated
