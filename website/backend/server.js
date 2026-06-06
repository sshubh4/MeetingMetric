require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const pdfParse = require('pdf-parse');

const db = require('./lib/db');
const {
  createUser,
  getUserByEmail,
  verifyPassword,
  signToken,
  authMiddleware,
} = require('./lib/auth');
const { analyzeTranscript } = require('./lib/analyzePipeline');
const { embedText, cosine } = require('./lib/embeddings');
const teams = require('./lib/teams');

const app = express();
const PORT = process.env.PORT || 5200;
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Allow one or more comma-separated origins via CORS_ORIGIN.
// Each entry is either an exact origin (https://app.vercel.app) or a wildcard
// suffix (*.vercel.app, useful for Vercel preview deployments). Requests with
// no Origin header (curl, server-to-server, same-origin) are always allowed.
const CORS_RULES = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isOriginAllowed(origin) {
  if (!origin) return true;
  return CORS_RULES.some((rule) => {
    if (rule === '*') return true;
    if (rule.startsWith('*.')) {
      try {
        return new URL(origin).hostname.endsWith(rule.slice(1));
      } catch {
        return false;
      }
    }
    return rule === origin;
  });
}

app.use(cors({
  origin: (origin, cb) => cb(null, isOriginAllowed(origin)),
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));

app.use('/uploads', express.static(UPLOADS_DIR));

(async () => {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
})();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
    },
});

const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });

app.post('/api/register', (req, res) => {
  try {
    const { email, password, confirmPassword, fullName, organisation, role } = req.body;
    if (!email || !password || password.length < 6) {
      return res.status(400).json({ error: 'Valid email and password (6+ chars) required' });
    }
    if (confirmPassword !== undefined && confirmPassword !== password) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }
    if (!fullName || !fullName.trim()) {
      return res.status(400).json({ error: 'Full name is required' });
    }
    if (getUserByEmail(email)) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    const user = createUser(email, password, {
      fullName: (fullName || '').trim(),
      organisation: (organisation || '').trim() || null,
      role: (role || '').trim() || null,
    });
    const token = signToken(user.id, user.email);
    res.status(201).json({ token, user: { id: user.id, email: user.email, fullName: user.fullName } });
  } catch (e) {
    const msg = e.message?.includes('UNIQUE') ? 'Email already registered' : 'Registration failed';
    res.status(500).json({ error: msg });
  }
});

app.post('/api/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const user = getUserByEmail(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = signToken(user.id, user.email);
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/meetings/analyze', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    let rawText = req.body.text || '';
    const title = (req.body.title || 'Untitled meeting').slice(0, 200);
    let projectId = req.body.project_id ? parseInt(req.body.project_id, 10) : null;
    if (Number.isNaN(projectId)) projectId = null;
    if (projectId) {
      const p = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(projectId, req.user.id);
      if (!p) projectId = null;
    }
    let scheduledAt = null;
    if (req.body.scheduled_at && String(req.body.scheduled_at).trim()) {
      const d = new Date(req.body.scheduled_at);
      if (!Number.isNaN(d.getTime())) scheduledAt = d.toISOString();
    }

    if (req.file) {
      const buf = await fs.readFile(req.file.path);
      if (req.file.mimetype === 'application/pdf' || req.file.originalname.endsWith('.pdf')) {
        const data = await pdfParse(buf);
        rawText += (rawText ? '\n\n' : '') + data.text;
      } else {
        rawText += (rawText ? '\n\n' : '') + buf.toString('utf8');
      }
      fs.unlink(req.file.path).catch(() => {});
    }

    rawText = rawText.trim();
    if (!rawText) {
      return res.status(400).json({ error: 'Provide transcript text or a file' });
    }

    const analysis = await analyzeTranscript(rawText, title);
    const created_at = new Date().toISOString();

    const rowM = db
      .prepare(`
      INSERT INTO meetings (user_id, title, raw_text, summary, efficiency_score, dominant_speaker_alert, low_engagement_alert, created_at, project_id, scheduled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
    `)
      .get(
        req.user.id,
        title,
        rawText,
        analysis.summary,
        analysis.efficiency_score,
        analysis.dominant_speaker_alert,
        analysis.low_engagement_alert,
        created_at,
        projectId,
        scheduledAt
      );
    const meetingId = rowM.id;

    const insertS = db.prepare(`
      INSERT INTO speaker_results (meeting_id, speaker_name, word_count, turn_count, talk_ratio, scores_json, utterance_breakdown_json, coaching_text, embedding_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const s of analysis.speakers) {
      insertS.run(
        meetingId,
        s.speaker_name,
        s.word_count,
        s.turn_count,
        s.talk_ratio,
        JSON.stringify(s.scores),
        JSON.stringify(s.utterance_breakdown),
        s.coaching_text,
        s.embedding_json
      );
    }

    const insertC = db.prepare(`
      INSERT INTO meeting_chunks (meeting_id, chunk_index, text_snippet, embedding_json)
      VALUES (?, ?, ?, ?)
    `);
    for (const c of analysis.chunkEmbeddings) {
      insertC.run(meetingId, c.chunk_index, c.text_snippet, c.embedding_json);
    }

    res.status(201).json({
      meetingId,
      meeting: formatMeeting(meetingId, req.user.id),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Analysis failed' });
  }
});

function formatMeetingRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    efficiency_score: row.efficiency_score,
    dominant_speaker_alert: !!row.dominant_speaker_alert,
    low_engagement_alert: !!row.low_engagement_alert,
    created_at: row.created_at,
    scheduled_at: row.scheduled_at || null,
    project_id: row.project_id ?? null,
    project_name: row.project_name || null,
    project_color: row.project_color || null,
  };
}

function formatMeeting(meetingId, userId) {
  const row = db
    .prepare(
      `SELECT m.*, p.name AS project_name, p.color AS project_color
       FROM meetings m
       LEFT JOIN projects p ON p.id = m.project_id
       WHERE m.id = ? AND m.user_id = ?`
    )
    .get(meetingId, userId);
  if (!row) return null;
  const speakers = db
    .prepare(`SELECT * FROM speaker_results WHERE meeting_id = ? ORDER BY talk_ratio DESC`)
    .all(meetingId)
    .map((s) => ({
      speaker_name: s.speaker_name,
      word_count: s.word_count,
      turn_count: s.turn_count,
      talk_ratio: s.talk_ratio,
      scores: JSON.parse(s.scores_json),
      utterance_breakdown: JSON.parse(s.utterance_breakdown_json),
      coaching_text: s.coaching_text,
    }));
  return {
    ...formatMeetingRow(row),
    raw_text: row.raw_text,
    speakers,
  };
}

app.get('/api/meetings', authMiddleware, (req, res) => {
  const rows = db
    .prepare(
      `SELECT m.id, m.title, m.summary, m.efficiency_score, m.dominant_speaker_alert, m.low_engagement_alert,
              m.created_at, m.scheduled_at, m.project_id, p.name AS project_name, p.color AS project_color
       FROM meetings m
       LEFT JOIN projects p ON p.id = m.project_id
       WHERE m.user_id = ? ORDER BY m.created_at DESC`
    )
    .all(req.user.id);
  res.json(rows.map(formatMeetingRow));
});

app.get('/api/meetings/:id', authMiddleware, (req, res) => {
  const m = formatMeeting(req.params.id, req.user.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.json(m);
});

app.get('/api/dashboard', authMiddleware, (req, res) => {
  const meetings = db
    .prepare(
      `SELECT id, efficiency_score, created_at FROM meetings WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
    )
    .all(req.user.id);

  const speakers = db
    .prepare(
      `SELECT sr.speaker_name, sr.scores_json, sr.talk_ratio, sr.word_count, m.created_at
       FROM speaker_results sr
       JOIN meetings m ON m.id = sr.meeting_id
       WHERE m.user_id = ?
       ORDER BY m.created_at DESC`
    )
    .all(req.user.id);

  const bySpeaker = new Map();
  for (const { speaker_name, scores_json, talk_ratio, word_count, created_at } of speakers) {
    if (!bySpeaker.has(speaker_name)) {
      bySpeaker.set(speaker_name, {
        name: speaker_name,
        engagements: [],
        talkRatios: [],
        wordCounts: [],
      });
    }
    const b = bySpeaker.get(speaker_name);
    const scores = JSON.parse(scores_json);
    b.engagements.push(scores.engagement);
    b.talkRatios.push(talk_ratio);
    b.wordCounts.push(word_count);
  }

  const participantSummaries = [];
  for (const [, v] of bySpeaker) {
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / Math.max(arr.length, 1);
    participantSummaries.push({
      name: v.name,
      avgEngagement: Math.round(avg(v.engagements) * 100) / 100,
      avgTalkRatio: Math.round(avg(v.talkRatios) * 100) / 100,
      meetingsCount: v.engagements.length,
    });
  }
  participantSummaries.sort((a, b) => b.avgEngagement - a.avgEngagement);

  const efficiencyTrend = meetings.map((m) => ({
    date: m.created_at,
    efficiency: m.efficiency_score,
    id: m.id,
  }));

  const last30 = db
    .prepare(
      `SELECT COUNT(*) AS c, AVG(efficiency_score) AS avg_eff
       FROM meetings WHERE user_id = ? AND datetime(created_at) > datetime('now', '-30 day')`
    )
    .get(req.user.id);

  const uniqueParticipants = db
    .prepare(
      `SELECT COUNT(DISTINCT sr.speaker_name) AS c
       FROM speaker_results sr
       JOIN meetings m ON m.id = sr.meeting_id
       WHERE m.user_id = ?`
    )
    .get(req.user.id).c;

  let engSum = 0;
  let engN = 0;
  for (const row of speakers) {
    try {
      const sc = JSON.parse(row.scores_json);
      if (typeof sc.engagement === 'number') {
        engSum += sc.engagement;
        engN += 1;
      }
    } catch {
      /* skip */
    }
  }
  const liveParticipation = engN ? Math.round((engSum / engN) * 100) : null;

  res.json({
    meetingCount: meetings.length,
    efficiencyTrend,
    participantSummaries,
    executiveStats: {
      meetingsLast30: last30?.c ?? 0,
      avgEfficiencyLast30: last30?.avg_eff != null ? Math.round(last30.avg_eff * 100) / 100 : null,
      uniqueParticipants: uniqueParticipants || 0,
      liveParticipationPercent: liveParticipation,
    },
    alerts: {
      recentDominance: meetings.filter((m) => m.id).length
        ? db
            .prepare(
              `SELECT COUNT(*) as c FROM meetings WHERE user_id = ? AND dominant_speaker_alert = 1 AND datetime(created_at) > datetime('now', '-30 day')`
            )
            .get(req.user.id).c
        : 0,
      recentLowEngagement: db
        .prepare(
          `SELECT COUNT(*) as c FROM meetings WHERE user_id = ? AND low_engagement_alert = 1 AND datetime(created_at) > datetime('now', '-30 day')`
        )
        .get(req.user.id).c,
    },
  });
});

app.get('/api/calendar', authMiddleware, (req, res) => {
  const month = (req.query.month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Query month=YYYY-MM required' });
  }
  const [y, mo] = month.split('-').map(Number);
  const start = new Date(y, mo - 1, 1);
  const end = new Date(y, mo, 0, 23, 59, 59, 999);
  const rows = db
    .prepare(
      `SELECT m.id, m.title, m.efficiency_score, m.created_at, m.scheduled_at, m.project_id, p.name AS project_name, p.color AS project_color
       FROM meetings m
       LEFT JOIN projects p ON p.id = m.project_id
       WHERE m.user_id = ?`
    )
    .all(req.user.id);
  const inMonth = rows.filter((r) => {
    const d = new Date(r.scheduled_at || r.created_at);
    return d >= start && d <= end;
  });
  res.json({
    month,
    meetings: inMonth.map((r) => ({
      ...formatMeetingRow(r),
      calendar_date: r.scheduled_at || r.created_at,
    })),
  });
});

app.get('/api/projects', authMiddleware, (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.description, p.color, p.created_at,
              (SELECT COUNT(*) FROM meetings m WHERE m.project_id = p.id) AS meeting_count
       FROM projects p WHERE p.user_id = ? ORDER BY p.created_at DESC`
    )
    .all(req.user.id);
  res.json(rows);
});

app.post('/api/projects', authMiddleware, (req, res) => {
  const name = (req.body.name || '').trim().slice(0, 120);
  if (!name) return res.status(400).json({ error: 'Project name required' });
  const description = (req.body.description || '').trim().slice(0, 2000) || null;
  const color = (req.body.color || '#3b82f6').slice(0, 20);
  const created_at = new Date().toISOString();
  const row = db
    .prepare(
      'INSERT INTO projects (user_id, name, description, color, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id'
    )
    .get(req.user.id, name, description, color, created_at);
  res.status(201).json({ id: row.id, name, description, color, created_at });
});

app.post('/api/search', authMiddleware, async (req, res) => {
  try {
    const q = (req.body.query || '').trim();
    if (!q) return res.status(400).json({ error: 'query required' });

    const rows = db
      .prepare(
        `SELECT mc.text_snippet, mc.embedding_json, mc.meeting_id, m.title
         FROM meeting_chunks mc
         JOIN meetings m ON m.id = mc.meeting_id
         WHERE m.user_id = ?`
      )
      .all(req.user.id);

    if (rows.length === 0) {
      return res.json({ results: [], message: 'No indexed chunks yet. Analyze meetings with USE_ML=true (default).' });
    }

    const qVec = await embedText(q);
    if (!qVec) {
      return res.json({
        results: [],
        message: 'Embeddings disabled (set USE_ML=1) or model unavailable.',
      });
    }

    const scored = rows
      .map((r) => {
        let vec;
        try {
          vec = JSON.parse(r.embedding_json);
        } catch {
          return null;
        }
        return {
          score: cosine(qVec, vec),
          text_snippet: r.text_snippet,
          meeting_id: r.meeting_id,
          title: r.title,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    res.json({ results: scored });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/team/participants', authMiddleware, (req, res) => {
  try {
    const { from, to, project_id } = req.query;

    let meetingFilter = 'WHERE m.user_id = ?';
    const params = [req.user.id];

    if (from) {
      meetingFilter += ' AND date(COALESCE(m.scheduled_at, m.created_at)) >= date(?)';
      params.push(from);
    }
    if (to) {
      meetingFilter += ' AND date(COALESCE(m.scheduled_at, m.created_at)) <= date(?)';
      params.push(to);
    }
    if (project_id) {
      meetingFilter += ' AND m.project_id = ?';
      params.push(Number(project_id));
    }

    const rows = db.prepare(`
      SELECT sr.speaker_name, sr.scores_json, sr.talk_ratio, sr.word_count, sr.turn_count,
             sr.coaching_text, m.id AS meeting_id, m.title AS meeting_title,
             COALESCE(m.scheduled_at, m.created_at) AS meeting_date,
             m.project_id, p.name AS project_name, p.color AS project_color
      FROM speaker_results sr
      JOIN meetings m ON m.id = sr.meeting_id
      LEFT JOIN projects p ON p.id = m.project_id
      ${meetingFilter}
      ORDER BY meeting_date DESC
    `).all(...params);

    const byName = new Map();
    for (const r of rows) {
      if (!byName.has(r.speaker_name)) {
        byName.set(r.speaker_name, { name: r.speaker_name, meetings: [], projects: new Set() });
      }
      const entry = byName.get(r.speaker_name);
      const scores = JSON.parse(r.scores_json);
      entry.meetings.push({
        meeting_id: r.meeting_id,
        meeting_title: r.meeting_title,
        meeting_date: r.meeting_date,
        project_id: r.project_id,
        project_name: r.project_name,
        project_color: r.project_color,
        scores,
        talk_ratio: r.talk_ratio,
        word_count: r.word_count,
        turn_count: r.turn_count,
        coaching_text: r.coaching_text,
      });
      if (r.project_name) entry.projects.add(r.project_name);
    }

    const participants = [];
    for (const [, v] of byName) {
      const avg = (arr) => arr.reduce((a, b) => a + b, 0) / Math.max(arr.length, 1);
      const engagements = v.meetings.map((m) => m.scores.engagement ?? 0);
      const sentiments = v.meetings.map((m) => m.scores.sentiment ?? 0);
      const collaborations = v.meetings.map((m) => m.scores.collaboration ?? 0);
      const initiatives = v.meetings.map((m) => m.scores.initiative ?? 0);
      const clarities = v.meetings.map((m) => m.scores.clarity ?? 0);
      participants.push({
        name: v.name,
        meeting_count: v.meetings.length,
        projects: [...v.projects],
        avg_engagement: Math.round(avg(engagements) * 100) / 100,
        avg_sentiment: Math.round(avg(sentiments) * 100) / 100,
        avg_collaboration: Math.round(avg(collaborations) * 100) / 100,
        avg_initiative: Math.round(avg(initiatives) * 100) / 100,
        avg_clarity: Math.round(avg(clarities) * 100) / 100,
        avg_talk_ratio: Math.round(avg(v.meetings.map((m) => m.talk_ratio)) * 100) / 100,
        total_words: v.meetings.reduce((s, m) => s + m.word_count, 0),
        meetings: v.meetings,
      });
    }

    participants.sort((a, b) => b.meeting_count - a.meeting_count);
    res.json(participants);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/meetings/:id/project', authMiddleware, (req, res) => {
  try {
    const meetingId = Number(req.params.id);
    const projectId = req.body.project_id != null ? Number(req.body.project_id) : null;
    const row = db.prepare('SELECT id FROM meetings WHERE id = ? AND user_id = ?').get(meetingId, req.user.id);
    if (!row) return res.status(404).json({ error: 'Meeting not found' });
    if (projectId) {
      const p = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(projectId, req.user.id);
      if (!p) return res.status(404).json({ error: 'Project not found' });
    }
    db.prepare('UPDATE meetings SET project_id = ? WHERE id = ?').run(projectId, meetingId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/projects/:id/detail', authMiddleware, (req, res) => {
  try {
    const pid = Number(req.params.id);
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(pid, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const meetings = db.prepare(`
      SELECT m.id, m.title, m.efficiency_score, m.created_at, m.scheduled_at
      FROM meetings m WHERE m.project_id = ? AND m.user_id = ?
      ORDER BY COALESCE(m.scheduled_at, m.created_at) DESC
    `).all(pid, req.user.id);

    const speakers = db.prepare(`
      SELECT sr.speaker_name, sr.scores_json, sr.talk_ratio, sr.word_count, sr.turn_count, m.id AS meeting_id
      FROM speaker_results sr
      JOIN meetings m ON m.id = sr.meeting_id
      WHERE m.project_id = ? AND m.user_id = ?
    `).all(pid, req.user.id);

    const byName = new Map();
    for (const s of speakers) {
      if (!byName.has(s.speaker_name)) byName.set(s.speaker_name, []);
      byName.get(s.speaker_name).push({ ...s, scores: JSON.parse(s.scores_json) });
    }

    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / Math.max(arr.length, 1);
    const participantStats = [];
    for (const [name, rows] of byName) {
      participantStats.push({
        name,
        meeting_count: rows.length,
        avg_engagement: Math.round(avg(rows.map((r) => r.scores.engagement ?? 0)) * 100) / 100,
        avg_sentiment: Math.round(avg(rows.map((r) => r.scores.sentiment ?? 0)) * 100) / 100,
        avg_collaboration: Math.round(avg(rows.map((r) => r.scores.collaboration ?? 0)) * 100) / 100,
        avg_initiative: Math.round(avg(rows.map((r) => r.scores.initiative ?? 0)) * 100) / 100,
        avg_clarity: Math.round(avg(rows.map((r) => r.scores.clarity ?? 0)) * 100) / 100,
      });
    }
    participantStats.sort((a, b) => b.avg_engagement - a.avg_engagement);

    res.json({
      project: { id: project.id, name: project.name, description: project.description, color: project.color },
      meetings: meetings.map((m) => ({
        ...m,
        scheduled_at: m.scheduled_at || null,
      })),
      participants: participantStats,
      avg_efficiency: meetings.length
        ? Math.round(avg(meetings.map((m) => m.efficiency_score ?? 0)) * 100) / 100
        : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/teams/status', authMiddleware, (req, res) => {
  if (!teams.isConfigured()) {
    return res.json({ configured: false, connected: false });
  }
  const tok = teams.getStoredToken(req.user.id);
  const connected = !!(tok && tok.access_token);
  res.json({ configured: true, connected });
});

app.get('/api/teams/connect', authMiddleware, async (req, res) => {
  try {
    if (!teams.isConfigured()) {
      return res.status(501).json({ error: 'Azure AD not configured on server (set AZURE_CLIENT_ID / AZURE_CLIENT_SECRET)' });
    }
    const state = Buffer.from(
      JSON.stringify({ userId: req.user.id, token: req.headers.authorization.slice(7) })
    ).toString('base64url');
    const url = await teams.getAuthUrl(state);
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/teams/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send('Missing code or state');
    let parsed;
    try {
      parsed = JSON.parse(Buffer.from(state, 'base64url').toString());
    } catch {
      return res.status(400).send('Invalid state');
    }
    const result = await teams.acquireTokenByCode(code);
    const expiresOn = result.expiresOn ? result.expiresOn.toISOString() : new Date(Date.now() + 3600000).toISOString();
    teams.saveTokens(parsed.userId, result.accessToken, expiresOn);
    const frontendBase = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendBase}/settings?teams=connected`);
  } catch (e) {
    console.error('Teams callback error:', e);
    const frontendBase = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendBase}/settings?teams=error&msg=${encodeURIComponent(e.message)}`);
  }
});

app.get('/api/teams/meetings', authMiddleware, async (req, res) => {
  try {
    const tok = teams.getStoredToken(req.user.id);
    if (!tok || !tok.access_token) {
      return res.status(401).json({ error: 'Connect Microsoft Teams first' });
    }
    const meetings = await teams.listMeetings(tok.access_token);
    res.json(meetings);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/teams/import', authMiddleware, async (req, res) => {
  try {
    const tok = teams.getStoredToken(req.user.id);
    if (!tok || !tok.access_token) {
      return res.status(401).json({ error: 'Connect Microsoft Teams first' });
    }
    const { meetingId, subject } = req.body;
    if (!meetingId) return res.status(400).json({ error: 'meetingId required' });

    const transcripts = await teams.getMeetingTranscripts(tok.access_token, meetingId);
    if (!transcripts.length) {
      return res.status(404).json({ error: 'No transcripts found for this meeting. Ensure transcription was enabled.' });
    }
    const vtt = await teams.getTranscriptContent(
      tok.access_token,
      meetingId,
      transcripts[0].id
    );
    const rawText = teams.parseVttToPlaintext(vtt);
    if (!rawText.trim()) {
      return res.status(404).json({ error: 'Transcript was empty after parsing' });
    }

    const title = (subject || 'Teams meeting').slice(0, 200);
    const analysis = await analyzeTranscript(rawText, title);
    const created_at = new Date().toISOString();
    const scheduledAt = transcripts[0].createdDateTime || null;

    const rowM = db
      .prepare(`
      INSERT INTO meetings (user_id, title, raw_text, summary, efficiency_score, dominant_speaker_alert, low_engagement_alert, created_at, project_id, scheduled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
    `)
      .get(
        req.user.id,
        title,
        rawText,
        analysis.summary,
        analysis.efficiency_score,
        analysis.dominant_speaker_alert,
        analysis.low_engagement_alert,
        created_at,
        null,
        scheduledAt
      );
    const newMeetingId = rowM.id;

    const insertS = db.prepare(`
      INSERT INTO speaker_results (meeting_id, speaker_name, word_count, turn_count, talk_ratio, scores_json, utterance_breakdown_json, coaching_text, embedding_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const s of analysis.speakers) {
      insertS.run(
        newMeetingId,
        s.speaker_name,
        s.word_count,
        s.turn_count,
        s.talk_ratio,
        JSON.stringify(s.scores),
        JSON.stringify(s.utterance_breakdown),
        s.coaching_text,
        s.embedding_json
      );
    }

    const insertC = db.prepare(`
      INSERT INTO meeting_chunks (meeting_id, chunk_index, text_snippet, embedding_json)
      VALUES (?, ?, ?, ?)
    `);
    for (const c of analysis.chunkEmbeddings) {
      insertC.run(newMeetingId, c.chunk_index, c.text_snippet, c.embedding_json);
    }

    res.status(201).json({
      meetingId: newMeetingId,
      meeting: formatMeeting(newMeetingId, req.user.id),
    });
  } catch (e) {
    console.error('Teams import error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/teams/disconnect', authMiddleware, (req, res) => {
  teams.deleteTokens(req.user.id);
  res.json({ ok: true });
});

app.get('/api/teams/calendar', authMiddleware, async (req, res) => {
  try {
    const tok = teams.getStoredToken(req.user.id);
    if (!tok || !tok.access_token) {
      return res.status(401).json({ error: 'Connect Microsoft Teams first' });
    }
    const { start, end } = req.query;
    const startDate = start || new Date(Date.now() - 30 * 86400000).toISOString();
    const endDate = end || new Date(Date.now() + 30 * 86400000).toISOString();
    const events = await teams.getCalendarEvents(tok.access_token, startDate, endDate);
    res.json(events);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/teams/profile', authMiddleware, async (req, res) => {
  try {
    const tok = teams.getStoredToken(req.user.id);
    if (!tok || !tok.access_token) {
      return res.status(401).json({ error: 'Not connected' });
    }
    const profile = await teams.getUserProfile(tok.access_token);
    res.json(profile);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/user/profile', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, email, full_name, organisation, role, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const teamsConnected = !!(teams.getStoredToken(req.user.id)?.access_token);
  res.json({ ...user, teams_connected: teamsConnected, teams_configured: teams.isConfigured() });
});

app.patch('/api/user/profile', authMiddleware, (req, res) => {
  try {
    const { fullName, organisation, role } = req.body;
    const updates = [];
    const params = [];
    if (fullName !== undefined) { updates.push('full_name = ?'); params.push(fullName.trim() || null); }
    if (organisation !== undefined) { updates.push('organisation = ?'); params.push(organisation.trim() || null); }
    if (role !== undefined) { updates.push('role = ?'); params.push(role.trim() || null); }
    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    params.push(req.user.id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const user = db.prepare('SELECT id, email, full_name, organisation, role FROM users WHERE id = ?').get(req.user.id);
    res.json(user);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/bot/transcript', async (req, res) => {
  try {
    const { meetingId, transcript, title, participants, apiKey } = req.body;
    if (!transcript || !apiKey) {
      return res.status(400).json({ error: 'transcript and apiKey required' });
    }
    const payload = require('./lib/auth').verifyToken(apiKey);
    if (!payload) return res.status(401).json({ error: 'Invalid API key' });
    const userId = payload.sub;

    const rawText = typeof transcript === 'string'
      ? transcript
      : (transcript || []).map((t) => `${t.speaker || 'Unknown'}: ${t.text}`).join('\n');

    if (!rawText.trim()) return res.status(400).json({ error: 'Empty transcript' });

    const meetingTitle = (title || 'Teams Live Meeting').slice(0, 200);
    const analysis = await analyzeTranscript(rawText, meetingTitle);
    const created_at = new Date().toISOString();

    const rowM = db.prepare(`
      INSERT INTO meetings (user_id, title, raw_text, summary, efficiency_score, dominant_speaker_alert, low_engagement_alert, created_at, project_id, scheduled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
    `).get(userId, meetingTitle, rawText, analysis.summary, analysis.efficiency_score, analysis.dominant_speaker_alert, analysis.low_engagement_alert, created_at, null, created_at);

    const newId = rowM.id;
    const insertS = db.prepare('INSERT INTO speaker_results (meeting_id, speaker_name, word_count, turn_count, talk_ratio, scores_json, utterance_breakdown_json, coaching_text, embedding_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const s of analysis.speakers) {
      insertS.run(newId, s.speaker_name, s.word_count, s.turn_count, s.talk_ratio, JSON.stringify(s.scores), JSON.stringify(s.utterance_breakdown), s.coaching_text, s.embedding_json);
    }
    const insertC = db.prepare('INSERT INTO meeting_chunks (meeting_id, chunk_index, text_snippet, embedding_json) VALUES (?, ?, ?, ?)');
    for (const c of analysis.chunkEmbeddings) {
      insertC.run(newId, c.chunk_index, c.text_snippet, c.embedding_json);
    }

    res.status(201).json({ meetingId: newId, message: 'Transcript received and analyzed' });
  } catch (e) {
    console.error('Bot transcript error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/reports', authMiddleware, (req, res) => {
  try {
    const { from, to } = req.query;

    let meetingFilter = 'WHERE m.user_id = ?';
    const params = [req.user.id];
    if (from) { meetingFilter += ' AND date(COALESCE(m.scheduled_at, m.created_at)) >= ?'; params.push(from); }
    if (to)   { meetingFilter += ' AND date(COALESCE(m.scheduled_at, m.created_at)) <= ?'; params.push(to); }

    const meetings = db.prepare(`
      SELECT m.id, m.title, m.efficiency_score, m.created_at, m.scheduled_at,
             p.name AS project_name, p.color AS project_color
      FROM meetings m LEFT JOIN projects p ON p.id = m.project_id
      ${meetingFilter}
      ORDER BY COALESCE(m.scheduled_at, m.created_at) ASC
    `).all(...params);

    const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    // Per-meeting dimension averages for trend chart
    const dimensionTrends = meetings.map((m) => {
      const sRows = db.prepare('SELECT scores_json FROM speaker_results WHERE meeting_id = ?').all(m.id);
      const sc = (key) => sRows.length
        ? avg(sRows.map((r) => { try { return JSON.parse(r.scores_json)[key] ?? 0; } catch { return 0; } }))
        : 0;
      return {
        id: m.id,
        title: m.title,
        date: (m.scheduled_at || m.created_at).slice(0, 10),
        efficiency: Math.round((m.efficiency_score ?? 0) * 100),
        engagement:    Math.round(sc('engagement')    * 100),
        sentiment:     Math.round(sc('sentiment')     * 100),
        collaboration: Math.round(sc('collaboration') * 100),
        initiative:    Math.round(sc('initiative')    * 100),
        clarity:       Math.round(sc('clarity')       * 100),
      };
    });

    // Participant aggregation
    const speakerRows = db.prepare(`
      SELECT sr.speaker_name, sr.scores_json, sr.talk_ratio
      FROM speaker_results sr
      JOIN meetings m ON m.id = sr.meeting_id
      ${meetingFilter}
    `).all(...params);

    const byName = new Map();
    for (const r of speakerRows) {
      if (!byName.has(r.speaker_name)) byName.set(r.speaker_name, { name: r.speaker_name, rows: [] });
      byName.get(r.speaker_name).rows.push(r);
    }

    const participants = [];
    for (const [, v] of byName) {
      const scores = v.rows.map((r) => { try { return JSON.parse(r.scores_json); } catch { return {}; } });
      participants.push({
        name:              v.name,
        meeting_count:     v.rows.length,
        avg_engagement:    Math.round(avg(scores.map((s) => s.engagement    ?? 0)) * 100) / 100,
        avg_sentiment:     Math.round(avg(scores.map((s) => s.sentiment     ?? 0)) * 100) / 100,
        avg_collaboration: Math.round(avg(scores.map((s) => s.collaboration ?? 0)) * 100) / 100,
        avg_initiative:    Math.round(avg(scores.map((s) => s.initiative    ?? 0)) * 100) / 100,
        avg_clarity:       Math.round(avg(scores.map((s) => s.clarity       ?? 0)) * 100) / 100,
        avg_talk_ratio:    Math.round(avg(v.rows.map((r) => r.talk_ratio    ?? 0)) * 100) / 100,
      });
    }
    participants.sort((a, b) => b.avg_engagement - a.avg_engagement);

    // Top / bottom meetings by efficiency
    const ranked = [...meetings]
      .filter((m) => m.efficiency_score != null)
      .sort((a, b) => b.efficiency_score - a.efficiency_score);

    const fmt = (m) => ({
      id: m.id,
      title: m.title,
      efficiency: Math.round(m.efficiency_score * 100),
      date: (m.scheduled_at || m.created_at).slice(0, 10),
      project_name: m.project_name || null,
    });

    const topMeetings    = ranked.slice(0, 5).map(fmt);
    const bottomMeetings = ranked.length > 5 ? ranked.slice(-5).reverse().map(fmt) : [];

    // Project breakdown
    const projectMap = new Map();
    for (const m of meetings) {
      const key = m.project_name || 'Unassigned';
      if (!projectMap.has(key)) projectMap.set(key, { name: key, color: m.project_color || '#6b7280', meetings: [] });
      projectMap.get(key).meetings.push(m);
    }
    const projectBreakdown = [];
    for (const [, pv] of projectMap) {
      const eff = pv.meetings.filter((m) => m.efficiency_score != null).map((m) => m.efficiency_score);
      const pSpeakers = pv.meetings.flatMap((m) =>
        db.prepare('SELECT scores_json FROM speaker_results WHERE meeting_id = ?').all(m.id)
      );
      const eng = pSpeakers.map((s) => { try { return JSON.parse(s.scores_json).engagement ?? 0; } catch { return 0; } });
      projectBreakdown.push({
        name:            pv.name,
        color:           pv.color,
        meeting_count:   pv.meetings.length,
        avg_efficiency:  eff.length  ? Math.round(avg(eff)  * 100) : null,
        avg_engagement:  eng.length  ? Math.round(avg(eng)  * 100) : null,
      });
    }

    const allEff = meetings.filter((m) => m.efficiency_score != null).map((m) => m.efficiency_score);
    res.json({
      summary: {
        totalMeetings:    meetings.length,
        avgEfficiency:    allEff.length ? Math.round(avg(allEff) * 100) : null,
        totalParticipants: byName.size,
        dateRange:        meetings.length ? {
          from: (meetings[0].scheduled_at    || meetings[0].created_at).slice(0, 10),
          to:   (meetings[meetings.length - 1].scheduled_at || meetings[meetings.length - 1].created_at).slice(0, 10),
        } : null,
      },
      dimensionTrends,
      topParticipants:    participants.slice(0, 5),
      bottomParticipants: participants.length > 5 ? participants.slice(-5).reverse() : [],
      topMeetings,
      bottomMeetings,
      projectBreakdown,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true, teams: teams.isConfigured() });
});

app.listen(PORT, () => {
  console.log(`MeetingMetric API http://localhost:${PORT}`);

  const seedDemo = require('./seed');
  seedDemo().catch((e) => console.error('Auto-seed failed:', e.message));
});
