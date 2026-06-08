import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer,
} from 'recharts';
import toast from 'react-hot-toast';
import AppShell from './AppShell';
import { listProjects, createProject, getProjectDetail, listMeetings, assignMeetingProject } from '../api';

const DIMS = ['engagement', 'sentiment', 'collaboration', 'initiative', 'clarity'];

function initials(name) {
  return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function ProjectsPage() {
  const [projects, setProjects]       = useState([]);
  const [allMeetings, setAllMeetings] = useState([]);
  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor]             = useState('#a78bfa');
  const [detail, setDetail]           = useState(null);
  const [openId, setOpenId]           = useState(null);
  const [assignMeetingId, setAssignMeetingId] = useState('');
  const [showCreate, setShowCreate]   = useState(false);

  const loadList = () => {
    listProjects().then(setProjects).catch((e) => toast.error(e.message));
    listMeetings().then(setAllMeetings).catch(() => {});
  };

  useEffect(() => { loadList(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await createProject({ name: name.trim(), description: description.trim(), color });
      setName('');
      setDescription('');
      setShowCreate(false);
      loadList();
      toast.success('Project created');
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    }
  };

  const openDetail = async (pid) => {
    if (openId === pid) { setOpenId(null); setDetail(null); return; }
    setOpenId(pid);
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
      toast.success('Meeting assigned');
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    }
  };

  const unassignedMeetings = allMeetings.filter(
    (m) => !m.project_id || (detail && m.project_id !== detail.project?.id)
  );

  return (
    <AppShell title="Projects" subtitle="Organise meetings by initiative and track performance">

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <p className="text-muted text-sm">{projects.length} project{projects.length !== 1 ? 's' : ''}</p>
        <button type="button" className="btn-primary" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? 'Close' : '+ New Project'}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="card mb-5">
          <h3 className="text-sm font-semibold text-white mb-4">Create project</h3>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1">
                <label className="text-xs text-muted uppercase tracking-wider">Name</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Product Launch 2026" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted uppercase tracking-wider">Color</label>
                <input type="color" className="input p-1 cursor-pointer" value={color} onChange={(e) => setColor(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted uppercase tracking-wider">Description (optional)</label>
              <textarea className="input resize-none" rows={2} value={description}
                onChange={(e) => setDescription(e.target.value)} placeholder="What this initiative covers…" />
            </div>
            <button type="submit" className="btn-primary">Create</button>
          </form>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-muted">No projects yet. Create one to group meetings by initiative.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map((p) => {
            const isOpen = openId === p.id;
            return (
              <div key={p.id} className="card">
                {/* Project header row */}
                <div
                  className="flex items-center gap-3 cursor-pointer select-none"
                  role="button"
                  tabIndex={0}
                  onClick={() => openDetail(p.id)}
                  onKeyDown={(e) => e.key === 'Enter' && openDetail(p.id)}
                >
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: p.color || '#a78bfa' }} />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-200 text-sm">{p.name}</div>
                    {p.description && <div className="text-xs text-muted truncate">{p.description}</div>}
                  </div>
                  <span className="text-xs text-muted">{p.meeting_count} meeting{p.meeting_count !== 1 ? 's' : ''}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                    className={`text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>

                {/* Expanded detail */}
                {isOpen && detail && detail.project?.id === p.id && (
                  <div className="mt-4 pt-4 border-t border-white/[0.06] space-y-4">
                    {/* Stats row */}
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        ['Avg Efficiency', detail.avg_efficiency != null ? `${Math.round(detail.avg_efficiency * 100)}%` : '—'],
                        ['Meetings', detail.meetings.length],
                        ['Participants', detail.participants.length],
                      ].map(([label, val]) => (
                        <div key={label} className="stat-card">
                          <div className="stat-val text-xl">{val}</div>
                          <div className="stat-label">{label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Assign meeting */}
                    <div className="flex gap-2">
                      <select className="select flex-1 text-sm" value={assignMeetingId}
                        onChange={(e) => setAssignMeetingId(e.target.value)}>
                        <option value="">Assign a meeting…</option>
                        {unassignedMeetings.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                      </select>
                      <button type="button" className="btn-primary text-sm"
                        onClick={() => handleAssign(p.id)} disabled={!assignMeetingId}>
                        Assign
                      </button>
                    </div>

                    {/* Meeting list */}
                    {detail.meetings.length > 0 && (
                      <div>
                        <div className="text-xs text-muted uppercase tracking-wider mb-2">Meetings</div>
                        <div className="divide-y divide-white/[0.05]">
                          {detail.meetings.map((m) => (
                            <Link key={m.id} to={`/meeting/${m.id}`}
                              className="flex items-center gap-3 py-2 hover:bg-white/[0.02] -mx-1 px-1 rounded transition-colors">
                              <span className="text-xs text-muted flex-shrink-0">
                                {new Date(m.scheduled_at || m.created_at).toLocaleDateString()}
                              </span>
                              <span className="text-sm text-slate-200 flex-1 truncate">{m.title}</span>
                              <span className="text-xs text-accent flex-shrink-0">
                                {m.efficiency_score != null ? `${Math.round(m.efficiency_score * 100)}%` : '—'}
                              </span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Participant performance */}
                    {detail.participants.length > 0 && (
                      <div>
                        <div className="text-xs text-muted uppercase tracking-wider mb-3">Participant Performance</div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          {detail.participants.map((pp) => {
                            const radar = DIMS.map((d) => ({
                              dim: d.charAt(0).toUpperCase() + d.slice(1),
                              v: pp[`avg_${d}`] ?? 0,
                            }));
                            return (
                              <div key={pp.name} className="bg-white/[0.03] rounded-xl p-3">
                                <div className="flex items-center gap-2 mb-2">
                                  <div className="w-6 h-6 rounded-full bg-accent-dim flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                                    {initials(pp.name)}
                                  </div>
                                  <div>
                                    <div className="text-xs font-semibold text-slate-200 truncate">{pp.name}</div>
                                    <div className="text-xs text-muted">{pp.meeting_count} meetings</div>
                                  </div>
                                </div>
                                <ResponsiveContainer width="100%" height={120}>
                                  <RadarChart data={radar}>
                                    <PolarGrid stroke="rgba(255,255,255,0.08)" />
                                    <PolarAngleAxis dataKey="dim" tick={{ fill: '#8b95a8', fontSize: 7 }} />
                                    <PolarRadiusAxis domain={[0, 1]} tick={false} axisLine={false} />
                                    <Radar dataKey="v" stroke="#a78bfa" fill="#7c3aed" fillOpacity={0.3} />
                                  </RadarChart>
                                </ResponsiveContainer>
                              </div>
                            );
                          })}
                        </div>
                      </div>
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
