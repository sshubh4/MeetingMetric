import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';
import AppShell from './AppShell';
import { getMeeting } from '../api';

const DIMS = [
  { key: 'engagement', label: 'Engagement' },
  { key: 'sentiment', label: 'Sentiment' },
  { key: 'collaboration', label: 'Collaboration' },
  { key: 'initiative', label: 'Initiative' },
  { key: 'clarity', label: 'Clarity' },
];

function initials(name) {
  return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function MeetingDetail() {
  const { id } = useParams();
  const [m, setM] = useState(null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('analysis');

  useEffect(() => {
    getMeeting(id).then(setM).catch(() => setError('Meeting not found'));
  }, [id]);

  if (error) return <AppShell title="Analysis Studio"><p className="error">{error}</p><Link to="/meetings">Back to hub</Link></AppShell>;
  if (!m) return <AppShell title="Analysis Studio"><p className="muted">Loading…</p></AppShell>;

  const eff = Math.round((m.efficiency_score || 0) * 100);
  const posCount = m.speakers.filter((s) => (s.scores?.sentiment ?? 0) >= 0.5).length;
  const negCount = m.speakers.length - posCount;

  const handleExport = () => {
    const lines = [];
    lines.push(`MeetingMetric — 1-on-1 Prep Report`);
    lines.push(`Meeting: ${m.title}`);
    lines.push(`Date: ${new Date(m.created_at).toLocaleString()}`);
    lines.push(`Efficiency: ${eff}%`);
    lines.push(`\n--- Summary ---\n${m.summary}`);
    m.speakers.forEach((s) => {
      lines.push(`\n--- ${s.speaker_name} ---`);
      DIMS.forEach((d) => lines.push(`  ${d.label}: ${((s.scores[d.key] ?? 0) * 100).toFixed(0)}%`));
      if (s.coaching_text) lines.push(`  Coaching: ${s.coaching_text}`);
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MeetingMetric_${m.title.replace(/\s+/g, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell title="Analysis Studio" subtitle={m.title}>
      {/* Header with badges, gauge, and export */}
      <div className="studio-header">
        <div className="studio-meta">
          <div className="exec-badges">
            {m.project_name && <span className="badge" style={{ borderColor: m.project_color }}>{m.project_name}</span>}
            <span className="badge soft">AI analyzed</span>
            {m.dominant_speaker_alert && <span className="badge warn">Dominance alert</span>}
            {m.low_engagement_alert && <span className="badge warn">Low engagement</span>}
          </div>
          <span className="muted small">{new Date(m.created_at).toLocaleString()}</span>
        </div>
        <div className="studio-actions">
          <div className="studio-gauge">
            <svg viewBox="0 0 80 80" width="64" height="64">
              <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
              <circle cx="40" cy="40" r="34" fill="none" stroke="#a78bfa" strokeWidth="7" strokeDasharray={`${(eff / 100) * 213.6} 213.6`} strokeLinecap="round" transform="rotate(-90 40 40)" />
              <text x="40" y="42" textAnchor="middle" fill="#e8eaed" fontSize="16" fontWeight="700">{eff}</text>
            </svg>
          </div>
          <button type="button" className="btn-primary compact" onClick={handleExport}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6, verticalAlign: -2 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export 1-on-1 Prep
          </button>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="studio-tabs">
        <button type="button" className={`studio-tab ${activeTab === 'analysis' ? 'active' : ''}`} onClick={() => setActiveTab('analysis')}>Quant Engine</button>
        <button type="button" className={`studio-tab ${activeTab === 'transcript' ? 'active' : ''}`} onClick={() => setActiveTab('transcript')}>Raw Transcript</button>
      </div>

      {/* Split pane */}
      <div className="studio-body">
        {activeTab === 'analysis' ? (
          <>
            {/* Summary + coaching */}
            <div className="studio-grid-2">
              <div className="exec-card">
                <h3 className="exec-card-title">Executive Summary</h3>
                <p className="exec-summary">{m.summary}</p>
                <div className="sentiment-bar">
                  <span className="sent-pos" style={{ flex: Math.max(posCount, 1) }}>Constructive {posCount}</span>
                  <span className="sent-neg" style={{ flex: Math.max(negCount, 1) }}>Needs attention {negCount}</span>
                </div>
              </div>
              <div className="exec-card">
                <h3 className="exec-card-title">Strategic Coaching</h3>
                <div className="coach-blocks">
                  <div>
                    <strong className="coach-label">Focus areas</strong>
                    <p className="muted small">Review dominance and initiative scores. Balance airtime with decision moments.</p>
                  </div>
                  <div>
                    <strong className="coach-label">Quality check</strong>
                    <p className="muted small">Compare ideas vs. decisions per speaker. Low decision counts suggest missing follow-ups.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Participant cards */}
            <h3 className="section-label">Participant Assessment</h3>
            <div className="participant-strip">
              {m.speakers.map((s) => {
                const radar = DIMS.map((d) => ({ dim: d.label, v: s.scores[d.key] ?? 0 }));
                const eng = Math.round((s.scores?.engagement ?? 0) * 100);
                return (
                  <div className="exec-card participant-card" key={s.speaker_name}>
                    <div className="participant-head">
                      <div className="avatar">{initials(s.speaker_name)}</div>
                      <div>
                        <strong>{s.speaker_name}</strong>
                        <p className="muted small">Engagement {eng}% · Talk {(s.talk_ratio * 100).toFixed(0)}%</p>
                      </div>
                    </div>
                    <div className="radar-wrap small-radar">
                      <ResponsiveContainer width="100%" height={180}>
                        <RadarChart data={radar}>
                          <PolarGrid stroke="rgba(255,255,255,0.08)" />
                          <PolarAngleAxis dataKey="dim" tick={{ fill: '#8b95a8', fontSize: 9 }} />
                          <PolarRadiusAxis domain={[0, 1]} tick={false} axisLine={false} />
                          <Radar dataKey="v" stroke="#a78bfa" fill="#7c3aed" fillOpacity={0.3} />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="coaching-inline">{s.coaching_text}</p>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="exec-card transcript-card">
            <pre className="raw">{m.raw_text}</pre>
          </div>
        )}
      </div>

      <div style={{ marginTop: '1.5rem' }}>
        <Link to="/meetings" className="btn-ghost">← Back to Intelligence Hub</Link>
      </div>
    </AppShell>
  );
}

export default MeetingDetail;
