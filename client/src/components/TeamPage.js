import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import AppShell from './AppShell';
import { getTeamParticipants, listProjects } from '../api';

const DIMS = [
  { key: 'avg_engagement',    label: 'Engagement' },
  { key: 'avg_sentiment',     label: 'Sentiment' },
  { key: 'avg_collaboration', label: 'Collaboration' },
  { key: 'avg_initiative',    label: 'Initiative' },
  { key: 'avg_clarity',       label: 'Clarity' },
];

function initials(name) {
  return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

const tableVariants = {
  animate: { transition: { staggerChildren: 0.065, delayChildren: 0.08 } },
};
const rowVariants = {
  initial: { opacity: 0, x: -14 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.4, ease: 'easeOut' } },
};

const avatarColors = [
  '#a78bfa', '#55e7fc', '#4ade80', '#fbbf24', '#f472b6',
  '#38bdf8', '#fb923c', '#c084fc',
];

function TeamPage() {
  const [participants, setParticipants] = useState([]);
  const [projects, setProjects]         = useState([]);
  const [loading, setLoading]           = useState(true);
  const [dateFrom, setDateFrom]         = useState('');
  const [dateTo, setDateTo]             = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [panelName, setPanelName]       = useState(null);

  useEffect(() => { listProjects().then(setProjects).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    const params = {};
    if (dateFrom)      params.from       = dateFrom;
    if (dateTo)        params.to         = dateTo;
    if (projectFilter) params.project_id = projectFilter;
    getTeamParticipants(params)
      .then(setParticipants)
      .catch(() => setParticipants([]))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, projectFilter]);

  const panelData = panelName ? participants.find((p) => p.name === panelName) : null;

  return (
    <AppShell title="Team" subtitle="Roster and performance trajectories">

      {/* Filters */}
      <motion.div
        className="flex flex-wrap items-center gap-3 mb-5"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <input type="date" className="input w-auto text-sm" value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)} title="From" />
        <input type="date" className="input w-auto text-sm" value={dateTo}
          onChange={(e) => setDateTo(e.target.value)} title="To" />
        <select className="select w-auto text-sm" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {(dateFrom || dateTo || projectFilter) && (
          <button type="button" className="btn-ghost text-sm"
            onClick={() => { setDateFrom(''); setDateTo(''); setProjectFilter(''); }}>
            Clear
          </button>
        )}
      </motion.div>

      {loading ? (
        <p className="text-muted">Loading team data…</p>
      ) : participants.length === 0 ? (
        <motion.div
          className="card text-center py-12"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          <p className="text-muted">No participants yet. Upload meetings to see your team.</p>
        </motion.div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Participant</th>
                <th>Meetings</th>
                <th>Engagement</th>
                <th>Talk ratio</th>
                <th>Projects</th>
                <th />
              </tr>
            </thead>
            <motion.tbody variants={tableVariants} initial="initial" animate="animate">
              {participants.map((p, idx) => {
                const color = avatarColors[idx % avatarColors.length];
                return (
                  <motion.tr
                    key={p.name}
                    variants={rowVariants}
                    className={`cursor-pointer transition-colors ${panelName === p.name ? 'bg-accent/5' : 'hover:bg-white/[0.03]'}`}
                    onClick={() => setPanelName(panelName === p.name ? null : p.name)}
                    whileHover={{ backgroundColor: 'rgba(167,139,250,0.04)' }}
                    style={{ display: 'table-row' }}
                  >
                    <td>
                      <div className="flex items-center gap-2">
                        <motion.div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                          style={{ background: color + '40', border: `1px solid ${color}50` }}
                          whileHover={{ scale: 1.15 }}
                          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                        >
                          {initials(p.name)}
                        </motion.div>
                        <span className="font-medium text-slate-200 text-sm">{p.name}</span>
                      </div>
                    </td>
                    <td className="text-muted">{p.meeting_count}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="dim-bar w-16">
                          <motion.div
                            className="dim-bar-fill"
                            initial={{ width: 0 }}
                            animate={{ width: `${(p.avg_engagement ?? 0) * 100}%` }}
                            transition={{ duration: 0.8, delay: idx * 0.05, ease: 'easeOut' }}
                            style={{ background: color }}
                          />
                        </div>
                        <span className="text-xs font-medium" style={{ color }}>
                          {Math.round((p.avg_engagement ?? 0) * 100)}%
                        </span>
                      </div>
                    </td>
                    <td className="text-muted text-sm">{Math.round((p.avg_talk_ratio ?? 0) * 100)}%</td>
                    <td className="text-muted text-xs">{p.projects?.join(', ') || '—'}</td>
                    <td>
                      <span className="text-xs text-accent">
                        {panelName === p.name ? 'Close ↑' : 'Expand →'}
                      </span>
                    </td>
                  </motion.tr>
                );
              })}
            </motion.tbody>
          </table>
        </div>
      )}

      {/* Slide-out panel */}
      <AnimatePresence>
        {panelData && (
          <motion.div
            className="fixed inset-0 z-40 flex"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setPanelName(null)}
          >
            <div className="flex-1" />
            <motion.div
              className="w-96 bg-surface border-l border-white/[0.06] h-full overflow-y-auto shadow-2xl"
              initial={{ x: 100, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 100, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 280, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Panel header */}
              <div className="sticky top-0 bg-surface border-b border-white/[0.06] px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <motion.div
                    className="w-10 h-10 rounded-full bg-accent-dim flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 18, delay: 0.1 }}
                  >
                    {initials(panelData.name)}
                  </motion.div>
                  <div>
                    <div className="font-semibold text-white">{panelData.name}</div>
                    <div className="text-xs text-muted">{panelData.meeting_count} meetings</div>
                  </div>
                </div>
                <button type="button" onClick={() => setPanelName(null)} className="text-muted hover:text-white">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>

              <div className="px-5 py-4 space-y-6">
                {/* Radar */}
                <div>
                  <div className="text-xs text-muted uppercase tracking-wider mb-2">Communication Profile</div>
                  <ResponsiveContainer width="100%" height={200}>
                    <RadarChart data={DIMS.map((d) => ({ dim: d.label, v: panelData[d.key] ?? 0 }))}>
                      <PolarGrid stroke="rgba(255,255,255,0.08)" />
                      <PolarAngleAxis dataKey="dim" tick={{ fill: '#8b95a8', fontSize: 9 }} />
                      <PolarRadiusAxis domain={[0, 1]} tick={false} axisLine={false} />
                      <Radar dataKey="v" stroke="#a78bfa" fill="#7c3aed" fillOpacity={0.3} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>

                {/* Dimension bars */}
                <div>
                  <div className="text-xs text-muted uppercase tracking-wider mb-3">Dimensions</div>
                  <div className="space-y-2">
                    {[...DIMS, { key: 'avg_talk_ratio', label: 'Talk ratio' }].map((d, di) => (
                      <div key={d.key} className="flex items-center gap-2">
                        <span className="text-xs text-muted w-24 flex-shrink-0">{d.label}</span>
                        <div className="dim-bar flex-1">
                          <motion.div
                            className="dim-bar-fill"
                            initial={{ width: 0 }}
                            animate={{ width: `${(panelData[d.key] ?? 0) * 100}%` }}
                            transition={{ duration: 0.7, delay: di * 0.06, ease: 'easeOut' }}
                          />
                        </div>
                        <span className="text-xs text-muted w-8 text-right">
                          {((panelData[d.key] ?? 0) * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Trajectory */}
                {(() => {
                  const trendData = (panelData.meetings || []).slice(-10).map((mt, i) => ({
                    idx: i + 1,
                    engagement: Math.round((mt.scores?.engagement ?? 0) * 100),
                    sentiment:  Math.round((mt.scores?.sentiment  ?? 0) * 100),
                    clarity:    Math.round((mt.scores?.clarity    ?? 0) * 100),
                  }));
                  if (trendData.length < 2) return null;
                  return (
                    <div>
                      <div className="text-xs text-muted uppercase tracking-wider mb-2">10-Meeting Trajectory</div>
                      <ResponsiveContainer width="100%" height={140}>
                        <LineChart data={trendData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis dataKey="idx" tick={{ fill: '#6b7280', fontSize: 9 }} />
                          <YAxis domain={[0, 100]} tick={{ fill: '#6b7280', fontSize: 9 }} />
                          <Tooltip contentStyle={{ background: '#16181d', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }} />
                          <Line type="monotone" dataKey="engagement" stroke="#a78bfa" strokeWidth={2} dot={false} name="Engagement" />
                          <Line type="monotone" dataKey="sentiment"  stroke="#4ade80" strokeWidth={1.5} dot={false} name="Sentiment" />
                          <Line type="monotone" dataKey="clarity"    stroke="#fbbf24" strokeWidth={1.5} dot={false} name="Clarity" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })()}

                {/* Coaching vault */}
                {panelData.meetings?.some((mt) => mt.coaching_text) && (
                  <div>
                    <div className="text-xs text-muted uppercase tracking-wider mb-3">Coaching Vault</div>
                    <div className="space-y-3">
                      {panelData.meetings.filter((mt) => mt.coaching_text).slice(-5).map((mt) => (
                        <div key={mt.meeting_id} className="bg-white/[0.03] rounded-lg p-3 border border-white/[0.05]">
                          <div className="flex items-center justify-between mb-1">
                            <Link to={`/meeting/${mt.meeting_id}`} className="text-xs font-medium text-accent hover:underline truncate">
                              {mt.meeting_title}
                            </Link>
                            <span className="text-xs text-muted ml-2 flex-shrink-0">
                              {new Date(mt.meeting_date).toLocaleDateString()}
                            </span>
                          </div>
                          <p className="text-xs text-muted leading-relaxed">{mt.coaching_text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Meeting history */}
                <div>
                  <div className="text-xs text-muted uppercase tracking-wider mb-3">Meeting History</div>
                  <motion.div
                    className="space-y-1"
                    variants={{ animate: { transition: { staggerChildren: 0.04 } } }}
                    initial="initial"
                    animate="animate"
                  >
                    {panelData.meetings?.map((mt) => (
                      <motion.div
                        key={mt.meeting_id}
                        variants={{ initial: { opacity: 0, x: -8 }, animate: { opacity: 1, x: 0, transition: { duration: 0.3 } } }}
                      >
                        <Link
                          to={`/meeting/${mt.meeting_id}`}
                          className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-lg hover:bg-white/5 transition-colors"
                        >
                          <span className="text-xs text-muted flex-shrink-0">
                            {new Date(mt.meeting_date).toLocaleDateString()}
                          </span>
                          <span className="text-sm text-slate-300 flex-1 truncate">{mt.meeting_title}</span>
                          <span className="text-xs text-accent flex-shrink-0">
                            {Math.round((mt.scores?.engagement ?? 0) * 100)}%
                          </span>
                        </Link>
                      </motion.div>
                    ))}
                  </motion.div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AppShell>
  );
}

export default TeamPage;
