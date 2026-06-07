import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import AppShell from './AppShell';
import { getTeamParticipants, listProjects } from '../api';

function TeamPage() {
  const [participants, setParticipants] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => { listProjects().then(setProjects).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    const params = {};
    if (dateFrom) params.from = dateFrom;
    if (dateTo) params.to = dateTo;
    if (projectFilter) params.project_id = projectFilter;
    getTeamParticipants(params)
      .then(setParticipants)
      .catch(() => setParticipants([]))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, projectFilter]);

  const initials = (name) =>
    name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  const dims = [
    { key: 'avg_engagement', label: 'Engagement' },
    { key: 'avg_sentiment', label: 'Sentiment' },
    { key: 'avg_collaboration', label: 'Collaboration' },
    { key: 'avg_initiative', label: 'Initiative' },
    { key: 'avg_clarity', label: 'Clarity' },
  ];

  return (
    <AppShell title="Roster & Trajectories" subtitle="Employee performance trajectories across meetings">
      <div className="cmd-toolbar">
        <div className="date-filter">
          <label>From<input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
          <label>To<input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
          <label>
            Project
            <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
              <option value="">All projects</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {(dateFrom || dateTo || projectFilter) && (
            <button type="button" className="btn-ghost small" onClick={() => { setDateFrom(''); setDateTo(''); setProjectFilter(''); }}>Clear</button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="muted">Loading team data…</p>
      ) : participants.length === 0 ? (
        <div className="exec-card"><p className="muted">No participants found. Upload meetings to see your team.</p></div>
      ) : (
        <div className="roster-grid">
          {participants.map((p) => {
            const isExpanded = expanded === p.name;
            const radar = dims.map((d) => ({ dim: d.label, v: p[d.key] ?? 0 }));
            const trendData = (p.meetings || []).slice(-10).map((mt, i) => ({
              idx: i + 1,
              engagement: Math.round((mt.scores?.engagement ?? 0) * 100),
              sentiment: Math.round((mt.scores?.sentiment ?? 0) * 100),
              clarity: Math.round((mt.scores?.clarity ?? 0) * 100),
            }));

            return (
              <div key={p.name} className={`exec-card roster-card ${isExpanded ? 'expanded' : ''}`}>
                <div className="roster-card-head" onClick={() => setExpanded(isExpanded ? null : p.name)} role="button" tabIndex={0}>
                  <div className="avatar">{initials(p.name)}</div>
                  <div className="roster-info">
                    <strong>{p.name}</strong>
                    <span className="muted small">{p.meeting_count} meeting{p.meeting_count !== 1 ? 's' : ''}{p.projects.length > 0 ? ` · ${p.projects.join(', ')}` : ''}</span>
                  </div>
                  <div className="roster-score">
                    <span className="eff-badge">{Math.round(p.avg_engagement * 100)}%</span>
                    <span className="muted small">engagement</span>
                  </div>
                  <span className={`expand-arrow ${isExpanded ? 'open' : ''}`}>▾</span>
                </div>

                {isExpanded && (
                  <div className="roster-detail">
                    <div className="roster-detail-grid">
                      {/* Radar chart */}
                      <div className="roster-radar-wrap">
                        <ResponsiveContainer width="100%" height={200}>
                          <RadarChart data={radar}>
                            <PolarGrid stroke="rgba(255,255,255,0.08)" />
                            <PolarAngleAxis dataKey="dim" tick={{ fill: '#8b95a8', fontSize: 9 }} />
                            <PolarRadiusAxis domain={[0, 1]} tick={false} axisLine={false} />
                            <Radar dataKey="v" stroke="#a78bfa" fill="#7c3aed" fillOpacity={0.3} />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>

                      {/* Dimension bars + stats */}
                      <div className="roster-stats">
                        {dims.map((d) => (
                          <div key={d.key} className="team-stat-row">
                            <span>{d.label}</span>
                            <div className="team-bar-track">
                              <div className="team-bar-fill" style={{ width: `${(p[d.key] ?? 0) * 100}%` }} />
                            </div>
                            <span className="team-bar-val">{((p[d.key] ?? 0) * 100).toFixed(0)}%</span>
                          </div>
                        ))}
                        <div className="team-stat-row">
                          <span>Talk ratio</span>
                          <div className="team-bar-track">
                            <div className="team-bar-fill" style={{ width: `${(p.avg_talk_ratio ?? 0) * 100}%` }} />
                          </div>
                          <span className="team-bar-val">{((p.avg_talk_ratio ?? 0) * 100).toFixed(0)}%</span>
                        </div>
                      </div>

                      {/* Trajectory trendline */}
                      {trendData.length >= 2 && (
                        <div className="roster-trajectory">
                          <h4 className="section-label small">10-Meeting Trajectory</h4>
                          <ResponsiveContainer width="100%" height={140}>
                            <LineChart data={trendData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                              <XAxis dataKey="idx" tick={{ fill: '#6b7280', fontSize: 10 }} label={{ value: 'Meeting #', position: 'bottom', fill: '#6b7280', fontSize: 10 }} />
                              <YAxis domain={[0, 100]} tick={{ fill: '#6b7280', fontSize: 10 }} />
                              <Tooltip contentStyle={{ background: '#141720', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                              <Line type="monotone" dataKey="engagement" stroke="#a78bfa" strokeWidth={2} dot={false} name="Engagement" />
                              <Line type="monotone" dataKey="sentiment" stroke="#4ade80" strokeWidth={1.5} dot={false} name="Sentiment" />
                              <Line type="monotone" dataKey="clarity" stroke="#fbbf24" strokeWidth={1.5} dot={false} name="Clarity" />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>

                    {/* Coaching vault */}
                    {p.meetings?.some((mt) => mt.coaching_text) && (
                      <div className="coaching-vault">
                        <h4 className="section-label small">Coaching Vault</h4>
                        <div className="vault-items">
                          {p.meetings.filter((mt) => mt.coaching_text).slice(-5).map((mt) => (
                            <div key={mt.meeting_id} className="vault-item">
                              <div className="vault-item-head">
                                <Link to={`/meeting/${mt.meeting_id}`} className="vault-meeting-link">{mt.meeting_title}</Link>
                                <span className="muted small">{new Date(mt.meeting_date).toLocaleDateString()}</span>
                              </div>
                              <p className="vault-text">{mt.coaching_text}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Meeting history */}
                    <h4 className="section-label small" style={{ marginTop: 12 }}>Meeting History</h4>
                    <div className="team-meeting-list">
                      {p.meetings.map((mt) => (
                        <Link to={`/meeting/${mt.meeting_id}`} key={mt.meeting_id} className="team-meeting-row">
                          <span>{mt.meeting_title}</span>
                          <span className="muted small">{new Date(mt.meeting_date).toLocaleDateString()}</span>
                          <span className="eff-badge small">{Math.round((mt.scores?.engagement ?? 0) * 100)}%</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

export default TeamPage;
