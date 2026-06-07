const msal = require('@azure/msal-node');
const https = require('https');
const db = require('./db');

const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID || '';
const AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || '';
const AZURE_REDIRECT_URI =
  process.env.AZURE_REDIRECT_URI || 'http://localhost:5200/api/teams/callback';

const SCOPES = [
  'User.Read',
  'Calendars.Read',
  'Calendars.ReadWrite',
  'OnlineMeetings.Read',
  'OnlineMeetingTranscript.Read.All',
];

let msalApp = null;

function getMsalApp() {
  if (!msalApp && AZURE_CLIENT_ID) {
    msalApp = new msal.ConfidentialClientApplication({
      auth: {
        clientId: AZURE_CLIENT_ID,
        clientSecret: AZURE_CLIENT_SECRET,
        authority: 'https://login.microsoftonline.com/common',
      },
    });
  }
  return msalApp;
}

function isConfigured() {
  return !!(AZURE_CLIENT_ID && AZURE_CLIENT_SECRET);
}

async function getAuthUrl(state) {
  const app = getMsalApp();
  if (!app) throw new Error('Azure AD not configured');
  return app.getAuthCodeUrl({
    scopes: SCOPES,
    redirectUri: AZURE_REDIRECT_URI,
    state: state || '',
    prompt: 'consent',
  });
}

async function acquireTokenByCode(code) {
  const app = getMsalApp();
  if (!app) throw new Error('Azure AD not configured');
  return app.acquireTokenByCode({
    code,
    scopes: SCOPES,
    redirectUri: AZURE_REDIRECT_URI,
  });
}

function saveTokens(userId, accessToken, expiresOn) {
  const existing = db
    .prepare('SELECT user_id FROM teams_tokens WHERE user_id = ?')
    .get(userId);
  if (existing) {
    db.prepare(
      'UPDATE teams_tokens SET access_token = ?, expires_at = ? WHERE user_id = ?'
    ).run(accessToken, expiresOn, userId);
  } else {
    db.prepare(
      'INSERT INTO teams_tokens (user_id, access_token, refresh_token, expires_at) VALUES (?, ?, ?, ?)'
    ).run(userId, accessToken, null, expiresOn);
  }
}

function getStoredToken(userId) {
  return db
    .prepare('SELECT access_token, expires_at FROM teams_tokens WHERE user_id = ?')
    .get(userId);
}

function graphGet(path, accessToken) {
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

function graphGetText(path, accessToken) {
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

async function listMeetings(accessToken) {
  const data = await graphGet('/v1.0/me/onlineMeetings', accessToken);
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

async function getMeetingTranscripts(accessToken, meetingId) {
  const data = await graphGet(
    `/v1.0/me/onlineMeetings/${encodeURIComponent(meetingId)}/transcripts`,
    accessToken
  );
  return (data.value || []).map((t) => ({
    id: t.id,
    createdDateTime: t.createdDateTime,
  }));
}

async function getTranscriptContent(accessToken, meetingId, transcriptId) {
  return graphGetText(
    `/v1.0/me/onlineMeetings/${encodeURIComponent(meetingId)}/transcripts/${encodeURIComponent(transcriptId)}/content?$format=text/vtt`,
    accessToken
  );
}

function parseVttToPlaintext(vtt) {
  const lines = vtt.split(/\r?\n/);
  const result = [];
  for (const line of lines) {
    if (/^\d{2}:\d{2}/.test(line)) continue;
    if (/^WEBVTT/.test(line) || /^NOTE/.test(line) || !line.trim()) continue;
    const voiceMatch = line.match(/<v\s+([^>]+)>([^<]*)<\/v>/);
    if (voiceMatch) {
      result.push(`${voiceMatch[1]}: ${voiceMatch[2].trim()}`);
    } else if (line.trim() && !/^\d+$/.test(line.trim())) {
      result.push(line.trim());
    }
  }
  return result.join('\n');
}

function deleteTokens(userId) {
  db.prepare('DELETE FROM teams_tokens WHERE user_id = ?').run(userId);
}

async function getCalendarEvents(accessToken, startDate, endDate) {
  const start = encodeURIComponent(startDate);
  const end = encodeURIComponent(endDate);
  const data = await graphGet(
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
    organizer: ev.organizer?.emailAddress?.name || ev.organizer?.emailAddress?.address || '',
    attendees: (ev.attendees || []).map((a) => ({
      name: a.emailAddress?.name || '',
      email: a.emailAddress?.address || '',
      status: a.status?.response || 'none',
    })),
    bodyPreview: (ev.bodyPreview || '').slice(0, 200),
  }));
}

async function getUserProfile(accessToken) {
  return graphGet('/v1.0/me?$select=displayName,mail,userPrincipalName,jobTitle', accessToken);
}

module.exports = {
  isConfigured,
  getAuthUrl,
  acquireTokenByCode,
  saveTokens,
  getStoredToken,
  deleteTokens,
  listMeetings,
  getMeetingTranscripts,
  getTranscriptContent,
  parseVttToPlaintext,
  getCalendarEvents,
  getUserProfile,
};
