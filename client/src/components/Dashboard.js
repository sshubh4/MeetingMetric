import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';
import { motion } from 'framer-motion';
import {
  Calendar, Zap, Users, UserCheck, TrendingUp, Plus, Paperclip,
} from 'lucide-react';
import AppShell from './AppShell';
import {
  getDashboard, getTeamsStatus, getTeamsAuthUrl,
  listMeetings, getOrgBenchmarks, getMe, getTeamParticipants,
} from '../api';
import { useAuth, isRole } from '../hooks/useAuth';

// ── Utilities ──────────────────────────────────────────────────────────────────
function getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function formatHeaderDate(d) {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatRelativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Build 8-week bucketed sparkline from efficiencyTrend
function buildSparkData(efficiencyTrend) {
  const NUM_WEEKS = 8;
  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  const buckets = Array.from({ length: NUM_WEEKS }, (_, i) => {
    const end = now - i * week;
    const start = end - week;
    return { start, end, effs: [], count: 0 };
  }).reverse();

  for (const row of efficiencyTrend) {
    const ts = new Date(row.date).getTime();
    for (const b of buckets) {
      if (ts >= b.start && ts < b.end) {
        if (row.efficiency != null) b.effs.push(row.efficiency * 100);
        b.count++;
        break;
      }
    }
  }

  return {
    efficiency: buckets
      .filter((b) => b.effs.length > 0)
      .map((b) => ({ v: Math.round(b.effs.reduce((a, c) => a + c, 0) / b.effs.length) })),
    meetings: buckets.map((b) => ({ v: b.count })),
  };
}

// Compute delta % between last 7d and prev 7d for meetings
function computeDeltas(efficiencyTrend) {
  const now = Date.now();
  const w = 7 * 24 * 60 * 60 * 1000;
  const last7 = efficiencyTrend.filter((r) => new Date(r.date).getTime() > now - w);
  const prev7 = efficiencyTrend.filter((r) => {
    const ts = new Date(r.date).getTime();
    return ts > now - 2 * w && ts <= now - w;
  });
  const meetingsDelta =
    prev7.length > 0 ? Math.round(((last7.length - prev7.length) / prev7.length) * 100) : null;

  const lastEff = last7.map((r) => r.efficiency).filter(Boolean);
  const prevEff = prev7.map((r) => r.efficiency).filter(Boolean);
  const effDelta =
    prevEff.length > 0 && lastEff.length > 0
      ? Math.round(
          ((lastEff.reduce((a, b) => a + b, 0) / lastEff.length -
            prevEff.reduce((a, b) => a + b, 0) / prevEff.length) /
            (prevEff.reduce((a, b) => a + b, 0) / prevEff.length)) *
            100
        )
      : null;

  return { meetingsDelta, effDelta };
}

// ── Colour palettes (static strings so Tailwind JIT includes them) ──────────────
const COLORS = {
  purple: {
    iconBg: 'bg-amber-500/10',
    iconText: 'text-amber-400',
    stroke: '#fbbf24',
    glow: 'bg-amber-500',
    deltaBg: '',
  },
  teal: {
    iconBg: 'bg-orange-500/10',
    iconText: 'text-orange-400',
    stroke: '#fb923c',
    glow: 'bg-orange-500',
  },
  violet: {
    iconBg: 'bg-yellow-500/10',
    iconText: 'text-yellow-400',
    stroke: '#eab308',
    glow: 'bg-yellow-500',
  },
  indigo: {
    iconBg: 'bg-rose-500/10',
    iconText: 'text-rose-400',
    stroke: '#f43f5e',
    glow: 'bg-rose-500',
  },
};

// ── CountUp ────────────────────────────────────────────────────────────────────
function useCountUp(target, duration = 1200) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (target == null || target === 0) { setCount(0); return; }
    let raf;
    const t0 = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * target));
      if (progress < 1) raf = requestAnimationFrame(tick);
      else setCount(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return count;
}

function CountUp({ target, suffix = '' }) {
  const val = useCountUp(target ?? 0);
  if (target == null || target === 0) return <>—</>;
  return <>{val}{suffix}</>;
}

// ── EmptyState ─────────────────────────────────────────────────────────────────
function EmptyState({ icon: Icon, message, action, onAction }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-3">
      <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center">
        <Icon size={18} className="text-zinc-600" />
      </div>
      <p className="text-xs text-zinc-600 text-center max-w-xs">{message}</p>
      {action && (
        <button
          type="button"
          onClick={onAction}
          className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
        >
          {action} →
        </button>
      )}
    </div>
  );
}

// ── KPI Card ───────────────────────────────────────────────────────────────────
function KPICard({ label, value, delta, icon: Icon, sparkData, colorKey, delay = 0, primary = false }) {
  const c = COLORS[colorKey] || COLORS.purple;
  const hasSpark = Array.isArray(sparkData) && sparkData.length > 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
      className={`relative overflow-hidden rounded-xl p-4 border transition-all duration-200 ${
        primary
          ? 'border-amber-500/25 bg-amber-500/[0.04] hover:border-amber-500/40 hover:bg-amber-500/[0.07]'
          : 'border-white/[0.08] bg-white/[0.04] hover:border-white/[0.15] hover:bg-white/[0.06]'
      }`}
    >
      {/* Top row */}
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-lg ${c.iconBg}`}>
          <Icon size={16} className={c.iconText} />
        </div>
        {delta != null && (
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              delta >= 0
                ? 'bg-emerald-500/10 text-emerald-400'
                : 'bg-red-500/10 text-red-400'
            }`}
          >
            {delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}%
          </span>
        )}
      </div>

      {/* Value */}
      <div className="text-3xl font-bold text-white tracking-tight mb-0.5">
        {value}
      </div>
      <div className="text-xs text-zinc-500 uppercase tracking-wider mb-3">{label}</div>

      {/* Sparkline */}
      {hasSpark && (
        <ResponsiveContainer width="100%" height={32}>
          <LineChart data={sparkData}>
            <Line
              type="monotone"
              dataKey="v"
              stroke={c.stroke}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive
              animationDuration={1200}
            />
          </LineChart>
        </ResponsiveContainer>
      )}

      {/* Corner glow */}
      <div
        className={`absolute -bottom-4 -right-4 w-24 h-24 rounded-full blur-2xl opacity-20 ${c.glow}`}
      />
    </motion.div>
  );
}

// ── Activity Feed ──────────────────────────────────────────────────────────────
function ActivityFeed({ meetings }) {
  const events = meetings.slice(0, 8).map((m) => ({
    id: m.id,
    type: m.source === 'teams_auto' ? 'auto' : 'manual',
    title: m.title,
    time: formatRelativeTime(m.created_at || m.scheduled_at),
    efficiency: m.efficiency_score,
    alert: !!(m.dominant_speaker_alert || m.low_engagement_alert),
  }));

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-5 flex flex-col h-full min-h-0">
      <h3 className="font-heading text-sm font-medium text-white mb-4 flex-shrink-0">Activity Feed</h3>
      <div className="space-y-0.5 flex-1 overflow-y-auto" style={{ maxHeight: 240 }}>
        {events.length === 0 ? (
          <p className="text-xs text-zinc-600 text-center py-8">No meetings yet</p>
        ) : (
          events.map((event, i) => (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06, duration: 0.35 }}
              className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-white/5 transition-colors cursor-pointer border-l-2"
              style={{
                borderLeftColor: event.alert
                  ? '#ef4444'
                  : event.type === 'auto'
                  ? '#fbbf24'
                  : '#fb923c',
              }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-zinc-200 truncate">{event.title}</p>
                <p className="text-xs text-zinc-500 mt-0.5 flex items-center gap-1">
                  {event.type === 'auto'
                    ? <><Zap size={10} className="text-amber-400 shrink-0" /> Auto-ingested</>
                    : <><Paperclip size={10} className="text-zinc-500 shrink-0" /> Manual</>
                  }
                  {' · '}{event.time}
                </p>
              </div>
              <span
                className={`text-xs font-medium flex-shrink-0 ${
                  event.efficiency >= 0.75
                    ? 'text-emerald-400'
                    : event.efficiency >= 0.5
                    ? 'text-amber-400'
                    : event.efficiency != null
                    ? 'text-red-400'
                    : 'text-zinc-600'
                }`}
              >
                {event.efficiency != null ? Math.round(event.efficiency * 100) + '%' : '—'}
              </span>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Top Performers ─────────────────────────────────────────────────────────────
function TopPerformers({ participants }) {
  // Take top 5 by avgEngagement; compute trend from per-meeting scores if available
  const top = useMemo(() => {
    if (!participants || participants.length === 0) return [];
    return participants
      .map((p) => {
        const meetingScores = (p.meetings || []).map(
          (m) => ((m.scores?.engagement ?? 0) + (m.scores?.sentiment ?? 0) +
                  (m.scores?.collaboration ?? 0) + (m.scores?.initiative ?? 0) +
                  (m.scores?.clarity ?? 0)) / 5
        );
        const recentAvg =
          meetingScores.length >= 3
            ? meetingScores.slice(-3).reduce((a, b) => a + b, 0) / 3
            : null;
        const prevAvg =
          meetingScores.length >= 6
            ? meetingScores.slice(-6, -3).reduce((a, b) => a + b, 0) / 3
            : null;
        const trend = recentAvg != null && prevAvg != null ? recentAvg - prevAvg : null;
        const avgScore = p.avg_engagement ?? meetingScores.reduce((a, b) => a + b, 0) / Math.max(meetingScores.length, 1);
        return { name: p.name, avgScore, trend, meetingCount: p.meeting_count ?? p.meetingsCount ?? 0 };
      })
      .sort((a, b) => b.avgScore - a.avgScore)
      .slice(0, 5);
  }, [participants]);

  const initials = (name) =>
    name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-5">
      <h3 className="font-heading text-sm font-medium text-white mb-4">Top Performers</h3>
      {top.length === 0 ? (
        <EmptyState
          icon={Users}
          message="Analyze meetings to see top performers"
        />
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-xs text-zinc-600 uppercase tracking-wider">
              <th className="text-left pb-3 font-medium">Participant</th>
              <th className="text-right pb-3 font-medium">Score</th>
              <th className="text-right pb-3 font-medium">Trend</th>
              <th className="text-right pb-3 font-medium">Meetings</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {top.map((p, i) => (
              <motion.tr
                key={p.name}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.08, duration: 0.35 }}
                className="hover:bg-white/[0.03] transition-colors"
                style={{ display: 'table-row' }}
              >
                <td className="py-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-xs font-medium text-amber-300 flex-shrink-0">
                      {initials(p.name)}
                    </div>
                    <span className="text-sm text-zinc-200 truncate max-w-[100px]">{p.name}</span>
                  </div>
                </td>
                <td className="py-2.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-1 rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-amber-500"
                        style={{ width: `${Math.round(p.avgScore * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-zinc-300 w-8 text-right">
                      {Math.round(p.avgScore * 100)}
                    </span>
                  </div>
                </td>
                <td className="py-2.5 text-right">
                  <span
                    className={`text-xs ${
                      p.trend == null
                        ? 'text-zinc-600'
                        : p.trend > 0
                        ? 'text-emerald-400'
                        : p.trend < 0
                        ? 'text-red-400'
                        : 'text-zinc-500'
                    }`}
                  >
                    {p.trend == null ? '—' : p.trend > 0 ? `↑ ${Math.abs(Math.round(p.trend * 100))}` : p.trend < 0 ? `↓ ${Math.abs(Math.round(p.trend * 100))}` : '→'}
                  </span>
                </td>
                <td className="py-2.5 text-right text-xs text-zinc-500">{p.meetingCount}</td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Recent Meetings (horizontal scroll) ───────────────────────────────────────
function RecentMeetingsRow({ meetings, onAddClick }) {
  const navigate = useNavigate();
  const effColor = (v) =>
    v >= 0.75 ? '#22c55e' : v >= 0.5 ? '#f59e0b' : v != null ? '#ef4444' : '#3f3f46';
  const effClass = (v) =>
    v >= 0.75 ? 'text-emerald-400' : v >= 0.5 ? 'text-amber-400' : v != null ? 'text-red-400' : 'text-zinc-600';

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-heading text-sm font-medium text-white">Recent Meetings</h3>
        <button
          type="button"
          onClick={() => navigate('/meetings')}
          className="text-xs text-zinc-500 hover:text-amber-400 transition-colors"
        >
          View all →
        </button>
      </div>

      <div
        className="flex gap-3 overflow-x-auto pb-2"
        style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}
      >
        {meetings.map((m, i) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.07, duration: 0.38 }}
            onClick={() => navigate(`/meeting/${m.id}`)}
            className="flex-shrink-0 w-52 p-4 rounded-lg border border-white/[0.08] bg-white/[0.04] hover:border-amber-500/30 hover:bg-amber-500/5 cursor-pointer transition-all duration-200 group"
          >
            {/* Efficiency color bar */}
            <div
              className="w-full h-0.5 rounded-full mb-3"
              style={{ background: effColor(m.efficiency_score) }}
            />
            <p className="text-xs font-medium text-zinc-200 truncate group-hover:text-white transition-colors mb-1">
              {m.title}
            </p>
            <p className="text-xs text-zinc-600 mb-3">{fmtDate(m.scheduled_at || m.created_at)}</p>

            <div className="flex items-center justify-between">
              {/* Source badge */}
              <span
                className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${
                  m.source === 'teams_auto'
                    ? 'bg-blue-500/15 text-blue-400'
                    : 'bg-white/[0.06] text-zinc-500'
                }`}
              >
                {m.source === 'teams_auto'
                  ? <Zap size={9} />
                  : <Paperclip size={9} />
                }
              </span>
              <span className={`text-xs font-semibold ${effClass(m.efficiency_score)}`}>
                {m.efficiency_score != null ? Math.round(m.efficiency_score * 100) + '%' : '—'}
              </span>
            </div>
          </motion.div>
        ))}

        {/* Add meeting card */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: meetings.length * 0.07 + 0.1 }}
          onClick={onAddClick}
          className="flex-shrink-0 w-52 p-4 rounded-lg border border-dashed border-white/[0.12] hover:border-amber-500/40 cursor-pointer transition-colors flex flex-col items-center justify-center gap-2 group min-h-[108px]"
        >
          <div className="w-8 h-8 rounded-full bg-white/5 group-hover:bg-amber-500/10 transition-colors flex items-center justify-center">
            <Plus size={14} className="text-zinc-500 group-hover:text-amber-400 transition-colors" />
          </div>
          <span className="text-xs text-zinc-600 group-hover:text-zinc-400 transition-colors">
            Analyze meeting
          </span>
        </motion.div>
      </div>
    </div>
  );
}

// ── Radar Card with dimension pills ───────────────────────────────────────────
function RadarCard({ title, subtitle, radarData, dimensions }) {
  if (!radarData || radarData.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-5">
        <h3 className="text-sm font-medium text-white mb-2">{title}</h3>
        <EmptyState icon={TrendingUp} message="Analyze meetings to build your profile" />
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-5">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-sm font-medium text-white">{title}</h3>
          {subtitle && <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>}
        </div>
        <span className="text-xs text-zinc-600">Last 30D</span>
      </div>
      <ResponsiveContainer width="100%" height={190}>
        <RadarChart data={radarData}>
          <PolarGrid stroke="rgba(255,255,255,0.07)" />
          <PolarAngleAxis dataKey="dim" tick={{ fill: '#52525b', fontSize: 9 }} />
          <PolarRadiusAxis domain={[0, 1]} tick={false} axisLine={false} />
          <Radar dataKey="v" stroke="#fbbf24" fill="#fbbf24" fillOpacity={0.22} />
        </RadarChart>
      </ResponsiveContainer>
      {dimensions && dimensions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {dimensions.map((d) => (
            <span
              key={d.name}
              className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-zinc-400 border border-white/[0.08]"
            >
              {d.name}:{' '}
              <span className="text-white font-medium">{Math.round(d.value * 100)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
function Dashboard() {
  const auth = useAuth();
  const navigate = useNavigate();
  const role = auth?.role || 'employee';
  const firstName = auth?.fullName?.split(' ')[0] || auth?.email?.split('@')[0] || 'there';

  const [data, setData]               = useState(null);
  const [allMeetings, setAllMeetings] = useState([]);
  const [teamsStatus, setTeamsStatus] = useState(null);
  const [benchmarks, setBenchmarks]   = useState(null);
  const [meData, setMeData]           = useState(null);
  const [teamParts, setTeamParts]     = useState([]);
  const [error, setError]             = useState('');
  const [timeRange, setTimeRange]     = useState('30D');

  const canViewTeam = isRole(auth, 'manager');

  useEffect(() => {
    getDashboard().then(setData).catch((e) => setError(e.message));
    getTeamsStatus().then(setTeamsStatus).catch(() => {});
    listMeetings().then((m) => setAllMeetings(m)).catch(() => {});
    if (isRole(auth, 'hr')) {
      getOrgBenchmarks(30).then(setBenchmarks).catch(() => {});
    }
    if (role === 'employee' || role === 'manager') {
      getMe().then(setMeData).catch(() => {});
    }
    if (canViewTeam) {
      getTeamParticipants({}).then(setTeamParts).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const connectTeams = async () => {
    try { const { url } = await getTeamsAuthUrl(); window.location.href = url; } catch { /* handled */ }
  };

  if (error) return <AppShell><div className="p-8 text-red-400 text-sm">{error}</div></AppShell>;
  if (!data)  return (
    <AppShell>
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
      </div>
    </AppShell>
  );

  const ex = data.executiveStats || {};
  const effTrend = data.efficiencyTrend || [];
  const spark = buildSparkData(effTrend);
  const { meetingsDelta, effDelta } = computeDeltas(effTrend);

  // Filtered trendline data based on timeRange
  const trendDays = timeRange === '7D' ? 7 : timeRange === '30D' ? 30 : 90;
  const trendCutoff = Date.now() - trendDays * 24 * 60 * 60 * 1000;
  const filteredTrend = effTrend
    .filter((r) => new Date(r.date).getTime() >= trendCutoff)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((r) => ({
      date: new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      efficiency: Math.round((r.efficiency || 0) * 100),
    }));

  // Radar data
  const orgRadarData = benchmarks
    ? [
        { dim: 'Engagement',    v: benchmarks.avgEngagement    ?? 0 },
        { dim: 'Sentiment',     v: benchmarks.avgSentiment     ?? 0 },
        { dim: 'Collaboration', v: benchmarks.avgCollaboration ?? 0 },
        { dim: 'Initiative',    v: benchmarks.avgInitiative    ?? 0 },
        { dim: 'Clarity',       v: benchmarks.avgClarity       ?? 0 },
      ]
    : [];

  const personalRadarData = meData
    ? [
        { dim: 'Engagement',    v: meData.stats?.avgScores?.engagement    ?? 0 },
        { dim: 'Sentiment',     v: meData.stats?.avgScores?.sentiment     ?? 0 },
        { dim: 'Collaboration', v: meData.stats?.avgScores?.collaboration ?? 0 },
        { dim: 'Initiative',    v: meData.stats?.avgScores?.initiative    ?? 0 },
        { dim: 'Clarity',       v: meData.stats?.avgScores?.clarity       ?? 0 },
      ]
    : [];

  const activeRadarData = isRole(auth, 'hr') ? orgRadarData : personalRadarData;
  const activeRadarTitle = isRole(auth, 'hr') ? 'Org Communication Profile' : 'My Communication Profile';
  const activeRadarSub   = isRole(auth, 'hr') ? 'Average across all participants' : 'Your average across meetings';
  const activeRadarDims  = activeRadarData.map((d) => ({ name: d.dim, value: d.v }));

  const recentMeetings = allMeetings.slice(0, 8);

  // Top performers: use team participants for manager+, else dashboard participantSummaries
  const topPerfSource = teamParts.length > 0 ? teamParts : (data.participantSummaries || []).map((p) => ({
    name: p.name,
    avg_engagement: p.avgEngagement,
    meeting_count: p.meetingsCount,
    meetings: [],
  }));

  return (
    <AppShell>
      <div className="space-y-5">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <motion.div
          className="flex items-center justify-between"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div>
            <h1 className="text-2xl font-heading font-semibold text-white">
              Good {getTimeOfDay()}, {firstName}
            </h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              {formatHeaderDate(new Date())} · {role} view
            </p>
          </div>

          {/* Teams sync pill */}
          {teamsStatus?.connected ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-zinc-400">Teams sync active</span>
            </div>
          ) : teamsStatus?.configured ? (
            <button
              type="button"
              onClick={connectTeams}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-xs text-zinc-400 hover:border-accent/40 hover:text-accent transition-colors"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
              Connect Teams
            </button>
          ) : null}
        </motion.div>

        {/* ── KPI Cards ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard
            label="Meetings (30D)"
            value={<CountUp target={ex.meetingsLast30 || 0} />}
            delta={meetingsDelta}
            icon={Calendar}
            sparkData={spark.meetings}
            colorKey="purple"
            delay={0.05}
            primary
          />
          <KPICard
            label="Avg Efficiency"
            value={
              ex.avgEfficiencyLast30 != null
                ? <CountUp target={Math.round(ex.avgEfficiencyLast30 * 100)} suffix="%" />
                : '—'
            }
            delta={effDelta}
            icon={Zap}
            sparkData={spark.efficiency}
            colorKey="teal"
            delay={0.12}
          />
          <KPICard
            label="Participation"
            value={
              ex.liveParticipationPercent != null
                ? <CountUp target={ex.liveParticipationPercent} suffix="%" />
                : '—'
            }
            delta={null}
            icon={Users}
            sparkData={null}
            colorKey="violet"
            delay={0.19}
          />
          <KPICard
            label="Participants"
            value={<CountUp target={ex.uniqueParticipants || 0} />}
            delta={null}
            icon={UserCheck}
            sparkData={null}
            colorKey="indigo"
            delay={0.26}
          />
        </div>

        {/* ── Trendline + Activity Feed ────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* AreaChart — takes 2/3 width */}
          <motion.div
            className="lg:col-span-2 rounded-xl border border-white/[0.08] bg-white/[0.04] p-5"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.15 }}
          >
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-heading text-sm font-medium text-white">Efficiency Trendline</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Meeting effectiveness over time</p>
              </div>
              <div className="flex gap-1">
                {['7D', '30D', '90D'].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setTimeRange(r)}
                    className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                      timeRange === r
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {filteredTrend.length < 2 ? (
              <EmptyState
                icon={TrendingUp}
                message="Analyze your first meeting to see trends"
                action="Analyze Meeting"
                onAction={() => navigate('/analyze')}
              />
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={filteredTrend}>
                  <defs>
                    <linearGradient id="effGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#fbbf24" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#fbbf24" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: '#52525b', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#52525b', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    domain={[0, 100]}
                    tickFormatter={(v) => v + '%'}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#1a1a1f',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v) => [v + '%', 'Efficiency']}
                  />
                  <Area
                    type="monotone"
                    dataKey="efficiency"
                    stroke="#fbbf24"
                    strokeWidth={2}
                    fill="url(#effGradient)"
                    isAnimationActive
                    animationDuration={1500}
                    animationEasing="ease-out"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </motion.div>

          {/* Activity Feed — 1/3 width */}
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.25 }}
            className="h-full"
          >
            <ActivityFeed meetings={allMeetings} />
          </motion.div>
        </div>

        {/* ── Radar + Top Performers (or triage for employee) ──────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Radar — 2/5 */}
          <motion.div
            className="lg:col-span-2"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.3 }}
          >
            <RadarCard
              title={activeRadarTitle}
              subtitle={activeRadarSub}
              radarData={activeRadarData}
              dimensions={activeRadarDims}
            />
          </motion.div>

          {/* Top performers — 3/5 */}
          <motion.div
            className="lg:col-span-3"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.37 }}
          >
            {canViewTeam || isRole(auth, 'hr') ? (
              <TopPerformers participants={topPerfSource} />
            ) : (
              /* Employee: show triage/alerts */
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-5 h-full">
                <h3 className="text-sm font-medium text-white mb-4">Triage Queue</h3>
                <div className="space-y-3">
                  {data.alerts.recentDominance > 0 && (
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/15">
                      <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0 mt-1" />
                      <span className="text-sm text-amber-300">
                        {data.alerts.recentDominance} dominance warning{data.alerts.recentDominance > 1 ? 's' : ''} this month
                      </span>
                    </div>
                  )}
                  {data.alerts.recentLowEngagement > 0 && (
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/5 border border-red-500/15">
                      <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0 mt-1" />
                      <span className="text-sm text-red-300">
                        {data.alerts.recentLowEngagement} low engagement alert{data.alerts.recentLowEngagement > 1 ? 's' : ''}
                      </span>
                    </div>
                  )}
                  {data.alerts.recentDominance === 0 && data.alerts.recentLowEngagement === 0 && (
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0 mt-1" />
                      <span className="text-sm text-emerald-300">
                        No urgent alerts — communication health looks good
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        </div>

        {/* ── Recent Meetings (horizontal scroll) ──────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.44 }}
        >
          <RecentMeetingsRow
            meetings={recentMeetings}
            onAddClick={() => navigate('/analyze')}
          />
        </motion.div>

      </div>
    </AppShell>
  );
}

export default Dashboard;
