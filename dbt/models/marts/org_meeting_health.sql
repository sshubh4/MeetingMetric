-- Monthly org-level meeting health: volume, efficiency, engagement, and the
-- share of meetings that look unhealthy (low engagement / very low efficiency).
with meetings as (

    select * from {{ ref('stg_meetings') }}

),

speaker_results as (

    select * from {{ ref('stg_speaker_results') }}

),

meeting_engagement as (

    select
        meeting_id,
        avg(engagement) as avg_engagement
    from speaker_results
    group by 1

)

select
    m.org_id,
    date_trunc('month', m.meeting_ts)                       as month_start,
    count(*)                                                as meeting_count,
    round(avg(m.efficiency_score), 4)                       as avg_efficiency,
    round(avg(me.avg_engagement), 4)                        as avg_engagement,
    round(avg(m.speaker_count), 2)                          as avg_speakers_per_meeting,
    sum(case when me.avg_engagement < 0.38 then 1 else 0 end) as low_engagement_meetings,
    round(
        cast(sum(case when m.efficiency_score < 0.5 then 1 else 0 end) as double)
        / count(*), 4
    )                                                       as low_efficiency_share
from meetings m
left join meeting_engagement me on me.meeting_id = m.meeting_id
group by 1, 2
