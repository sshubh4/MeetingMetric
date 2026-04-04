import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AppShell from './AppShell';
import { getTeamsStatus, getTeamsAuthUrl, listTeamsMeetings, importTeamsMeeting } from '../api';

function TeamsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(null);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const s = await getTeamsStatus();
      setStatus(s);
      if (s.connected) {
        const m = await listTeamsMeetings();
        setMeetings(m);
      }
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (searchParams.get('connected')) {
      setSuccessMsg('Microsoft Teams connected successfully!');
    }
    if (searchParams.get('error')) {
      setError(`Connection failed: ${searchParams.get('error')}`);
    }
    load();
  }, [load, searchParams]);

  const handleConnect = async () => {
    try {
      const { url } = await getTeamsAuthUrl();
      window.location.href = url;
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  };

  const handleImport = async (meetingId, subject) => {
    try {
      setImporting(meetingId);
      setError('');
      const result = await importTeamsMeeting(meetingId, subject);
      navigate(`/meeting/${result.meetingId}`);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setImporting(null);
    }
  };

  return (
    <AppShell title="Microsoft Teams" subtitle="Import and analyze meeting transcripts from Teams">
      {error && (
        <div style={{ background: 'rgba(255,80,80,.12)', border: '1px solid rgba(255,80,80,.3)', borderRadius: 10, padding: '12px 18px', color: '#ff6b6b', marginBottom: 20 }}>
          {error}
        </div>
      )}
      {successMsg && (
        <div style={{ background: 'rgba(124,58,237,.1)', border: '1px solid rgba(124,58,237,.3)', borderRadius: 10, padding: '12px 18px', color: '#a78bfa', marginBottom: 20 }}>
          {successMsg}
        </div>
      )}

      {loading ? (
        <p style={{ color: '#8b97b0' }}>Loading…</p>
      ) : !status?.configured ? (
        <div className="teams-placeholder">
          <div style={{ fontSize: 48, marginBottom: 12 }}>⊞</div>
          <h2 style={{ marginBottom: 8 }}>Teams integration not configured</h2>
          <p style={{ color: '#8b97b0', maxWidth: 480, margin: '0 auto 24px' }}>
            The server does not have Azure AD credentials set. Ask the administrator to set
            <code style={{ color: '#a78bfa' }}> AZURE_CLIENT_ID</code> and
            <code style={{ color: '#a78bfa' }}> AZURE_CLIENT_SECRET</code> environment variables.
          </p>
          <p style={{ color: '#5a6478', fontSize: 13 }}>
            See README → Microsoft Teams Integration for full setup instructions.
          </p>
        </div>
      ) : !status.connected ? (
        <div className="teams-placeholder">
          <div style={{ fontSize: 48, marginBottom: 12 }}>⊞</div>
          <h2 style={{ marginBottom: 8 }}>Connect Microsoft Teams</h2>
          <p style={{ color: '#8b97b0', maxWidth: 480, margin: '0 auto 24px' }}>
            Link your Microsoft account to import meeting transcripts directly from Teams.
            We'll request read-only access to your meetings and transcripts.
          </p>
          <button onClick={handleConnect} className="exec-cta" style={{ display: 'inline-block', fontSize: 16, padding: '12px 32px' }}>
            Connect with Microsoft
          </button>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, color: '#a78bfa' }}>
            <span style={{ fontSize: 20 }}>●</span>
            <span>Teams connected</span>
          </div>

          {meetings.length === 0 ? (
            <p style={{ color: '#8b97b0' }}>No online meetings found in your Teams account.</p>
          ) : (
            <div className="teams-table-wrap">
              <table className="teams-table">
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Date</th>
                    <th>Participants</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {meetings.map((m) => (
                    <tr key={m.id}>
                      <td style={{ fontWeight: 600 }}>{m.subject}</td>
                      <td style={{ color: '#8b97b0' }}>
                        {m.startDateTime
                          ? new Date(m.startDateTime).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '—'}
                      </td>
                      <td style={{ color: '#8b97b0', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.participants?.join(', ') || '—'}
                      </td>
                      <td>
                        <button
                          className="exec-cta"
                          style={{ padding: '6px 16px', fontSize: 13 }}
                          disabled={importing === m.id}
                          onClick={() => handleImport(m.id, m.subject)}
                        >
                          {importing === m.id ? 'Importing…' : 'Import & Analyze'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}

export default TeamsPage;
