-- Meeting counts in efficiency buckets per org per month.
with meetings as (

    select * from {{ ref('stg_meetings') }}

),

bucketed as (

    select
        org_id,
        date_trunc('month', meeting_ts) as month_start,
        case
            when efficiency_score < 0.25 then '0.00-0.25'
            when efficiency_score < 0.50 then '0.25-0.50'
            when efficiency_score < 0.75 then '0.50-0.75'
            else '0.75-1.00'
        end as efficiency_bucket
    from meetings
    where efficiency_score is not null

)

select
    org_id,
    month_start,
    efficiency_bucket,
    count(*) as meeting_count
from bucketed
group by 1, 2, 3
