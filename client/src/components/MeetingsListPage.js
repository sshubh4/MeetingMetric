import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import AppShell from './AppShell';
import { listMeetings, listProjects, analyzeMeeting } from '../api';

const SOURCE_BADGES = {
  manual:       { label: 'Manual',       cls: 'bg-white/10 text-slate-400' },
  teams_auto:   { label: 'Teams Auto',   cls: 'bg-blue-500/20 text-blue-300' },
  teams_import: { label: 'Teams Import', cls: 'bg-indigo-500/20 text-indigo-300' },
  bot:          { label: 'Bot',          cls: 'bg-yellow-500/20 text-yellow-300' },
};

function SourceBadge({ source }) {
  const s = SOURCE_BADGES[source] || SOURCE_BADGES.manual;
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

// Row animation variants
const tableVariants = {
  animate: { transition: { staggerChildren: 0.055, delayChildren: 0.05 } },
};
const rowVariants = {
  initial: { opacity: 0, x: -16, backgroundColor: 'rgba(167,139,250,0)' },
  animate: { opacity: 1, x: 0, transition: { duration: 0.38, ease: 'easeOut' } },
};

function MeetingsListPage() {
  const [rows, setRows]             = useState([]);
  const [projects, setProjects]     = useState([]);
  const [error, setError]           = useState('');
  const [dateFrom, setDateFrom]     = useState('');
  const [dateTo, setDateTo]         = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [sortBy, setSortBy]         = useState('date');
  const [sortDir, setSortDir]       = useState('desc');
  const [drawer, setDrawer]         = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [drag, setDrag]             = useState(false);

  const [uTitle, setUTitle]         = useState('');
  const [uText, setUText]           = useState('');
  const [uFile, setUFile]           = useState(null);
  const [uProjectId, setUProjectId] = useState('');
  const [uScheduled, setUScheduled] = useState('');
  const [uploading, setUploading]   = useState(false);
  const navigate = useNavigate();

  const load = useCallback(() => {
    listMeetings().then(setRows).catch((e) => setError(e.message));
    listProjects().then(setProjects).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!uText.trim() && !uFile) { toast.error('Paste a transcript or choose a file'); return; }
    setUploading(true);
    try {
      const data = await analyzeMeeting({
        title: uTitle || 'Untitled meeting', text: uText, file: uFile,
        projectId: uProjectId || undefined, scheduledAt: uScheduled || undefined,
      });
      navigate(`/meeting/${data.meetingId}`);
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Upload failed');
      setUploading(false);
    }
  };

  const filtered = useMemo(() => {
    let list = rows.filter((r) => {
      const ds = (r.scheduled_at || r.created_at || '').slice(0, 10);
      if (dateFrom && ds < dateFrom) return false;
      if (dateTo   && ds > dateTo)   return false;
      if (projectFilter && String(r.project_id) !== String(projectFilter)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      let av, bv;
      if (sortBy === 'title') {
        av = (a.title || '').toLowerCase();
        bv = (b.title || '').toLowerCase();
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      if (sortBy === 'eff') {
        av = a.efficiency_score ?? -1;
        bv = b.efficiency_score ?? -1;
      } else {
        av = new Date(a.scheduled_at || a.created_at).getTime();
        bv = new Date(b.scheduled_at || b.created_at).getTime();
      }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return list;
  }, [rows, dateFrom, dateTo, projectFilter, sortBy, sortDir]);

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(col); setSortDir('desc'); }
  };

  const fmtDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const drawerData = drawer ? rows.find((r) => r.id === drawer) : null;

  const SortIcon = ({ col }) => {
    if (sortBy !== col) return <span className="ml-1 text-white/20">↕</span>;
    return <span className="ml-1 text-accent">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <AppShell title="Meetings" subtitle="All meeting analyses in your workspace">

      {/* Toolbar */}
      <motion.div
        className="flex flex-wrap items-center gap-3 mb-5"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
          className="input w-auto text-sm" title="From" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
          className="input w-auto text-sm" title="To" />
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
        <div className="ml-auto">
          <button type="button" className="btn-primary"
            onClick={() => setShowUpload(!showUpload)}>
            {showUpload ? '✕ Close' : '+ New Meeting'}
          </button>
        </div>
      </motion.div>

      {/* Upload form */}
      <AnimatePresence>
        {showUpload && (
          <motion.div
            className="card mb-5"
            initial={{ opacity: 0, y: -12, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <h3 className="text-sm font-semibold text-white mb-4">Quick upload</h3>
            <form onSubmit={handleUpload}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                <input type="text" className="input" placeholder="Meeting title" value={uTitle}
                  onChange={(e) => setUTitle(e.target.value)} />
                <select className="select" value={uProjectId} onChange={(e) => setUProjectId(e.target.value)}>
                  <option value="">No project</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input type="datetime-local" className="input" value={uScheduled}
                  onChange={(e) => setUScheduled(e.target.value)} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <textarea className="input font-mono text-xs resize-none" rows={5}
                  placeholder={"Alice: Let's get started.\nBob: Sure, I'll cover blockers."}
                  value={uText} onChange={(e) => setUText(e.target.value)} />
                <div
                  className={`border-2 border-dashed rounded-xl flex flex-col items-center justify-center p-4 transition-colors text-center ${drag ? 'border-accent bg-accent/5' : 'border-white/10 hover:border-white/20'}`}
                  onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => { e.preventDefault(); setDrag(false); setUFile(e.dataTransfer.files?.[0] || null); }}
                >
                  <div className="text-2xl mb-1">📄</div>
                  <p className="text-xs text-muted mb-2">{uFile ? uFile.name : 'Drag & drop .txt or .pdf'}</p>
                  <label className="btn-ghost text-xs cursor-pointer">
                    <input type="file" accept=".txt,.pdf,text/plain,application/pdf" className="hidden"
                      onChange={(e) => setUFile(e.target.files[0] || null)} />
                    Browse
                  </label>
                  {uFile && (
                    <button type="button" className="text-xs text-muted hover:text-danger mt-1"
                      onClick={() => setUFile(null)}>Remove</button>
                  )}
                </div>
              </div>
              <button type="submit" className="btn-primary" disabled={uploading}>
                {uploading ? 'Analyzing…' : 'Analyze →'}
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {error && <p className="text-danger text-sm mb-4">{error}</p>}

      {/* Table */}
      {filtered.length === 0 ? (
        <motion.div
          className="card text-center py-12"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          <p className="text-muted">
            No meetings found.{' '}
            <Link to="/analyze" className="text-accent hover:underline">Analyze one →</Link>
          </p>
        </motion.div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th className="cursor-pointer select-none" onClick={() => toggleSort('date')}>
                  Date <SortIcon col="date" />
                </th>
                <th className="cursor-pointer select-none" onClick={() => toggleSort('title')}>
                  Meeting <SortIcon col="title" />
                </th>
                <th>Source</th>
                <th>Project</th>
                <th className="cursor-pointer select-none text-right" onClick={() => toggleSort('eff')}>
                  Score <SortIcon col="eff" />
                </th>
                <th />
              </tr>
            </thead>
            <motion.tbody variants={tableVariants} initial="initial" animate="animate">
              {filtered.map((r) => (
                <motion.tr
                  key={r.id}
                  variants={rowVariants}
                  className={`cursor-pointer transition-colors ${drawer === r.id ? 'bg-accent/5' : 'hover:bg-white/[0.03]'}`}
                  onClick={() => setDrawer(drawer === r.id ? null : r.id)}
                  whileHover={{ backgroundColor: 'rgba(167,139,250,0.04)' }}
                  style={{ display: 'table-row' }}
                >
                  <td className="text-muted text-xs whitespace-nowrap">
                    {fmtDate(r.scheduled_at || r.created_at)}
                  </td>
                  <td>
                    <span className="font-medium text-slate-200 text-sm">{r.title}</span>
                    {r.dominant_speaker_alert && (
                      <span className="ml-2 text-warning text-xs">⚠ Dominance</span>
                    )}
                  </td>
                  <td><SourceBadge source={r.source} /></td>
                  <td>
                    {r.project_name
                      ? <span className="badge" style={{ background: (r.project_color || '#a78bfa') + '25', color: r.project_color || '#a78bfa' }}>{r.project_name}</span>
                      : <span className="text-muted text-xs">—</span>
                    }
                  </td>
                  <td className="text-right">
                    <span className="text-accent font-semibold text-sm">
                      {r.efficiency_score != null ? `${Math.round(r.efficiency_score * 100)}%` : '—'}
                    </span>
                  </td>
                  <td>
                    <Link
                      to={`/meeting/${r.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-accent hover:text-accent/70 whitespace-nowrap"
                    >
                      Open →
                    </Link>
                  </td>
                </motion.tr>
              ))}
            </motion.tbody>
          </table>
          <div className="pt-3 border-t border-white/[0.05] text-xs text-muted">
            {filtered.length} meeting{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {/* Slide-out drawer */}
      <AnimatePresence>
        {drawerData && (
          <motion.div
            className="fixed inset-0 z-40 flex"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setDrawer(null)}
          >
            <div className="flex-1" />
            <motion.div
              className="w-80 bg-surface border-l border-white/[0.06] h-full overflow-y-auto p-6 shadow-2xl"
              initial={{ x: 80, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 80, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-4">
                <h3 className="font-semibold text-white text-sm leading-snug pr-2">{drawerData.title}</h3>
                <button type="button" onClick={() => setDrawer(null)} className="text-muted hover:text-white flex-shrink-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>

              <div className="flex items-center gap-2 mb-5 flex-wrap">
                <SourceBadge source={drawerData.source} />
                {drawerData.project_name && (
                  <span className="badge" style={{ background: (drawerData.project_color || '#a78bfa') + '25', color: drawerData.project_color || '#a78bfa' }}>
                    {drawerData.project_name}
                  </span>
                )}
              </div>

              <div className="space-y-3 mb-5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Efficiency</span>
                  <span className="font-semibold text-accent">
                    {drawerData.efficiency_score != null ? `${Math.round(drawerData.efficiency_score * 100)}%` : '—'}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Date</span>
                  <span className="text-slate-300 text-xs">{fmtDate(drawerData.scheduled_at || drawerData.created_at)}</span>
                </div>
                {drawerData.dominant_speaker_alert && (
                  <div className="badge bg-warning/20 text-warning border border-warning/20 w-full justify-center">Dominance alert</div>
                )}
                {drawerData.low_engagement_alert && (
                  <div className="badge bg-danger/20 text-danger border border-danger/20 w-full justify-center">Low engagement</div>
                )}
              </div>

              {drawerData.summary && (
                <div className="mb-5">
                  <div className="text-xs text-muted uppercase tracking-wider mb-2">Summary</div>
                  <p className="text-sm text-slate-300 leading-relaxed">{drawerData.summary}</p>
                </div>
              )}

              <Link to={`/meeting/${drawerData.id}`} className="btn-primary w-full text-center block">
                Open full analysis →
              </Link>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AppShell>
  );
}

export default MeetingsListPage;
