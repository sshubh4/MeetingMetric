import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import AppShell from './AppShell';
import { getReports } from '../api';
import { useAuth, isRole } from '../hooks/useAuth';

function ReportsPage() {
  const auth = useAuth();
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [dateFrom, setDateFrom]   = useState('');
  const [dateTo, setDateTo]       = useState('');
  const [deptFilter, setDeptFilter] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (dateFrom) params.from = dateFrom;
    if (dateTo) params.to = dateTo;
    if (deptFilter) params.dept = deptFilter;
    getReports(params)
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, deptFilter]);

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

  const canSeeOrgFilters = isRole(auth, 'hr', 'admin');

  return (
    <AppShell title="Reports" subtitle="Aggregated performance analytics across meetings">

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <input type="date" className="input w-auto text-sm" value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)} title="From" />
        <input type="date" className="input w-auto text-sm" value={dateTo}
          onChange={(e) => setDateTo(e.target.value)} title="To" />
        {canSeeOrgFilters && (
          <input type="text" className="input w-auto text-sm" placeholder="Filter by dept…" value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)} />
        )}
        {(dateFrom || dateTo || deptFilter) && (
          <button type="button" className="btn-ghost text-sm"
            onClick={() => { setDateFrom(''); setDateTo(''); setDeptFilter(''); }}>
            Clear
          </button>
        )}
        <div className="ml-auto">
          <button type="button" className="btn-ghost flex items-center gap-2"
            onClick={handleExportCSV}
            disabled={!data || loading || !data?.summary?.totalMeetings}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      {error && <p className="text-danger text-sm mb-4">{error}</p>}

      {loading ? (
        <p className="text-muted">Loading report…</p>
      ) : !data || data.summary.totalMeetings === 0 ? (
        <div className="card text-center py-12">
          <p className="text-muted">
            No meetings found{dateFrom || dateTo ? ' in the selected range' : ''}.{' '}
            <Link to="/analyze" className="text-accent hover:underline">Analyze a meeting</Link> to generate reports.
          </p>
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
            {[
              { label: 'Total Meetings',  value: data.summary.totalMeetings },
              { label: 'Avg Efficiency',  value: data.summary.avgEfficiency != null ? `${data.summary.avgEfficiency}%` : '—' },
              { label: 'Participants',    value: data.summary.totalParticipants },
              { label: 'Projects',        value: data.projectBreakdown.length },
            ].map(({ label, value }) => (
              <div key={label} className="stat-card">
                <div className="stat-val">{value}</div>
                <div className="stat-label">{label}</div>
              </div>
            ))}
          </div>

          {/* 5-Dimension trend */}
          {data.dimensionTrends.length > 0 && (
            <div className="card mb-5">
              <h2 className="text-sm font-semibold text-white mb-4">5-Dimension Trend</h2>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={data.dimensionTrends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="date" tick={{ fill: '#8b95a8', fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#8b95a8', fontSize: 10 }} unit="%" />
                  <Tooltip contentStyle={{ background: '#16181d', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }}
                    labelStyle={{ color: '#e8eaed' }} formatter={(v, name) => [`${v}%`, name]} />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#8b95a8', paddingTop: 8 }} />
                  <Line type="monotone" dataKey="engagement"    name="Engagement"    stroke="#a78bfa" strokeWidth={2}   dot={{ r: 3, fill: '#a78bfa' }} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="sentiment"     name="Sentiment"     stroke="#4ade80" strokeWidth={1.5} dot={{ r: 2, fill: '#4ade80' }} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="collaboration" name="Collaboration" stroke="#55e7fc" strokeWidth={1.5} dot={{ r: 2, fill: '#55e7fc' }} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="initiative"    name="Initiative"    stroke="#fbbf24" strokeWidth={1.5} dot={{ r: 2, fill: '#fbbf24' }} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="clarity"       name="Clarity"       stroke="#f87171" strokeWidth={1.5} dot={{ r: 2, fill: '#f87171' }} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Top performers + project breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
            <div className="card">
              <h2 className="text-sm font-semibold text-white mb-4">Top Performers</h2>
              {data.topParticipants.length === 0 ? (
                <p className="text-muted text-sm">No participant data yet.</p>
              ) : (
                <table className="table-base">
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
                        <td className="font-medium text-slate-200">{p.name}</td>
                        <td className="text-muted">{p.meeting_count}</td>
                        <td><span className="text-accent font-semibold text-xs">{Math.round(p.avg_engagement * 100)}%</span></td>
                        <td className="text-muted">{Math.round(p.avg_talk_ratio * 100)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card">
              <h2 className="text-sm font-semibold text-white mb-4">Project Breakdown</h2>
              {data.projectBreakdown.length === 0 ? (
                <p className="text-muted text-sm">No projects yet.</p>
              ) : (
                <table className="table-base">
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
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
                            <span className="text-slate-200">{p.name}</span>
                          </div>
                        </td>
                        <td className="text-muted">{p.meeting_count}</td>
                        <td>
                          {p.avg_efficiency != null
                            ? <span className="text-accent font-semibold text-xs">{p.avg_efficiency}%</span>
                            : <span className="text-muted">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Most / least efficient */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="card">
              <h2 className="text-sm font-semibold text-white mb-4">Most Efficient</h2>
              {data.topMeetings.length === 0 ? (
                <p className="text-muted text-sm">No data.</p>
              ) : (
                <div className="divide-y divide-white/[0.05]">
                  {data.topMeetings.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <Link to={`/meeting/${m.id}`} className="text-sm text-slate-200 hover:text-accent truncate block">{m.title}</Link>
                        <div className="text-xs text-muted">{m.date}{m.project_name ? ` · ${m.project_name}` : ''}</div>
                      </div>
                      <span className="text-xs text-positive font-semibold flex-shrink-0">{m.efficiency}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <h2 className="text-sm font-semibold text-white mb-4">Needs Attention</h2>
              {data.bottomMeetings.length === 0 ? (
                <p className="text-muted text-sm">All meetings displayed above.</p>
              ) : (
                <div className="divide-y divide-white/[0.05]">
                  {data.bottomMeetings.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <Link to={`/meeting/${m.id}`} className="text-sm text-slate-200 hover:text-accent truncate block">{m.title}</Link>
                        <div className="text-xs text-muted">{m.date}{m.project_name ? ` · ${m.project_name}` : ''}</div>
                      </div>
                      <span className="text-xs text-danger font-semibold flex-shrink-0">{m.efficiency}%</span>
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
