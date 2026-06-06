import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import AppShell from './AppShell';
import { getReports } from '../api';

function ReportsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (dateFrom) params.from = dateFrom;
    if (dateTo)   params.to   = dateTo;
    getReports(params)
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const handleExportCSV = () => {
    if (!data) return;
    const rows = [
      ['Date', 'Meeting', 'Efficiency %', 'Engagement %', 'Sentiment %', 'Collaboration %', 'Initiative %', 'Clarity %'],
      ...data.dimensionTrends.map((r) => [
        r.date, `"${r.title}"`, r.efficiency, r.engagement, r.sentiment,
        r.collaboration, r.initiative, r.clarity,
      ]),
      [],
      ['Participant', 'Meetings', 'Avg Engagement %', 'Avg Sentiment %', 'Avg Collaboration %', 'Avg Initiative %', 'Avg Clarity %', 'Avg Talk %'],
      ...data.topParticipants.map((p) => [
        `"${p.name}"`, p.meeting_count,
        Math.round(p.avg_engagement    * 100),
        Math.round(p.avg_sentiment     * 100),
        Math.round(p.avg_collaboration * 100),
        Math.round(p.avg_initiative    * 100),
        Math.round(p.avg_clarity       * 100),
        Math.round(p.avg_talk_ratio    * 100),
      ]),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MeetingMetric_Report_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell title="Reports" subtitle="Aggregated performance analytics across all meetings">

      {/* ── Toolbar ── */}
      <div className="cmd-toolbar">
        <div className="date-filter">
          <label>
            From
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          {(dateFrom || dateTo) && (
            <button
              type="button"
              className="btn-ghost small"
              onClick={() => { setDateFrom(''); setDateTo(''); }}
            >
              Clear
            </button>
          )}
        </div>
        <button
          type="button"
          className="btn-primary compact"
          onClick={handleExportCSV}
          disabled={!data || loading || !data.summary.totalMeetings}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            style={{ marginRight: 6, verticalAlign: -1 }}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Export CSV
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p className="muted">Loading report…</p>
      ) : !data || data.summary.totalMeetings === 0 ? (
        <div className="exec-card">
          <p className="muted">
            No meetings found{dateFrom || dateTo ? ' in the selected date range' : ''}.{' '}
            <Link to="/analyze">Analyze a meeting</Link> to generate reports.
          </p>
        </div>
      ) : (
        <>
          {/* ── KPI cards ── */}
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </div>
              <div className="metric-body">
                <span className="metric-val">{data.summary.totalMeetings}</span>
                <span className="metric-label">Total Meetings</span>
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-icon accent">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                </svg>
              </div>
              <div className="metric-body">
                <span className="metric-val">
                  {data.summary.avgEfficiency != null ? `${data.summary.avgEfficiency}%` : '—'}
                </span>
                <span className="metric-label">Avg Efficiency</span>
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              </div>
              <div className="metric-body">
                <span className="metric-val">{data.summary.totalParticipants}</span>
                <span className="metric-label">Participants</span>
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <div className="metric-body">
                <span className="metric-val">{data.projectBreakdown.length}</span>
                <span className="metric-label">Projects</span>
              </div>
            </div>
          </div>

          {/* ── Dimension trend chart ── */}
          {data.dimensionTrends.length > 0 && (
            <div className="exec-card" style={{ marginBottom: '0.75rem' }}>
              <h2 className="exec-card-title">5-Dimension Trend</h2>
              <div className="chart-wrap tall">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={data.dimensionTrends}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="date" tick={{ fill: '#8b95a8', fontSize: 10 }} />
                    <YAxis domain={[0, 100]} tick={{ fill: '#8b95a8', fontSize: 10 }} unit="%" />
                    <Tooltip
                      contentStyle={{ background: '#141720', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                      labelStyle={{ color: '#e8eaed' }}
                      formatter={(v, name) => [`${v}%`, name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 12, color: '#8b95a8', paddingTop: 8 }} />
                    <Line type="monotone" dataKey="engagement"    name="Engagement"    stroke="#a78bfa" strokeWidth={2}   dot={{ r: 3, fill: '#a78bfa' }}   activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="sentiment"     name="Sentiment"     stroke="#4ade80" strokeWidth={1.5} dot={{ r: 2, fill: '#4ade80' }}   activeDot={{ r: 4 }} />
                    <Line type="monotone" dataKey="collaboration" name="Collaboration" stroke="#55e7fc" strokeWidth={1.5} dot={{ r: 2, fill: '#55e7fc' }}   activeDot={{ r: 4 }} />
                    <Line type="monotone" dataKey="initiative"    name="Initiative"    stroke="#fbbf24" strokeWidth={1.5} dot={{ r: 2, fill: '#fbbf24' }}   activeDot={{ r: 4 }} />
                    <Line type="monotone" dataKey="clarity"       name="Clarity"       stroke="#f87171" strokeWidth={1.5} dot={{ r: 2, fill: '#f87171' }}   activeDot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── Top performers + project breakdown ── */}
          <div className="cmd-grid-2" style={{ marginBottom: '0.75rem' }}>
            <div className="exec-card">
              <h2 className="exec-card-title">Top Performers</h2>
              {data.topParticipants.length === 0 ? (
                <p className="muted small">No participant data yet.</p>
              ) : (
                <div className="table-wrap">
                  <table className="exec-table">
                    <thead>
                      <tr>
                        <th>Participant</th>
                        <th>Meetings</th>
                        <th>Engagement</th>
                        <th>Talk ratio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topParticipants.map((p) => (
                        <tr key={p.name}>
                          <td style={{ fontWeight: 600 }}>{p.name}</td>
                          <td className="muted">{p.meeting_count}</td>
                          <td><span className="eff-badge small">{Math.round(p.avg_engagement * 100)}%</span></td>
                          <td className="muted">{Math.round(p.avg_talk_ratio * 100)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="exec-card">
              <h2 className="exec-card-title">Project Breakdown</h2>
              {data.projectBreakdown.length === 0 ? (
                <p className="muted small">No projects yet.</p>
              ) : (
                <div className="table-wrap">
                  <table className="exec-table">
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Meetings</th>
                        <th>Avg Eff.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.projectBreakdown.map((p) => (
                        <tr key={p.name}>
                          <td>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{
                                width: 8, height: 8, borderRadius: '50%',
                                background: p.color, flexShrink: 0, display: 'inline-block',
                              }} />
                              {p.name}
                            </span>
                          </td>
                          <td className="muted">{p.meeting_count}</td>
                          <td>
                            {p.avg_efficiency != null
                              ? <span className="eff-badge small">{p.avg_efficiency}%</span>
                              : <span className="muted">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* ── Most / least efficient meetings ── */}
          <div className="cmd-grid-2">
            <div className="exec-card">
              <h2 className="exec-card-title">Most Efficient</h2>
              {data.topMeetings.length === 0 ? (
                <p className="muted small">No data.</p>
              ) : (
                <div className="reports-meetings-list">
                  {data.topMeetings.map((m) => (
                    <div key={m.id} className="reports-meeting-row">
                      <div className="reports-meeting-row-info">
                        <Link to={`/meeting/${m.id}`} className="reports-meeting-title">{m.title}</Link>
                        <span className="muted small">
                          {m.date}{m.project_name ? ` · ${m.project_name}` : ''}
                        </span>
                      </div>
                      <span className="eff-badge small">{m.efficiency}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="exec-card">
              <h2 className="exec-card-title">Needs Attention</h2>
              {data.bottomMeetings.length === 0 ? (
                <p className="muted small">
                  {data.topMeetings.length <= 5
                    ? 'All meetings displayed above.'
                    : 'No data.'}
                </p>
              ) : (
                <div className="reports-meetings-list">
                  {data.bottomMeetings.map((m) => (
                    <div key={m.id} className="reports-meeting-row">
                      <div className="reports-meeting-row-info">
                        <Link to={`/meeting/${m.id}`} className="reports-meeting-title">{m.title}</Link>
                        <span className="muted small">
                          {m.date}{m.project_name ? ` · ${m.project_name}` : ''}
                        </span>
                      </div>
                      <span
                        className="eff-badge small"
                        style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171' }}
                      >
                        {m.efficiency}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}

export default ReportsPage;
