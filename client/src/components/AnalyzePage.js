import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from './AppShell';
import { analyzeMeeting, listProjects } from '../api';

function AnalyzePage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [projectId, setProjectId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [projects, setProjects] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    listProjects().then(setProjects).catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim() && !file) {
      setError('Paste a transcript or choose a file to continue');
      return;
    }
    setError('');
    setUploading(true);
    try {
      const data = await analyzeMeeting({
        title: title.trim() || 'Untitled meeting',
        text,
        file,
        projectId: projectId || undefined,
        scheduledAt: scheduledAt || undefined,
      });
      navigate(`/meeting/${data.meetingId}`);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Analysis failed');
      setUploading(false);
    }
  };

  return (
    <AppShell title="Analyze" subtitle="Upload a transcript and get AI-powered meeting intelligence">
      <div className="analyze-page">
        <form onSubmit={handleSubmit}>

          {/* ── Meeting metadata ── */}
          <div className="exec-card" style={{ marginBottom: '0.75rem' }}>
            <h2 className="exec-card-title">Meeting details</h2>
            <div className="upload-row-2">
              <label>
                Title
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Q3 Strategy Sync"
                />
              </label>
              <label>
                Project
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">No project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <label style={{ marginBottom: 0 }}>
              Meeting date &amp; time <span className="muted small">(optional — used in calendar view)</span>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </label>
          </div>

          {/* ── Transcript + file upload ── */}
          <div className="analyze-two-col">
            {/* Transcript paste */}
            <div className="exec-card">
              <h2 className="exec-card-title">Transcript</h2>
              <p className="muted small" style={{ marginTop: 0, marginBottom: '0.75rem' }}>
                Paste in <code>Speaker: text</code> format — one speaker turn per line.
                Timestamps are stripped automatically.
              </p>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={14}
                placeholder={
                  'Alice: Good morning everyone, let\'s get started.\n' +
                  'Bob: Sounds good. I\'ll walk through the Q3 blockers.\n' +
                  'Alice: Please do. What\'s the biggest risk?\n' +
                  'Bob: The API rate limit — we should raise it before launch.\n' +
                  'Alice: Agreed. I\'ll own that action item by Friday.'
                }
              />
            </div>

            {/* File upload + feature preview */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div className="exec-card">
                <h2 className="exec-card-title">Or upload a file</h2>
                <p className="muted small" style={{ marginTop: 0, marginBottom: '0.75rem' }}>
                  <code>.txt</code> or <code>.pdf</code>, up to 8 MB.
                  Content is appended to any pasted text.
                </p>
                <div
                  className={`upload-drop ${drag ? 'drag-active' : ''}`}
                  style={{ minHeight: 140 }}
                  onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDrag(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) setFile(f);
                  }}
                >
                  <div className="drop-icon">📄</div>
                  <p>{file ? file.name : 'Drag & drop here'}</p>
                  <label className="file-pick">
                    <input
                      type="file"
                      accept=".txt,.pdf,text/plain,application/pdf"
                      onChange={(e) => setFile(e.target.files[0] || null)}
                    />
                    {file ? 'Change file' : 'Browse files'}
                  </label>
                  {file && (
                    <button
                      type="button"
                      className="btn-ghost small"
                      style={{ marginTop: '0.5rem' }}
                      onClick={() => setFile(null)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              {/* What you'll get */}
              <div className="exec-card">
                <h3 className="section-label small" style={{ margin: '0 0 0.65rem' }}>What you'll get</h3>
                <div className="analyze-features-mini">
                  {[
                    ['⚡', '5-dimension scores', 'Engagement, sentiment, collaboration, initiative, clarity per speaker'],
                    ['🎯', 'Coaching insights', 'Personalized, actionable feedback per participant'],
                    ['📊', 'Efficiency index', 'Meeting-level productivity score 0–100'],
                    ['🔍', 'Search index', 'Chunks embedded for semantic search'],
                  ].map(([icon, head, desc]) => (
                    <div key={head} className="analyze-feature-mini">
                      <span className="analyze-feature-icon">{icon}</span>
                      <div>
                        <strong style={{ fontSize: '0.85rem' }}>{head}</strong>
                        <p className="muted small" style={{ margin: '0.1rem 0 0' }}>{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {error && <p className="error" style={{ marginBottom: '0.75rem' }}>{error}</p>}

          <button
            type="submit"
            className="btn-primary"
            disabled={uploading}
            style={{ maxWidth: 260 }}
          >
            {uploading ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <svg
                  width="15" height="15" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2.5"
                  style={{ animation: 'spin 0.8s linear infinite', flexShrink: 0 }}
                >
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                </svg>
                Analyzing…
              </span>
            ) : 'Run Analysis →'}
          </button>
        </form>
      </div>
    </AppShell>
  );
}

export default AnalyzePage;
