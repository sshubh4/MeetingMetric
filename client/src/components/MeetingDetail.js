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

const SPEAKER_COLORS = ['#a78bfa', '#55e7fc', '#4ade80', '#fbbf24', '#f87171', '#c084fc', '#38bdf8'];

function initials(name) {
  return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function sourceBadge(source) {
  const map = {
    manual: { label: 'Manual', cls: 'bg-white/10 text-slate-400' },
    teams_auto: { label: 'Teams Auto', cls: 'bg-blue-500/20 text-blue-300' },
    teams_import: { label: 'Teams Import', cls: 'bg-indigo-500/20 text-indigo-300' },
    bot: { label: 'Bot', cls: 'bg-yellow-500/20 text-yellow-300' },
  };
  const s = map[source] || map.manual;
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

function MeetingDetail() {
  const { id } = useParams();
  const [m, setM] = useState(null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('analysis');

  useEffect(() => {
    getMeeting(id).then(setM).catch(() => setError('Meeting not found'));
  }, [id]);

  if (error) return <AppShell title="Meeting"><p className="text-danger">{error}</p><Link to="/meetings" className="btn-ghost mt-4 inline-block">← Back</Link></AppShell>;
  if (!m) return <AppShell title="Meeting"><p className="text-muted">Loading…</p></AppShell>;

  const eff = Math.round((m.efficiency_score || 0) * 100);
  const posCount = m.speakers.filter((s) => (s.scores?.sentiment ?? 0) >= 0.5).length;
  const negCount = m.speakers.length - posCount;

  // Build speaker color map
  const speakerColorMap = {};
  m.speakers.forEach((s, i) => {
    speakerColorMap[s.speaker_name] = SPEAKER_COLORS[i % SPEAKER_COLORS.length];
  });

  // Color-code transcript
  const coloredTranscript = () => {
    if (!m.raw_text) return [];
    return m.raw_text.split('\n').map((line, i) => {
      const match = line.match(/^([^:]+):/);
      const speaker = match ? match[1].trim() : null;
      const color = speaker && speakerColorMap[speaker] ? speakerColorMap[speaker] : null;
      return { line, color, key: i };
    });
  };

  const handleExport = () => {
    const lines = [`MeetingMetric — 1-on-1 Prep Report`, `Meeting: ${m.title}`, `Date: ${new Date(m.created_at).toLocaleString()}`, `Efficiency: ${eff}%`, `\n--- Summary ---\n${m.summary}`];
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
    <AppShell>
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-bg/90 backdrop-blur-sm -mx-6 md:-mx-8 px-6 md:px-8 py-4 border-b border-white/[0.06] mb-6">
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-white truncate">{m.title}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {sourceBadge(m.source)}
              {m.project_name && <span className="badge" style={{ background: (m.project_color || '#a78bfa') + '30', color: m.project_color || '#a78bfa' }}>{m.project_name}</span>}
              {m.dominant_speaker_alert && <span className="badge bg-warning/20 text-warning border border-warning/20">Dominance alert</span>}
              {m.low_engagement_alert && <span className="badge bg-danger/20 text-danger border border-danger/20">Low engagement</span>}
              <span className="text-xs text-muted">{new Date(m.scheduled_at || m.created_at).toLocaleDateString()}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Efficiency gauge */}
            <div className="relative">
              <svg viewBox="0 0 80 80" width="60" height="60">
                <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
                <circle cx="40" cy="40" r="34" fill="none" stroke="#a78bfa" strokeWidth="7"
                  strokeDasharray={`${(eff / 100) * 213.6} 213.6`} strokeLinecap="round"
                  transform="rotate(-90 40 40)" />
                <text x="40" y="45" textAnchor="middle" fill="#e8eaed" fontSize="18" fontWeight="700">{eff}</text>
              </svg>
            </div>
            <button type="button" className="btn-ghost text-xs" onClick={handleExport}>
              Export
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4">
          {['analysis', 'transcript'].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTab(t)}
              className={`px-4 py-1.5 text-sm rounded-lg transition-colors capitalize ${activeTab === t ? 'bg-white/10 text-white' : 'text-muted hover:text-white'}`}
            >
              {t === 'analysis' ? 'Analysis' : 'Transcript'}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'analysis' ? (
        <>
          {/* Summary + coaching */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
            <div className="card">
              <h3 className="text-sm font-semibold text-white mb-3">Executive Summary</h3>
              <p className="text-sm text-slate-300 leading-relaxed">{m.summary}</p>
              <div className="flex mt-4 rounded-lg overflow-hidden h-2">
                <div className="bg-positive" style={{ flex: Math.max(posCount, 1) }} title={`${posCount} constructive`} />
                <div className="bg-danger/60" style={{ flex: Math.max(negCount, 0) }} title={`${negCount} needs attention`} />
              </div>
              <div className="flex justify-between text-xs text-muted mt-1">
                <span>Constructive {posCount}</span>
                <span>Needs attention {negCount}</span>
              </div>
            </div>
            <div className="card">
              <h3 className="text-sm font-semibold text-white mb-3">Strategic Coaching</h3>
              <div className="space-y-3 text-sm text-muted">
                <div>
                  <div className="text-slate-200 font-medium mb-0.5">Focus areas</div>
                  <p>Review dominance and initiative scores. Balance airtime with decision moments.</p>
                </div>
                <div>
                  <div className="text-slate-200 font-medium mb-0.5">Quality check</div>
                  <p>Compare ideas vs. decisions per speaker. Low decision counts suggest missing follow-ups.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Participant cards */}
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-4">Participant Assessment</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {m.speakers.map((s) => {
              const radar = DIMS.map((d) => ({ dim: d.label, v: s.scores[d.key] ?? 0 }));
              const eng = Math.round((s.scores?.engagement ?? 0) * 100);
              return (
                <div key={s.speaker_name} className="card">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                      style={{ background: speakerColorMap[s.speaker_name] + '40', border: `1px solid ${speakerColorMap[s.speaker_name]}40` }}>
                      {initials(s.speaker_name)}
                    </div>
                    <div>
                      <div className="font-semibold text-sm text-white">{s.speaker_name}</div>
                      <div className="text-xs text-muted">Engagement {eng}% · Talk {(s.talk_ratio * 100).toFixed(0)}%</div>
                    </div>
                  </div>

                  {/* Dimension bars */}
                  <div className="space-y-1.5 mb-3">
                    {DIMS.map((d) => (
                      <div key={d.key} className="flex items-center gap-2">
                        <span className="text-xs text-muted w-20 flex-shrink-0">{d.label}</span>
                        <div className="dim-bar flex-1">
                          <div className="dim-bar-fill" style={{ width: `${((s.scores[d.key] ?? 0) * 100)}%`, background: speakerColorMap[s.speaker_name] }} />
                        </div>
                        <span className="text-xs text-muted w-8 text-right">{((s.scores[d.key] ?? 0) * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>

                  <ResponsiveContainer width="100%" height={140}>
                    <RadarChart data={radar}>
                      <PolarGrid stroke="rgba(255,255,255,0.08)" />
                      <PolarAngleAxis dataKey="dim" tick={{ fill: '#8b95a8', fontSize: 8 }} />
                      <PolarRadiusAxis domain={[0, 1]} tick={false} axisLine={false} />
                      <Radar dataKey="v" stroke={speakerColorMap[s.speaker_name]} fill={speakerColorMap[s.speaker_name]} fillOpacity={0.25} />
                    </RadarChart>
                  </ResponsiveContainer>

                  {s.coaching_text && (
                    <p className="text-xs text-muted mt-3 pt-3 border-t border-white/[0.06] leading-relaxed">{s.coaching_text}</p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="card">
          <h3 className="text-sm font-semibold text-white mb-3">Raw Transcript</h3>
          {/* Speaker legend */}
          <div className="flex flex-wrap gap-3 mb-4">
            {Object.entries(speakerColorMap).map(([name, color]) => (
              <div key={name} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                <span className="text-xs text-muted">{name}</span>
              </div>
            ))}
          </div>
          <div className="font-mono text-xs leading-relaxed space-y-0.5 max-h-[600px] overflow-y-auto">
            {coloredTranscript().map(({ line, color, key }) => (
              <div key={key} className={line.trim() ? '' : 'h-3'}>
                {line.trim() && (
                  <span style={color ? { color } : { color: '#8b95a8' }}>{line}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8">
        <Link to="/meetings" className="btn-ghost">← Back to Meetings</Link>
      </div>
    </AppShell>
  );
}

export default MeetingDetail;
