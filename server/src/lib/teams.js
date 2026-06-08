'use strict';

const msal = require('@azure/msal-node');
const https = require('https');

const SCOPES = [
  'User.Read',
  'Calendars.Read',
  'Calendars.ReadWrite',
  'OnlineMeetings.Read',
  'OnlineMeetingTranscript.Read.All',
];

class TeamsService {
  constructor(db) {
    this.db = db;
    this._msalApp = null;

    this.AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID || '';
    this.AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || '';
    this.AZURE_REDIRECT_URI =
      process.env.AZURE_REDIRECT_URI || 'http://localhost:5200/api/teams/callback';
  }

  _getMsalApp() {
    if (!this._msalApp && this.AZURE_CLIENT_ID) {
      this._msalApp = new msal.ConfidentialClientApplication({
        auth: {
          clientId: this.AZURE_CLIENT_ID,
          clientSecret: this.AZURE_CLIENT_SECRET,
          authority: 'https://login.microsoftonline.com/common',
        },
      });
    }
    return this._msalApp;
  }

  isConfigured() {
    return !!(this.AZURE_CLIENT_ID && this.AZURE_CLIENT_SECRET);
  }

  async getAuthUrl(state) {
    const app = this._getMsalApp();
    if (!app) throw new Error('Azure AD not configured');
    return app.getAuthCodeUrl({
      scopes: SCOPES,
      redirectUri: this.AZURE_REDIRECT_URI,
      state: state || '',
      prompt: 'consent',
    });
  }

  async acquireTokenByCode(code) {
    const app = this._getMsalApp();
    if (!app) throw new Error('Azure AD not configured');
    return app.acquireTokenByCode({
      code,
      scopes: SCOPES,
      redirectUri: this.AZURE_REDIRECT_URI,
    });
  }

  saveTokens(userId, accessToken, expiresAt, refreshToken = null) {
    const existing = this.db
      .prepare('SELECT user_id FROM teams_tokens WHERE user_id = ?')
      .get(userId);
    if (existing) {
      this.db
        .prepare(
          'UPDATE teams_tokens SET access_token = ?, expires_at = ?, refresh_token = ? WHERE user_id = ?'
        )
        .run(accessToken, expiresAt, refreshToken, userId);
    } else {
      this.db
        .prepare(
          'INSERT INTO teams_tokens (user_id, access_token, refresh_token, expires_at) VALUES (?, ?, ?, ?)'
        )
        .run(userId, accessToken, refreshToken, expiresAt);
    }
  }

  getStoredToken(userId) {
    return this.db
      .prepare('SELECT access_token, refresh_token, expires_at FROM teams_tokens WHERE user_id = ?')
      .get(userId);
  }

  deleteTokens(userId) {
    this.db.prepare('DELETE FROM teams_tokens WHERE user_id = ?').run(userId);
  }

  /**
   * Checks expires_at. If within 5 minutes of expiry, attempts refresh.
   * Returns true if token is still valid.
   */
  async refreshTokenIfNeeded(userId) {
    const tok = this.getStoredToken(userId);
    if (!tok || !tok.access_token) return false;

    if (!tok.expires_at) return true; // No expiry info — assume valid

    const expiresAt = new Date(tok.expires_at).getTime();
    const nowPlus5Min = Date.now() + 5 * 60 * 1000;

    if (expiresAt > nowPlus5Min) return true; // Still valid

    // Attempt refresh
    if (!tok.refresh_token) {
      // No refresh token — mark expired
      this.db
        .prepare('UPDATE teams_tokens SET access_token = NULL WHERE user_id = ?')
        .run(userId);
      return false;
    }

    const app = this._getMsalApp();
    if (!app) return false;

    try {
      const result = await app.acquireTokenByRefreshToken({
        refreshToken: tok.refresh_token,
        scopes: SCOPES,
      });
      if (result && result.accessToken) {
        const newExpiry = result.expiresOn
          ? result.expiresOn.toISOString()
          : new Date(Date.now() + 3600000).toISOString();
        this.saveTokens(userId, result.accessToken, newExpiry, result.refreshToken || tok.refresh_token);
        return true;
      }
    } catch {
      // Refresh failed — mark token expired
    }

    this.db
      .prepare('UPDATE teams_tokens SET access_token = NULL WHERE user_id = ?')
      .run(userId);
    return false;
  }

  _graphGet(path, accessToken) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, 'https://graph.microsoft.com');
      const req = https.get(
        url.href,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        },
        (res) => {
          let body = '';
          res.on('data', (d) => (body += d));
          res.on('end', () => {
            if (res.statusCode >= 400) {
              return reject(new Error(`Graph ${res.statusCode}: ${body.slice(0, 300)}`));
            }
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve(body);
            }
          });
        }
      );
      req.on('error', reject);
    });
  }

  _graphGetText(path, accessToken) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, 'https://graph.microsoft.com');
      const req = https.get(
        url.href,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'text/vtt',
          },
        },
        (res) => {
          let body = '';
          res.on('data', (d) => (body += d));
          res.on('end', () => {
            if (res.statusCode >= 400) {
              return reject(new Error(`Graph ${res.statusCode}: ${body.slice(0, 300)}`));
            }
            resolve(body);
          });
        }
      );
      req.on('error', reject);
    });
  }

  async listMeetings(accessToken) {
    const data = await this._graphGet('/v1.0/me/onlineMeetings', accessToken);
    return (data.value || []).map((m) => ({
      id: m.id,
      subject: m.subject || 'Untitled',
      startDateTime: m.startDateTime,
      endDateTime: m.endDateTime,
      joinUrl: m.joinWebUrl,
      participants: (m.participants?.attendees || []).map(
        (a) => a.upn || a.identity?.user?.displayName || ''
      ),
    }));
  }

  async getRecentMeetings(accessToken, afterDateTime) {
    const dt = encodeURIComponent(afterDateTime);
    const data = await this._graphGet(
      `/v1.0/me/onlineMeetings?$filter=startDateTime ge ${dt}`,
      accessToken
    );
    return (data.value || []).map((m) => ({
      id: m.id,
      subject: m.subject || 'Untitled',
      startDateTime: m.startDateTime,
      endDateTime: m.endDateTime,
      joinUrl: m.joinWebUrl,
      participants: (m.participants?.attendees || []).map(
        (a) => a.upn || a.identity?.user?.displayName || ''
      ),
    }));
  }

  async getMeetingTranscripts(accessToken, meetingId) {
    const data = await this._graphGet(
      `/v1.0/me/onlineMeetings/${encodeURIComponent(meetingId)}/transcripts`,
      accessToken
    );
    return (data.value || []).map((t) => ({
      id: t.id,
      createdDateTime: t.createdDateTime,
    }));
  }

  async getTranscriptContent(accessToken, meetingId, transcriptId) {
    return this._graphGetText(
      `/v1.0/me/onlineMeetings/${encodeURIComponent(meetingId)}/transcripts/${encodeURIComponent(transcriptId)}/content?$format=text/vtt`,
      accessToken
    );
  }

  async downloadTranscriptVtt(accessToken, meetingId, transcriptId) {
    return this._graphGetText(
      `/v1.0/me/onlineMeetings/${encodeURIComponent(meetingId)}/transcripts/${encodeURIComponent(transcriptId)}/content?$format=text/vtt`,
      accessToken
    );
  }

  async getCalendarEvents(accessToken, startDate, endDate) {
    const start = encodeURIComponent(startDate);
    const end = encodeURIComponent(endDate);
    const data = await this._graphGet(
      `/v1.0/me/calendarview?startdatetime=${start}&enddatetime=${end}&$top=100&$orderby=start/dateTime&$select=id,subject,start,end,isOnlineMeeting,onlineMeetingUrl,organizer,attendees,bodyPreview`,
      accessToken
    );
    return (data.value || []).map((ev) => ({
      id: ev.id,
      subject: ev.subject || 'Untitled',
      start: ev.start?.dateTime,
      end: ev.end?.dateTime,
      timeZone: ev.start?.timeZone || 'UTC',
      isOnlineMeeting: !!ev.isOnlineMeeting,
      onlineMeetingUrl: ev.onlineMeetingUrl || null,
      organizer:
        ev.organizer?.emailAddress?.name || ev.organizer?.emailAddress?.address || '',
      attendees: (ev.attendees || []).map((a) => ({
        name: a.emailAddress?.name || '',
        email: a.emailAddress?.address || '',
        status: a.status?.response || 'none',
      })),
      bodyPreview: (ev.bodyPreview || '').slice(0, 200),
    }));
  }

  async getUserProfile(accessToken) {
    return this._graphGet(
      '/v1.0/me?$select=displayName,mail,userPrincipalName,jobTitle',
      accessToken
    );
  }

  // Legacy: keep parseVttToPlaintext for backward compat (used nowhere new)
  parseVttToPlaintext(vtt) {
    const { parseVtt } = require('./vttParser');
    const turns = parseVtt(vtt);
    return turns.map((t) => `${t.speaker}: ${t.text}`).join('\n');
  }
}

module.exports = TeamsService;
