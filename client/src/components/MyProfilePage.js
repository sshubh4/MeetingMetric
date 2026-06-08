import React, { useEffect, useState } from 'react';
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import toast from 'react-hot-toast';
import AppShell from './AppShell';
import { getMe, addAlias, removeAlias } from '../api';

const DIMS = ['engagement', 'sentiment', 'collaboration', 'initiative', 'clarity'];

function MyProfilePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newAlias, setNewAlias] = useState('');
  const [addingAlias, setAddingAlias] = useState(false);

  const load = () => {
    setLoading(true);
    getMe()
      .then(setData)
      .catch((e) => toast.error(e.response?.data?.error || 'Failed to load profile'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleAddAlias = async (e) => {
    e.preventDefault();
    if (!newAlias.trim()) return;
    setAddingAlias(true);
    try {
      await addAlias(newAlias.trim());
      toast.success(`Alias "${newAlias.trim()}" added`);
      setNewAlias('');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add alias');
    } finally {
      setAddingAlias(false);
    }
  };

  const handleRemoveAlias = async (alias) => {
    try {
      await removeAlias(alias);
      toast.success(`Alias "${alias}" removed`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to remove alias');
    }
  };

  if (loading) return <AppShell title="My Profile"><p className="text-muted">Loading…</p></AppShell>;
  if (!data) return <AppShell title="My Profile"><p className="text-muted">No data.</p></AppShell>;

  const { user, aliases, stats } = data;
  const { avgScores, trendLast10, percentiles, meetingCount } = stats;

  const radarData = DIMS.map((k) => ({
    dim: k.charAt(0).toUpperCase() + k.slice(1),
    v: avgScores[k] ?? 0,
  }));

  const trendChartData = [...trendLast10].reverse().map((t, i) => ({
    idx: i + 1,
    engagement: t.scores.engagement,
  }));

  return (
    <AppShell title="My Profile" subtitle="Your personal performance dashboard">
      {/* Header */}
      <div className="card flex items-center gap-5 mb-6">
        <div className="w-16 h-16 rounded-full bg-accent-dim flex items-center justify-center text-white text-xl font-bold flex-shrink-0">
          {(user.fullName || user.email || 'U').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">{user.fullName || user.email}</h2>
          <p className="text-muted text-sm">{user.email}</p>
          <span className={`badge mt-1 ${
            user.role === 'admin' ? 'badge-role-admin' :
            user.role === 'hr' ? 'badge-role-hr' :
            user.role === 'manager' ? 'badge-role-manager' :
            'badge-role-employee'
          }`}>{user.role}</span>
        </div>
        <div className="ml-auto text-right">
          <div className="stat-val text-2xl">{meetingCount}</div>
          <div className="stat-label">Meetings</div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {DIMS.map((k) => {
          const val = Math.round((avgScores[k] ?? 0) * 100);
          const pct = percentiles[k] ?? 50;
          return (
            <div key={k} className="stat-card">
              <div className="stat-val">{val}%</div>
              <div className="stat-label">{k}</div>
              <div className="mt-2 text-xs text-positive">Top {100 - pct}% in org</div>
              <div className="dim-bar mt-1">
                <div className="dim-bar-fill" style={{ width: `${val}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
        {/* Radar */}
        <div className="card">
          <h3 className="text-sm font-semibold text-white mb-4">Skill Radar</h3>
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="rgba(255,255,255,0.08)" />
              <PolarAngleAxis dataKey="dim" tick={{ fill: '#8b95a8', fontSize: 10 }} />
              <PolarRadiusAxis domain={[0, 1]} tick={false} axisLine={false} />
              <Radar dataKey="v" stroke="#a78bfa" fill="#7c3aed" fillOpacity={0.35} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Trend */}
        <div className="card">
          <h3 className="text-sm font-semibold text-white mb-4">Engagement Trend (last 10)</h3>
          {trendChartData.length < 2 ? (
            <p className="text-muted text-sm">Not enough data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="idx" tick={{ fill: '#8b95a8', fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fill: '#8b95a8', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: '#1e2028', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                <Line type="monotone" dataKey="engagement" stroke="#a78bfa" strokeWidth={2} dot={{ fill: '#7c3aed', r: 3 }} name="Engagement %" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Alias management */}
      <div className="card">
        <h3 className="text-sm font-semibold text-white mb-1">Speaker Aliases</h3>
        <p className="text-xs text-muted mb-4">
          Add the name(s) you appear as in meeting transcripts. This links your performance data automatically.
        </p>

        {/* Current aliases */}
        {aliases.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {aliases.map((a) => (
              <div
                key={a.alias_name}
                className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm"
              >
                <span className="text-slate-200">{a.alias_name}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveAlias(a.alias_name)}
                  className="text-muted hover:text-danger transition-colors"
                  title="Remove alias"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {aliases.length === 0 && (
          <p className="text-muted text-sm mb-4">No aliases yet.</p>
        )}

        <form onSubmit={handleAddAlias} className="flex gap-2">
          <input
            type="text"
            className="input flex-1"
            placeholder='e.g. "Sarah Chen" or "S. Chen"'
            value={newAlias}
            onChange={(e) => setNewAlias(e.target.value)}
            maxLength={80}
          />
          <button type="submit" className="btn-primary" disabled={addingAlias || !newAlias.trim()}>
            {addingAlias ? 'Adding…' : 'Add alias'}
          </button>
        </form>
      </div>
    </AppShell>
  );
}

export default MyProfilePage;
