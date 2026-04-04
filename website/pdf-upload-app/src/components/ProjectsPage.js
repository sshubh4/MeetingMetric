import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer,
} from 'recharts';
import AppShell from './AppShell';
import { listProjects, createProject, getProjectDetail, listMeetings, assignMeetingProject } from '../api';

function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [allMeetings, setAllMeetings] = useState([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#a78bfa');
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [assignMeetingId, setAssignMeetingId] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const loadList = () => {
    listProjects().then(setProjects).catch((e) => setError(e.message));
    listMeetings().then(setAllMeetings).catch(() => {});
  };

  useEffect(() => { loadList(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError('');
    try {
      await createProject({ name: name.trim(), description: description.trim(), color });
      setName('');
      setDescription('');
      setShowCreate(false);
      loadList();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  };

  const openDetail = async (pid) => {
    if (detail?.project?.id === pid) { setDetail(null); return; }
    try {
      const d = await getProjectDetail(pid);
      setDetail(d);
    } catch { setDetail(null); }
  };

  const handleAssign = async (pid) => {
    if (!assignMeetingId) return;
    try {
      await assignMeetingProject(Number(assignMeetingId), pid);
      setAssignMeetingId('');
      loadList();
      const d = await getProjectDetail(pid);
      setDetail(d);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  };

  const unassignedMeetings = allMeetings.filter(
    (m) => !m.project_id || (detail && m.project_id !== detail.project?.id)
  );

  const dims = ['engagement', 'sentiment', 'collaboration', 'initiative', 'clarity'];

  return (
    <AppShell title="Projects" subtitle="Organize meetings by initiative and track performance">
      <div className="meetings-toolbar">
        <span className="muted">{projects.length} project{projects.length !== 1 ? 's' : ''}</span>
        <button type="button" className="btn-primary" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? 'Close' : '+ New Project'}
        </button>
      </div>

      {showCreate && (
        <div className="exec-card upload-card">
          <h2 className="exec-card-title">Create project</h2>
          <form onSubmit={submit} className="upload-form">
            <div className="upload-row-2">
              <label>
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Product Launch 2026" />
              </label>
              <label>
                Color
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ height: 38, padding: 2 }} />
              </label>
            </div>
            <label>
              Description (optional)
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What this initiative covers…" />
            </label>
            {error && <p className="error">{error}</p>}
            <button type="submit" className="btn-primary">Create</button>
          </form>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="exec-card"><p className="muted">No projects yet. Create one to group meetings by initiative.</p></div>
      ) : (
        <div className="projects-list">
          {projects.map((p) => {
            const isOpen = detail?.project?.id === p.id;
            return (
              <div key={p.id} className={`exec-card project-card ${isOpen ? 'expanded' : ''}`}>
                <div className="project-card-head" onClick={() => openDetail(p.id)} role="button" tabIndex={0}>
                  <span className="project-dot" style={{ background: p.color || '#a78bfa' }} />
                  <div className="project-card-info">
                    <strong>{p.name}</strong>
                    {p.description && <span className="muted small">{p.description}</span>}
                  </div>
                  <div className="project-card-meta">
                    <span className="eff-badge">{p.meeting_count}</span>
                    <span className="muted small">meeting{p.meeting_count !== 1 ? 's' : ''}</span>
                  </div>
                  <span className={`expand-arrow ${isOpen ? 'open' : ''}`}>▾</span>
                </div>

                {isOpen && detail && (
                  <div className="project-detail">
                    <div className="project-detail-head">
                      <div className="project-stat-mini">
                        <span className="muted small">Avg Efficiency</span>
                        <strong>{detail.avg_efficiency != null ? `${Math.round(detail.avg_efficiency * 100)}%` : '—'}</strong>
                      </div>
                      <div className="project-stat-mini">
                        <span className="muted small">Meetings</span>
                        <strong>{detail.meetings.length}</strong>
                      </div>
                      <div className="project-stat-mini">
                        <span className="muted small">Participants</span>
                        <strong>{detail.participants.length}</strong>
                      </div>
                    </div>

                    <div className="project-assign-row">
                      <select value={assignMeetingId} onChange={(e) => setAssignMeetingId(e.target.value)}>
                        <option value="">Assign a meeting…</option>
                        {unassignedMeetings.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                      </select>
                      <button type="button" className="btn-primary small" onClick={() => handleAssign(p.id)} disabled={!assignMeetingId}>
                        Assign
                      </button>
                    </div>

                    {detail.meetings.length > 0 && (
                      <>
                        <h4 className="muted small" style={{ marginTop: 12 }}>Meetings</h4>
                        <div className="team-meeting-list">
                          {detail.meetings.map((m) => (
                            <Link to={`/meeting/${m.id}`} key={m.id} className="team-meeting-row">
                              <span>{m.title}</span>
                              <span className="muted small">
                                {m.scheduled_at ? new Date(m.scheduled_at).toLocaleDateString() : new Date(m.created_at).toLocaleDateString()}
                              </span>
                              <span className="eff-badge small">
                                {m.efficiency_score != null ? `${Math.round(m.efficiency_score * 100)}%` : '—'}
                              </span>
                            </Link>
                          ))}
                        </div>
                      </>
                    )}

                    {detail.participants.length > 0 && (
                      <>
                        <h4 className="muted small" style={{ marginTop: 16 }}>Participants performance</h4>
                        <div className="project-participants">
                          {detail.participants.map((pp) => {
                            const radar = dims.map((d) => ({ dim: d.charAt(0).toUpperCase() + d.slice(1), v: pp[`avg_${d}`] ?? 0 }));
                            return (
                              <div key={pp.name} className="project-participant-card">
                                <div className="participant-head">
                                  <div className="avatar">{pp.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</div>
                                  <div>
                                    <strong>{pp.name}</strong>
                                    <span className="muted small">{pp.meeting_count} meeting{pp.meeting_count !== 1 ? 's' : ''}</span>
                                  </div>
                                </div>
                                <div className="radar-wrap small-radar">
                                  <ResponsiveContainer width="100%" height={150}>
                                    <RadarChart data={radar}>
                                      <PolarGrid stroke="#2a2f3a" />
                                      <PolarAngleAxis dataKey="dim" tick={{ fill: '#8b95a8', fontSize: 8 }} />
                                      <PolarRadiusAxis domain={[0, 1]} tick={false} axisLine={false} />
                                      <Radar dataKey="v" stroke="#a78bfa" fill="#7c3aed" fillOpacity={0.3} />
                                    </RadarChart>
                                  </ResponsiveContainer>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
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

export default ProjectsPage;
