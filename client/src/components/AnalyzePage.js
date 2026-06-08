import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import AppShell from './AppShell';
import { analyzeMeeting, listProjects, getTeamsStatus, getPollStatus, triggerPollNow } from '../api';

function AnalyzePage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [projectId, setProjectId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [projects, setProjects] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [teamsStatus, setTeamsStatus] = useState(null);
  const [pollStatus, setPollStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    listProjects().then(setProjects).catch(() => {});
    getTeamsStatus().then((s) => {
      setTeamsStatus(s);
      if (s.connected) getPollStatus().then(setPollStatus).catch(() => {});
    }).catch(() => {});
  }, []);

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await triggerPollNow();
      toast.success('Sync started — check back in a moment');
    } catch {
      toast.error('Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim() && !file) {
      toast.error('Paste a transcript or choose a file to continue');
      return;
    }
    setUploading(true);
    try {
      const data = await analyzeMeeting({
        title: title.trim() || 'Untitled meeting',
        text, file,
        projectId: projectId || undefined,
        scheduledAt: scheduledAt || undefined,
      });
      navigate(`/meeting/${data.meetingId}`);
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Analysis failed');
      setUploading(false);
    }
  };

  const fmtRelative = (iso) => {
    if (!iso) return 'never';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  };

  return (
    <AppShell title="Analyze" subtitle="Upload a transcript and get AI-powered meeting intelligence">

      {/* Teams auto-ingestion status card */}
      {teamsStatus?.connected && (
        <div className="card mb-5 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-positive" />
            <span className="text-sm font-medium text-white">Teams Auto-Ingestion Active</span>
          </div>
          <div className="text-xs text-muted">
            Last synced: {fmtRelative(pollStatus?.lastPolledAt)}
            {pollStatus?.connectedUsersInOrg > 0 && (
              <span className="ml-2">· {pollStatus.connectedUsersInOrg} connected in org</span>
            )}
          </div>
          <button
            type="button"
            className="btn-ghost ml-auto text-xs"
            onClick={handleSyncNow}
            disabled={syncing}
          >
            {syncing ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Meeting metadata */}
        <div className="card mb-5">
          <h2 className="text-sm font-semibold text-white mb-4">Meeting details</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1 md:col-span-1">
              <label className="text-xs text-muted uppercase tracking-wider">Title</label>
              <input
                type="text"
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Q3 Strategy Sync"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted uppercase tracking-wider">Project</label>
              <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">No project</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted uppercase tracking-wider">Meeting date & time <span className="normal-case font-normal">(optional)</span></label>
              <input
                type="datetime-local"
                className="input"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Transcript + file upload */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
          <div className="card">
            <h2 className="text-sm font-semibold text-white mb-3">Transcript</h2>
            <p className="text-xs text-muted mb-3">
              Paste in <code className="bg-white/5 px-1 rounded">Speaker: text</code> format — one speaker turn per line.
            </p>
            <textarea
              className="input resize-none font-mono text-xs"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={14}
              placeholder={"Alice: Good morning everyone, let's get started.\nBob: Sounds good. I'll walk through the Q3 blockers.\nAlice: Please do. What's the biggest risk?\nBob: The API rate limit — we should raise it before launch."}
            />
          </div>

          <div className="flex flex-col gap-5">
            <div className="card flex-1">
              <h2 className="text-sm font-semibold text-white mb-3">Or upload a file</h2>
              <p className="text-xs text-muted mb-3"><code className="bg-white/5 px-1 rounded">.txt</code> or <code className="bg-white/5 px-1 rounded">.pdf</code>, up to 8 MB.</p>
              <div
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${drag ? 'border-accent bg-accent/5' : 'border-white/10 hover:border-white/20'}`}
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}
              >
                <div className="text-3xl mb-2">📄</div>
                <p className="text-sm text-muted mb-3">{file ? file.name : 'Drag & drop here'}</p>
                <label className="btn-ghost cursor-pointer">
                  <input type="file" accept=".txt,.pdf,text/plain,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files[0] || null)} />
                  {file ? 'Change file' : 'Browse files'}
                </label>
                {file && (
                  <button type="button" className="block mt-2 text-xs text-muted hover:text-danger transition-colors mx-auto" onClick={() => setFile(null)}>
                    Remove
                  </button>
                )}
              </div>
            </div>

            <div className="card">
              <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">What you'll get</h3>
              <div className="space-y-2">
                {[['⚡', '5-dimension scores', 'Engagement, sentiment, collaboration, initiative, clarity per speaker'],
                  ['🎯', 'Coaching insights', 'Personalized, actionable feedback per participant'],
                  ['📊', 'Efficiency index', 'Meeting-level productivity score 0–100'],
                  ['🔍', 'Search index', 'Chunks embedded for semantic search']].map(([icon, head, desc]) => (
                  <div key={head} className="flex items-start gap-3">
                    <span className="text-base">{icon}</span>
                    <div>
                      <div className="text-xs font-semibold text-slate-200">{head}</div>
                      <div className="text-xs text-muted">{desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <button type="submit" className="btn-primary px-8 py-3 text-base" disabled={uploading}>
          {uploading ? (
            <span className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 0.8s linear infinite' }}>
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
              </svg>
              Analyzing…
            </span>
          ) : 'Run Analysis →'}
        </button>
      </form>
    </AppShell>
  );
}

export default AnalyzePage;
