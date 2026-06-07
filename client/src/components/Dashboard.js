import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import AppShell from './AppShell';
import { getDashboard, getTeamsStatus, getTeamsAuthUrl, listMeetings } from '../api';

function Dashboard() {
  const [data, setData] = useState(null);
  const [recent, setRecent] = useState([]);
  const [error, setError] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [teamsStatus, setTeamsStatus] = useState(null);

  useEffect(() => {
    getDashboard().then(setData).catch((e) => setError(e.message));
    getTeamsStatus().then(setTeamsStatus).catch(() => {});
    listMeetings().then((m) => setRecent(m.slice(0, 6))).catch(() => {});
  }, []);

  const connectTeams = async () => {
    try {
      const { url } = await getTeamsAuthUrl();
      window.location.href = url;
    } catch { /* handled in settings */ }
  };

  if (error) return <AppShell title="Command Center"><p className="error">{error}</p></AppShell>;
  if (!data) return <AppShell title="Command Center"><p className="muted">Loading…</p></AppShell>;

  const filterByDate = (arr, dateKey) => {
    if (!dateFrom && !dateTo) return arr;
    return arr.filter((r) => {
      const ds = (r[dateKey] || '').slice(0, 10);
      if (dateFrom && ds < dateFrom) return false;
      if (dateTo && ds > dateTo) return false;
      return true;
    });
  };

  const trendFiltered = filterByDate([...data.efficiencyTrend].reverse(), 'date');
  const chartData = trendFiltered.map((row) => ({
    ...row,
    label: row.date ? row.date.slice(0, 10) : '',
    eff: Math.round((row.efficiency || 0) * 100),
  }));

  const ex = data.executiveStats || {};

  const alerts = [];
  if (data.alerts.recentDominance > 0)
    alerts.push({ type: 'warn', text: `${data.alerts.recentDominance} dominance warning${data.alerts.recentDominance > 1 ? 's' : ''} this month` });
  if (data.alerts.recentLowEngagement > 0)
    alerts.push({ type: 'danger', text: `${data.alerts.recentLowEngagement} low engagement alert${data.alerts.recentLowEngagement > 1 ? 's' : ''}` });
  if (ex.avgEfficiencyLast30 != null && ex.avgEfficiencyLast30 < 0.5)
    alerts.push({ type: 'warn', text: 'Average efficiency below 50% — consider reviewing meeting formats' });
  if (alerts.length === 0)
    alerts.push({ type: 'good', text: 'No urgent alerts — communication health looks good' });

  const fmtDate = (iso) => {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <AppShell title="Command Center" subtitle="Organization-wide meeting intelligence">
      {/* Date filters */}
      <div className="cmd-toolbar">
        <div className="date-filter">
          <label>From<input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
          <label>To<input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
          {(dateFrom || dateTo) && (
            <button type="button" className="btn-ghost small" onClick={() => { setDateFrom(''); setDateTo(''); }}>Clear</button>
          )}
        </div>
      </div>

      {/* Teams banner */}
      {teamsStatus && teamsStatus.configured && !teamsStatus.connected && (
        <div className="teams-connect-banner" onClick={connectTeams} role="button" tabIndex={0}>
          <div className="teams-banner-left">
            <span className="teams-banner-icon">⊞</span>
            <div>
              <strong>Connect Microsoft Teams</strong>
              <span className="muted small">Sync your calendar, import transcripts, and enable real-time analysis</span>
            </div>
          </div>
          <span className="teams-banner-arrow">→</span>
        </div>
      )}

      {/* Macro metrics grid */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <div className="metric-body">
            <span className="metric-val">{ex.meetingsLast30 ?? 0}</span>
            <span className="metric-label">Meetings (30d)</span>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon accent">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          </div>
          <div className="metric-body">
            <span className="metric-val">
              {ex.avgEfficiencyLast30 != null ? `${Math.round(ex.avgEfficiencyLast30 * 100)}%` : '—'}
            </span>
            <span className="metric-label">Avg Efficiency</span>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <div className="metric-body">
            <span className="metric-val">
              {ex.liveParticipationPercent != null ? `${ex.liveParticipationPercent}%` : '—'}
            </span>
            <span className="metric-label">Participation Index</span>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div className="metric-body">
            <span className="metric-val">{ex.uniqueParticipants ?? 0}</span>
            <span className="metric-label">Unique Participants</span>
          </div>
        </div>
      </div>

      {/* Two-column: trendline + triage queue */}
      <div className="cmd-grid-2">
        <div className="exec-card">
          <h2 className="exec-card-title">Efficiency Trendline</h2>
          {chartData.length === 0 ? (
            <p className="muted">Upload meetings to see trends.</p>
          ) : (
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="label" tick={{ fill: '#8b95a8', fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#8b95a8', fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: '#141720', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} labelStyle={{ color: '#e8eaed' }} />
                  <Line type="monotone" dataKey="eff" name="Efficiency %" stroke="#a78bfa" strokeWidth={2.5} dot={{ fill: '#7c3aed', r: 3 }} activeDot={{ r: 5, fill: '#a78bfa' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="exec-card triage-card">
          <h2 className="exec-card-title">Triage Queue</h2>
          <div className="triage-list">
            {alerts.map((a, i) => (
              <div key={i} className={`triage-item ${a.type}`}>
                <span className="triage-dot" />
                <span>{a.text}</span>
              </div>
            ))}
          </div>
          <div className="triage-summary">
            <div className="triage-summary-row">
              <span className="muted small">Total tracked</span>
              <strong>{data.meetingCount}</strong>
            </div>
            <div className="triage-summary-row">
              <span className="muted small">Dominance flags</span>
              <strong>{data.alerts.recentDominance}</strong>
            </div>
            <div className="triage-summary-row">
              <span className="muted small">Low engagement</span>
              <strong>{data.alerts.recentLowEngagement}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Recent activity stream */}
      <div className="exec-card">
        <div className="activity-header">
          <h2 className="exec-card-title">Recent Activity</h2>
          <Link to="/meetings" className="btn-ghost small">View all →</Link>
        </div>
        {recent.length === 0 ? (
          <p className="muted">No meetings yet. Upload a transcript to get started.</p>
        ) : (
          <div className="activity-stream">
            {recent.map((r) => (
              <Link to={`/meeting/${r.id}`} key={r.id} className="activity-card">
                <div className="activity-left">
                  <span className="activity-date">{fmtDate(r.scheduled_at || r.created_at)}</span>
                </div>
                <div className="activity-body">
                  <strong>{r.title}</strong>
                  {r.project_name && <span className="pill small">{r.project_name}</span>}
                </div>
                <span className="eff-badge small">
                  {r.efficiency_score != null ? `${Math.round(r.efficiency_score * 100)}%` : '—'}
                </span>
                <span className="activity-arrow">→</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default Dashboard;
