import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppShell from './AppShell';
import {
  getUserProfile, updateUserProfile,
  getTeamsStatus, getTeamsAuthUrl, disconnectTeams,
  getTeamsProfile, listTeamsMeetings, importTeamsMeeting,
  getToken,
} from '../api';

const ROLES = ['Executive', 'HR', 'Team Lead', 'Manager', 'Analyst', 'Member'];

function SettingsPage() {
  const [searchParams] = useSearchParams();
  const [profile, setProfile] = useState(null);
  const [teamsStatus, setTeamsStatus] = useState(null);
  const [teamsProfile, setTeamsProfile] = useState(null);
  const [teamsMeetings, setTeamsMeetings] = useState([]);
  const [importing, setImporting] = useState(null);
  const [importMsg, setImportMsg] = useState('');
  const [fullName, setFullName] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [role, setRole] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [connectMsg, setConnectMsg] = useState('');

  useEffect(() => {
    const teamsParam = searchParams.get('teams');
    if (teamsParam === 'connected') setConnectMsg('Microsoft Teams connected successfully!');
    if (teamsParam === 'error') setConnectMsg(`Teams connection failed: ${searchParams.get('msg') || 'Unknown error'}`);
  }, [searchParams]);

  useEffect(() => {
    getUserProfile().then((p) => {
      setProfile(p);
      setFullName(p.full_name || '');
      setOrganisation(p.organisation || '');
      setRole(p.role || '');
    }).catch(() => {});

    getTeamsStatus().then((s) => {
      setTeamsStatus(s);
      if (s.connected) {
        getTeamsProfile().then(setTeamsProfile).catch(() => {});
        listTeamsMeetings().then(setTeamsMeetings).catch(() => setTeamsMeetings([]));
      }
    }).catch(() => {});
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveMsg('');
    try {
      const updated = await updateUserProfile({ fullName, organisation, role });
      setProfile((p) => ({ ...p, ...updated }));
      setSaveMsg('Profile saved');
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (err) {
      setSaveMsg(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleConnect = async () => {
    try {
      const { url } = await getTeamsAuthUrl();
      window.location.href = url;
    } catch (err) {
      setConnectMsg(err.response?.data?.error || 'Could not start Teams connection');
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectTeams();
      setTeamsStatus({ configured: true, connected: false });
      setTeamsProfile(null);
      setTeamsMeetings([]);
      setConnectMsg('Microsoft Teams disconnected');
    } catch {
      setConnectMsg('Disconnect failed');
    }
  };

  const handleImport = async (meetingId, subject) => {
    setImporting(meetingId);
    setImportMsg('');
    try {
      const result = await importTeamsMeeting(meetingId, subject);
      setImportMsg(`Imported & analyzed → Meeting #${result.meetingId}`);
    } catch (err) {
      setImportMsg(err.response?.data?.error || 'Import failed');
    } finally {
      setImporting(null);
    }
  };

  const apiToken = getToken();

  return (
    <AppShell title="Workspace Settings" subtitle="Account, integrations, and platform configuration">
      {connectMsg && (
        <div className={`settings-banner ${connectMsg.includes('fail') || connectMsg.includes('error') ? 'error-bg' : 'success-bg'}`}>
          {connectMsg}
          <button type="button" onClick={() => setConnectMsg('')} className="banner-close">×</button>
        </div>
      )}

      <div className="settings-modules">
        {/* Module: Profile */}
        <div className="exec-card settings-module">
          <div className="module-header">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <h3 className="exec-card-title">User Profile</h3>
          </div>
          {profile ? (
            <form onSubmit={handleSave}>
              <label>Email<input type="text" value={profile.email} disabled /></label>
              <label>Full Name<input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>
              <div className="upload-row-2">
                <label>Organisation<input type="text" value={organisation} onChange={(e) => setOrganisation(e.target.value)} /></label>
                <label>
                  Role / Title
                  <select value={role} onChange={(e) => setRole(e.target.value)}>
                    <option value="">Select role…</option>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>
              </div>
              <div className="settings-actions">
                <button type="submit" className="btn-primary compact" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
                {saveMsg && <span className="muted small">{saveMsg}</span>}
              </div>
            </form>
          ) : <p className="muted">Loading…</p>}
        </div>

        {/* Module: Microsoft Teams */}
        <div className="exec-card settings-module">
          <div className="module-header">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7b83eb" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
            <h3 className="exec-card-title">Microsoft Teams</h3>
          </div>

          {!teamsStatus ? (
            <p className="muted">Checking status…</p>
          ) : !teamsStatus.configured ? (
            <div className="teams-not-configured">
              <p className="muted">Teams integration requires Azure AD configuration on the server.</p>
              <div className="settings-env-hint">
                <p className="muted small">Required environment variables:</p>
                <code>AZURE_CLIENT_ID</code> · <code>AZURE_CLIENT_SECRET</code> · <code>AZURE_REDIRECT_URI</code>
              </div>
            </div>
          ) : !teamsStatus.connected ? (
            <div className="teams-connect-block">
              <p className="muted">Connect to sync calendar, import transcripts, and enable real-time analysis.</p>
              <button type="button" className="btn-teams" onClick={handleConnect}>
                <span className="teams-ms-icon">⊞</span> Connect Microsoft Teams
              </button>
            </div>
          ) : (
            <div className="teams-connected-block">
              <div className="teams-status-row">
                <span className="status-dot connected" />
                <span>Connected</span>
                {teamsProfile && <span className="muted small">as {teamsProfile.displayName || teamsProfile.mail}</span>}
              </div>
              <div className="teams-features">
                <div className="teams-feature"><strong>Calendar Sync</strong><p className="muted small">Teams events visible in Calendar.</p></div>
                <div className="teams-feature"><strong>Transcript Import</strong><p className="muted small">Pull transcripts from completed meetings.</p></div>
                <div className="teams-feature"><strong>Real-time Bot</strong><p className="muted small">Captures live transcripts during meetings.</p></div>
              </div>
              <button type="button" className="btn-ghost" onClick={handleDisconnect}>Disconnect Teams</button>
            </div>
          )}
        </div>

        {/* Module: Recent Teams Meetings */}
        {teamsStatus?.connected && teamsMeetings.length > 0 && (
          <div className="exec-card settings-module wide">
            <div className="module-header">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/></svg>
              <h3 className="exec-card-title">Import from Teams</h3>
            </div>
            {importMsg && <p className={importMsg.includes('fail') ? 'error' : 'muted small'}>{importMsg}</p>}
            <div className="teams-import-list">
              {teamsMeetings.slice(0, 10).map((m) => (
                <div key={m.id} className="teams-import-row">
                  <div>
                    <strong>{m.subject}</strong>
                    <span className="muted small">{m.startDateTime ? new Date(m.startDateTime).toLocaleString() : ''}</span>
                  </div>
                  <button type="button" className="btn-primary compact" disabled={importing === m.id} onClick={() => handleImport(m.id, m.subject)}>
                    {importing === m.id ? 'Importing…' : 'Import'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Module: API Keys */}
        <div className="exec-card settings-module wide">
          <div className="module-header">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            <h3 className="exec-card-title">API Keys & Bot</h3>
          </div>
          <p className="muted small">Use this token to connect the MeetingMetric bot or send transcripts programmatically.</p>
          <div className="api-token-block">
            <label>
              API Token
              <div className="token-row">
                <input type="text" value={apiToken || ''} readOnly className="token-input" />
                <button type="button" className="btn-ghost small" onClick={() => navigator.clipboard.writeText(apiToken || '')}>Copy</button>
              </div>
            </label>
          </div>
          <div className="api-usage-block">
            <h4 className="muted small">Bot endpoint</h4>
            <code className="code-block">POST /api/bot/transcript</code>
            <pre className="raw">{`{
  "apiKey": "<your-token>",
  "title": "Sprint Planning",
  "transcript": [
    { "speaker": "Alice", "text": "Let's start with the backlog." },
    { "speaker": "Bob", "text": "I think we should focus on auth." }
  ]
}`}</pre>
          </div>
        </div>

        {/* Module: Privacy */}
        <div className="exec-card settings-module wide">
          <div className="module-header">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <h3 className="exec-card-title">Privacy & Ethics</h3>
          </div>
          <ul className="settings-list">
            <li>Use MeetingMetric for <strong>development and effectiveness</strong>, not surveillance.</li>
            <li>Obtain <strong>consent</strong> where required before analyzing conversations.</li>
            <li>Scores are <strong>explainable</strong> and transcript-backed.</li>
            <li>The Teams bot announces its presence when joining meetings.</li>
          </ul>
        </div>
      </div>
    </AppShell>
  );
}

export default SettingsPage;
