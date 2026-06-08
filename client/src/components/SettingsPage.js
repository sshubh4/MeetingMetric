import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import AppShell from './AppShell';
import {
  getUserProfile, updateUserProfile,
  getTeamsStatus, getTeamsAuthUrl, disconnectTeams,
  getTeamsProfile, listTeamsMeetings, importTeamsMeeting,
  getPollStatus, triggerPollNow,
  getToken,
} from '../api';

function SettingsPage() {
  const [searchParams] = useSearchParams();
  const [profile, setProfile]             = useState(null);
  const [teamsStatus, setTeamsStatus]     = useState(null);
  const [teamsProfile, setTeamsProfile]   = useState(null);
  const [teamsMeetings, setTeamsMeetings] = useState([]);
  const [pollStatus, setPollStatus]       = useState(null);
  const [importing, setImporting]         = useState(null);
  const [syncing, setSyncing]             = useState(false);
  const [fullName, setFullName]           = useState('');
  const [organisation, setOrganisation]   = useState('');
  const [roleTitle, setRoleTitle]         = useState('');
  const [saving, setSaving]               = useState(false);

  const apiToken = getToken();

  useEffect(() => {
    const teamsParam = searchParams.get('teams');
    if (teamsParam === 'connected') toast.success('Microsoft Teams connected!');
    if (teamsParam === 'error') toast.error(`Teams connection failed: ${searchParams.get('msg') || 'Unknown error'}`);
  }, [searchParams]);

  useEffect(() => {
    getUserProfile().then((p) => {
      setProfile(p);
      setFullName(p.full_name || '');
      setOrganisation(p.organisation || '');
      setRoleTitle(p.role || '');
    }).catch(() => {});

    getTeamsStatus().then((s) => {
      setTeamsStatus(s);
      if (s.connected) {
        getTeamsProfile().then(setTeamsProfile).catch(() => {});
        listTeamsMeetings().then(setTeamsMeetings).catch(() => setTeamsMeetings([]));
        getPollStatus().then(setPollStatus).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await updateUserProfile({ fullName, organisation, role: roleTitle });
      setProfile((p) => ({ ...p, ...updated }));
      toast.success('Profile saved');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleConnect = async () => {
    try {
      const { url } = await getTeamsAuthUrl();
      window.location.href = url;
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not start Teams connection');
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectTeams();
      setTeamsStatus({ configured: true, connected: false });
      setTeamsProfile(null);
      setTeamsMeetings([]);
      setPollStatus(null);
      toast.success('Teams disconnected');
    } catch {
      toast.error('Disconnect failed');
    }
  };

  const handleImport = async (meetingId, subject) => {
    setImporting(meetingId);
    try {
      const result = await importTeamsMeeting(meetingId, subject);
      toast.success(`Imported & analyzed → Meeting #${result.meetingId}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Import failed');
    } finally {
      setImporting(null);
    }
  };

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

  const fmtRelative = (iso) => {
    if (!iso) return 'never';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  };

  return (
    <AppShell title="Settings" subtitle="Account, integrations, and platform configuration">
      <div className="space-y-5 max-w-2xl">

        {/* Profile */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <h3 className="text-sm font-semibold text-white">User Profile</h3>
          </div>
          {profile ? (
            <form onSubmit={handleSave} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-muted uppercase tracking-wider">Email</label>
                <input type="text" className="input opacity-60 cursor-not-allowed" value={profile.email} disabled />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted uppercase tracking-wider">Full Name</label>
                <input type="text" className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted uppercase tracking-wider">Organisation</label>
                  <input type="text" className="input" value={organisation} onChange={(e) => setOrganisation(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted uppercase tracking-wider">Role / Title</label>
                  <input type="text" className="input" placeholder="e.g. Engineering Manager" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} />
                </div>
              </div>
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
            </form>
          ) : <p className="text-muted text-sm">Loading…</p>}
        </div>

        {/* Microsoft Teams */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7b83eb" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
            <h3 className="text-sm font-semibold text-white">Microsoft Teams</h3>
          </div>

          {!teamsStatus ? (
            <p className="text-muted text-sm">Checking status…</p>
          ) : !teamsStatus.configured ? (
            <div className="space-y-3">
              <p className="text-muted text-sm">Teams integration requires Azure AD configuration on the server.</p>
              <div className="bg-white/[0.03] rounded-lg p-3 space-y-1">
                <p className="text-xs text-muted">Required environment variables:</p>
                <code className="text-xs text-accent">AZURE_CLIENT_ID · AZURE_CLIENT_SECRET · AZURE_REDIRECT_URI</code>
              </div>
              <Link to="/setup" className="text-xs text-accent hover:underline">Setup guide →</Link>
            </div>
          ) : !teamsStatus.connected ? (
            <div className="space-y-3">
              <p className="text-muted text-sm">Connect to sync calendar, import transcripts, and enable auto-ingestion.</p>
              <button type="button" className="btn-primary flex items-center gap-2" onClick={handleConnect}>
                <span className="text-lg">⊞</span> Connect Microsoft Teams
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-positive" />
                  <span className="text-sm font-medium text-white">Connected</span>
                  {teamsProfile && <span className="text-xs text-muted">as {teamsProfile.displayName || teamsProfile.mail}</span>}
                </div>
                <button type="button" className="btn-ghost text-xs" onClick={handleDisconnect}>Disconnect</button>
              </div>

              {/* Auto-ingestion status + sync */}
              <div className="bg-white/[0.03] rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-white">Auto-Ingestion</div>
                  <button type="button" className="btn-ghost text-xs" onClick={handleSyncNow} disabled={syncing}>
                    {syncing ? 'Syncing…' : 'Sync Now'}
                  </button>
                </div>
                <div className="text-xs text-muted space-y-1">
                  <div>Last synced: {fmtRelative(pollStatus?.lastPolledAt)}</div>
                  {pollStatus?.connectedUsersInOrg > 0 && (
                    <div>{pollStatus.connectedUsersInOrg} connected users in org</div>
                  )}
                </div>
              </div>

              {/* Features */}
              <div className="space-y-2">
                {[
                  ['Calendar Sync', 'Teams events visible in Calendar'],
                  ['Transcript Import', 'Pull transcripts from completed meetings'],
                  ['Auto-Ingestion', 'Background poll every 5 minutes for new meetings'],
                ].map(([title, desc]) => (
                  <div key={title} className="flex items-start gap-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-positive flex-shrink-0 mt-1.5" />
                    <div>
                      <div className="text-xs font-medium text-slate-200">{title}</div>
                      <div className="text-xs text-muted">{desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Import from Teams */}
        {teamsStatus?.connected && teamsMeetings.length > 0 && (
          <div className="card">
            <div className="flex items-center gap-2 mb-4">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/></svg>
              <h3 className="text-sm font-semibold text-white">Import from Teams</h3>
            </div>
            <div className="space-y-2">
              {teamsMeetings.slice(0, 10).map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 py-2 border-b border-white/[0.05] last:border-0">
                  <div className="min-w-0">
                    <div className="text-sm text-slate-200 truncate font-medium">{m.subject}</div>
                    <div className="text-xs text-muted">{m.startDateTime ? new Date(m.startDateTime).toLocaleString() : ''}</div>
                  </div>
                  <button type="button" className="btn-primary text-xs py-1.5 px-3 flex-shrink-0"
                    disabled={importing === m.id} onClick={() => handleImport(m.id, m.subject)}>
                    {importing === m.id ? 'Importing…' : 'Import'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* API Token */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            <h3 className="text-sm font-semibold text-white">API Token</h3>
          </div>
          <p className="text-xs text-muted mb-3">Use this token with the bot endpoint or for programmatic access.</p>
          <div className="flex gap-2 mb-4">
            <input type="text" className="input font-mono text-xs flex-1" value={apiToken || ''} readOnly />
            <button type="button" className="btn-ghost text-xs"
              onClick={() => { navigator.clipboard.writeText(apiToken || ''); toast.success('Copied!'); }}>
              Copy
            </button>
          </div>
          <div className="bg-white/[0.03] rounded-lg p-3">
            <div className="text-xs text-muted mb-2 font-medium">Bot endpoint</div>
            <code className="text-xs text-accent block mb-2">POST /api/bot/transcript</code>
            <pre className="text-xs text-muted leading-relaxed overflow-x-auto">{`{
  "apiKey": "<your-token>",
  "title": "Sprint Planning",
  "transcript": [
    { "speaker": "Alice", "text": "Let's start with the backlog." },
    { "speaker": "Bob",   "text": "I think we should focus on auth." }
  ]
}`}</pre>
          </div>
        </div>

        {/* Speaker aliases shortcut */}
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <h3 className="text-sm font-semibold text-white">Speaker Aliases</h3>
          </div>
          <p className="text-xs text-muted mb-3">Manage the names that appear for you in transcripts.</p>
          <Link to="/me" className="btn-ghost text-xs">Manage aliases on My Profile →</Link>
        </div>

        {/* Privacy */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <h3 className="text-sm font-semibold text-white">Privacy & Ethics</h3>
          </div>
          <ul className="space-y-2 text-xs text-muted">
            {[
              'Use MeetingMetric for development and effectiveness, not surveillance.',
              'Obtain consent where required before analyzing conversations.',
              'Scores are explainable and transcript-backed.',
              'The Teams bot announces its presence when joining meetings.',
            ].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <span className="text-positive mt-0.5">✓</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AppShell>
  );
}

export default SettingsPage;
