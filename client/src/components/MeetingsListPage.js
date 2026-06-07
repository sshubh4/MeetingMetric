import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppShell from './AppShell';
import { listMeetings, listProjects, analyzeMeeting } from '../api';

function MeetingsListPage() {
  const [rows, setRows] = useState([]);
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [view, setView] = useState('list');
  const [drawer, setDrawer] = useState(null);

  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [projectId, setProjectId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [drag, setDrag] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(() => {
    listMeetings().then(setRows).catch((e) => setError(e.message));
    listProjects().then(setProjects).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!text.trim() && !file) { setUploadError('Paste a transcript or choose a file'); return; }
    setUploadError('');
    setUploading(true);
    try {
      const data = await analyzeMeeting({
        title: title || 'Untitled meeting', text, file,
        projectId: projectId || undefined,
        scheduledAt: scheduledAt || undefined,
      });
      navigate(`/meeting/${data.meetingId}`);
    } catch (err) {
      setUploadError(err.response?.data?.error || err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const filtered = rows.filter((r) => {
    const d = r.scheduled_at || r.created_at;
    const ds = d ? d.slice(0, 10) : '';
    if (dateFrom && ds < dateFrom) return false;
    if (dateTo && ds > dateTo) return false;
    return true;
  });

  const fmtDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const fmtTime = (iso) => {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const grouped = useMemo(() => {
    const m = {};
    filtered.forEach((r) => {
      const pn = r.project_name || 'Unassigned';
      if (!m[pn]) m[pn] = [];
      m[pn].push(r);
    });
    return m;
  }, [filtered]);

  const calData = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const mo = now.getMonth();
    const first = new Date(y, mo, 1);
    const days = new Date(y, mo + 1, 0).getDate();
    const startDay = first.getDay();
    const cells = [];
    for (let i = 0; i < startDay; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(d);
    const byDay = {};
    filtered.forEach((r) => {
      const ds = (r.scheduled_at || r.created_at || '').slice(0, 10);
      const dd = new Date(ds);
      if (dd.getMonth() === mo && dd.getFullYear() === y) {
        const day = dd.getDate();
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push(r);
      }
    });
    return { cells, byDay, month: first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
  }, [filtered]);

  const drawerData = drawer ? rows.find((r) => r.id === drawer) : null;

  return (
    <AppShell title="Intelligence Hub" subtitle="All meetings, transcripts, and analyses">
      <div className="hub-toolbar">
        <div className="date-filter">
          <label>From<input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
          <label>To<input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
          {(dateFrom || dateTo) && (
            <button type="button" className="btn-ghost small" onClick={() => { setDateFrom(''); setDateTo(''); }}>Clear</button>
          )}
        </div>
        <div className="hub-actions">
          <div className="view-toggles">
            {['list', 'calendar', 'project'].map((v) => (
              <button key={v} type="button" className={`view-btn ${view === v ? 'active' : ''}`} onClick={() => setView(v)}>
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <button type="button" className={`btn-primary compact ${showUpload ? 'active' : ''}`} onClick={() => setShowUpload(!showUpload)}>
            {showUpload ? '✕ Close' : '+ New Meeting'}
          </button>
        </div>
      </div>

      {/* Upload form */}
      {showUpload && (
        <div className="exec-card upload-card">
          <h3 className="exec-card-title">Upload transcript</h3>
          <p className="muted small">Paste or upload — analysis runs automatically.</p>
          <form onSubmit={handleUpload} className="upload-form">
            <div className="upload-grid">
              <div className="upload-fields">
                <label>Title<input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Q3 Strategy Sync" /></label>
                <div className="upload-row-2">
                  <label>
                    Project
                    <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                      <option value="">No project</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                  <label>Date<input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /></label>
                </div>
                <label>Transcript<textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder={'Alice: Good morning.\nBob: Let\'s begin.'} /></label>
              </div>
              <div
                className={`upload-drop ${drag ? 'drag-active' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); setFile(e.dataTransfer.files?.[0] || null); }}
              >
                <div className="drop-icon">📄</div>
                <p>Drag & drop file</p>
                <label className="file-pick">
                  <input type="file" accept=".txt,.pdf,text/plain,application/pdf" onChange={(e) => setFile(e.target.files[0] || null)} />
                  {file ? file.name : 'Browse files'}
                </label>
              </div>
            </div>
            {uploadError && <p className="error">{uploadError}</p>}
            <button type="submit" className="btn-primary compact" disabled={uploading}>{uploading ? 'Analyzing…' : 'Upload & Analyze'}</button>
          </form>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {/* LIST VIEW */}
      {view === 'list' && (
        filtered.length === 0 ? (
          <div className="exec-card"><p className="muted">No meetings found. Upload a transcript to get started.</p></div>
        ) : (
          <div className="smart-table">
            <div className="st-header">
              <span className="st-col-date">Date</span>
              <span className="st-col-title">Meeting</span>
              <span className="st-col-project">Project</span>
              <span className="st-col-eff">Score</span>
              <span className="st-col-act" />
            </div>
            {filtered.map((r) => {
              const dateStr = r.scheduled_at || r.created_at;
              return (
                <div
                  key={r.id}
                  className={`st-row ${drawer === r.id ? 'selected' : ''}`}
                  onClick={() => setDrawer(drawer === r.id ? null : r.id)}
                  role="button"
                  tabIndex={0}
                >
                  <span className="st-col-date">
                    <span className="st-date-main">{fmtDate(dateStr)}</span>
                    <span className="st-date-sub">{fmtTime(dateStr)}</span>
                  </span>
                  <span className="st-col-title">{r.title}</span>
                  <span className="st-col-project">{r.project_name ? <span className="pill small">{r.project_name}</span> : <span className="muted small">—</span>}</span>
                  <span className="st-col-eff">
                    <span className="eff-badge small">{r.efficiency_score != null ? `${Math.round(r.efficiency_score * 100)}%` : '—'}</span>
                  </span>
                  <Link to={`/meeting/${r.id}`} className="st-col-act" onClick={(e) => e.stopPropagation()}>Open →</Link>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* CALENDAR VIEW */}
      {view === 'calendar' && (
        <div className="exec-card">
          <h3 className="exec-card-title">{calData.month}</h3>
          <div className="cal-weekdays">
            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => <span key={d} className="cal-wd">{d}</span>)}
          </div>
          <div className="cal-cells">
            {calData.cells.map((day, i) => (
              <div key={i} className={`cal-cell ${!day ? 'cal-empty' : ''}`}>
                {day && (
                  <>
                    <div className="cal-day-num">{day}</div>
                    <div className="cal-day-meets">
                      {(calData.byDay[day] || []).map((m) => (
                        <Link to={`/meeting/${m.id}`} key={m.id} className="cal-meet-pill">
                          <span className="cal-meet-title">{m.title}</span>
                          <span className="cal-meet-eff">{m.efficiency_score != null ? `${Math.round(m.efficiency_score * 100)}%` : ''}</span>
                        </Link>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PROJECT VIEW */}
      {view === 'project' && (
        Object.keys(grouped).length === 0 ? (
          <div className="exec-card"><p className="muted">No meetings found.</p></div>
        ) : (
          <div className="project-groups">
            {Object.entries(grouped).map(([pn, meetings]) => (
              <div key={pn} className="exec-card project-group">
                <h3 className="project-group-title">
                  <span className="project-dot" style={{ background: pn === 'Unassigned' ? '#6b7280' : '#a78bfa' }} />
                  {pn}
                  <span className="muted small" style={{ marginLeft: 8 }}>{meetings.length} meeting{meetings.length !== 1 ? 's' : ''}</span>
                </h3>
                <div className="project-group-meetings">
                  {meetings.map((r) => (
                    <Link to={`/meeting/${r.id}`} key={r.id} className="activity-card">
                      <span className="activity-date">{fmtDate(r.scheduled_at || r.created_at)}</span>
                      <strong className="activity-body">{r.title}</strong>
                      <span className="eff-badge small">{r.efficiency_score != null ? `${Math.round(r.efficiency_score * 100)}%` : '—'}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Quick-look drawer */}
      {drawerData && (
        <div className="ql-drawer-overlay" onClick={() => setDrawer(null)}>
          <div className="ql-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="ql-drawer-header">
              <h3>{drawerData.title}</h3>
              <button type="button" className="btn-ghost small" onClick={() => setDrawer(null)}>✕</button>
            </div>
            <div className="ql-drawer-body">
              <div className="ql-stat-row">
                <span className="muted small">Efficiency</span>
                <span className="eff-badge">{drawerData.efficiency_score != null ? `${Math.round(drawerData.efficiency_score * 100)}%` : '—'}</span>
              </div>
              {drawerData.summary && (
                <div className="ql-section">
                  <h4 className="muted small">Summary</h4>
                  <p className="ql-text">{drawerData.summary}</p>
                </div>
              )}
              {drawerData.dominant_speaker_alert && <div className="badge warn" style={{ marginBottom: 8 }}>Dominance alert</div>}
              {drawerData.low_engagement_alert && <div className="badge warn" style={{ marginBottom: 8 }}>Low engagement</div>}
              <Link to={`/meeting/${drawerData.id}`} className="btn-primary compact" style={{ display: 'block', textAlign: 'center', marginTop: 12 }}>
                Open full analysis →
              </Link>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

export default MeetingsListPage;
