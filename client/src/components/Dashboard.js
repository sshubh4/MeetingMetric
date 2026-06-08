import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';
import AppShell from './AppShell';
import { getDashboard, getTeamsStatus, getTeamsAuthUrl, listMeetings, getOrgBenchmarks, getMe } from '../api';
import { useAuth } from '../hooks/useAuth';

function StatCard({ value, label, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-val">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="text-xs text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function Dashboard() {
  const auth = useAuth();
  const role = auth?.role || 'employee';

  const [data, setData] = useState(null);
  const [recent, setRecent] = useState([]);
  const [teamsStatus, setTeamsStatus] = useState(null);
  const [benchmarks, setBenchmarks] = useState(null);
  const [meData, setMeData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getDashboard().then(setData).catch((e) => setError(e.message));
    getTeamsStatus().then(setTeamsStatus).catch(() => {});
    listMeetings().then((m) => setRecent(m.slice(0, 6))).catch(() => {});
    if (role === 'hr' || role === 'admin') {
      getOrgBenchmarks(30).then(setBenchmarks).catch(() => {});
    }
    if (role === 'employee' || role === 'manager') {
      getMe().then(setMeData).catch(() => {});
    }
  }, [role]);

  const connectTeams = async () => {
    try { const { url } = await getTeamsAuthUrl(); window.location.href = url; } catch { /* handled */ }
  };

  const fmtDate = (iso) => {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (error) return <AppShell title="Dashboard"><p className="text-danger">{error}</p></AppShell>;
  if (!data) return <AppShell title="Dashboard"><p className="text-muted">Loading…</p></AppShell>;

  const ex = data.executiveStats || {};
  const chartData = [...data.efficiencyTrend].reverse().map((row) => ({
    label: (row.date || '').slice(0, 10),
    eff: Math.round((row.efficiency || 0) * 100),
  }));

  const alerts = [];
  if (data.alerts.recentDominance > 0)
    alerts.push({ type: 'warn', text: `${data.alerts.recentDominance} dominance warning${data.alerts.recentDominance > 1 ? 's' : ''} this month` });
  if (data.alerts.recentLowEngagement > 0)
    alerts.push({ type: 'danger', text: `${data.alerts.recentLowEngagement} low engagement alert${data.alerts.recentLowEngagement > 1 ? 's' : ''}` });
  if (alerts.length === 0)
    alerts.push({ type: 'good', text: 'No urgent alerts — communication health looks good' });

  const alertColor = { warn: 'text-warning', danger: 'text-danger', good: 'text-positive' };
  const alertDot = { warn: 'bg-warning', danger: 'bg-danger', good: 'bg-positive' };

  // Org radar data for hr/admin
  const orgRadarData = benchmarks ? [
    { dim: 'Engagement', v: benchmarks.avgEngagement ?? 0 },
    { dim: 'Sentiment', v: benchmarks.avgSentiment ?? 0 },
    { dim: 'Collaboration', v: benchmarks.avgCollaboration ?? 0 },
    { dim: 'Initiative', v: benchmarks.avgInitiative ?? 0 },
    { dim: 'Clarity', v: benchmarks.avgClarity ?? 0 },
  ] : [];

  // Personal radar for employee/manager
  const personalRadarData = meData ? [
    { dim: 'Engagement', v: meData.stats?.avgScores?.engagement ?? 0 },
    { dim: 'Sentiment', v: meData.stats?.avgScores?.sentiment ?? 0 },
    { dim: 'Collaboration', v: meData.stats?.avgScores?.collaboration ?? 0 },
    { dim: 'Initiative', v: meData.stats?.avgScores?.initiative ?? 0 },
    { dim: 'Clarity', v: meData.stats?.avgScores?.clarity ?? 0 },
  ] : [];

  const subtitle = role === 'employee' ? 'Your personal performance'
    : role === 'manager' ? 'Team health overview'
    : 'Organization-wide meeting intelligence';

  return (
    <AppShell title="Dashboard" subtitle={subtitle}>

      {/* Teams connect banner */}
      {teamsStatus?.configured && !teamsStatus.connected && (
        <button
          type="button"
          onClick={connectTeams}
          className="w-full mb-5 card flex items-center gap-4 hover:border-accent/30 transition-colors text-left"
        >
          <span className="text-2xl">⊞</span>
          <div>
            <div className="font-semibold text-white text-sm">Connect Microsoft Teams</div>
            <div className="text-muted text-xs">Sync calendar, import transcripts, enable auto-ingestion</div>
          </div>
          <span className="ml-auto text-muted">→</span>
        </button>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard value={ex.meetingsLast30 ?? 0} label="Meetings (30d)" />
        <StatCard
          value={ex.avgEfficiencyLast30 != null ? `${Math.round(ex.avgEfficiencyLast30 * 100)}%` : '—'}
          label="Avg Efficiency"
        />
        <StatCard
          value={ex.liveParticipationPercent != null ? `${ex.liveParticipationPercent}%` : '—'}
          label="Participation"
        />
        <StatCard value={ex.uniqueParticipants ?? 0} label="Participants" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
        {/* Efficiency trendline */}
        <div className="card">
          <h2 className="text-sm font-semibold text-white mb-4">Efficiency Trendline</h2>
          {chartData.length === 0 ? (
            <p className="text-muted text-sm">Upload meetings to see trends.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="label" tick={{ fill: '#8b95a8', fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fill: '#8b95a8', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: '#1e2028', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                <Line type="monotone" dataKey="eff" name="Efficiency %" stroke="#a78bfa" strokeWidth={2.5} dot={{ fill: '#7c3aed', r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Radar or triage */}
        {(role === 'hr' || role === 'admin') && benchmarks && orgRadarData.length > 0 ? (
          <div className="card">
            <h2 className="text-sm font-semibold text-white mb-4">Org Communication Profile</h2>
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart data={orgRadarData}>
                <PolarGrid stroke="rgba(255,255,255,0.08)" />
                <PolarAngleAxis dataKey="dim" tick={{ fill: '#8b95a8', fontSize: 10 }} />
                <PolarRadiusAxis domain={[0, 1]} tick={false} axisLine={false} />
                <Radar dataKey="v" stroke="#55e7fc" fill="#55e7fc" fillOpacity={0.2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        ) : (role === 'employee' || role === 'manager') && personalRadarData.length > 0 ? (
          <div className="card">
            <h2 className="text-sm font-semibold text-white mb-4">My Communication Profile</h2>
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart data={personalRadarData}>
                <PolarGrid stroke="rgba(255,255,255,0.08)" />
                <PolarAngleAxis dataKey="dim" tick={{ fill: '#8b95a8', fontSize: 10 }} />
                <PolarRadiusAxis domain={[0, 1]} tick={false} axisLine={false} />
                <Radar dataKey="v" stroke="#a78bfa" fill="#7c3aed" fillOpacity={0.3} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="card">
            <h2 className="text-sm font-semibold text-white mb-4">Triage Queue</h2>
            <div className="space-y-3">
              {alerts.map((a, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${alertDot[a.type]}`} />
                  <span className={`text-sm ${alertColor[a.type]}`}>{a.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Recent activity */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-white">Recent Meetings</h2>
          <Link to="/meetings" className="text-xs text-accent hover:text-accent/80">View all →</Link>
        </div>
        {recent.length === 0 ? (
          <p className="text-muted text-sm">No meetings yet. <Link to="/analyze" className="text-accent hover:underline">Analyze one</Link> to get started.</p>
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {recent.map((r) => (
              <Link to={`/meeting/${r.id}`} key={r.id} className="flex items-center gap-4 py-3 hover:bg-white/5 -mx-5 px-5 transition-colors rounded-lg">
                <span className="text-xs text-muted w-20 flex-shrink-0">{fmtDate(r.scheduled_at || r.created_at)}</span>
                <span className="text-sm text-slate-200 flex-1 truncate">{r.title}</span>
                {r.project_name && <span className="badge badge-role-employee text-xs hidden md:inline-flex">{r.project_name}</span>}
                <span className="text-xs text-accent font-medium flex-shrink-0">
                  {r.efficiency_score != null ? `${Math.round(r.efficiency_score * 100)}%` : '—'}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default Dashboard;
