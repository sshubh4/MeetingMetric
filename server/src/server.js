require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const pdfParse = require('pdf-parse');
const pino = require('pino');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const PDFDocument = require('pdfkit');

const db = require('./lib/db');
const { resolveAliases } = require('./lib/db');
const {
  createUser,
  getUserByEmail,
  verifyPassword,
  signToken,
  verifyToken,
  hashPassword,
} = require('./lib/auth');
const { runMeetingPipeline } = require('./lib/analyzePipeline');
const { embedText, cosine } = require('./lib/embeddings');
const TeamsService = require('./lib/teams');
const PollService = require('./lib/pollService');
const { requireAuth, requireRole } = require('./middleware/auth');

// ── Logger ────────────────────────────────────────────────────────────────────

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// ── Environment validation ────────────────────────────────────────────────────

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  if (process.env.NODE_ENV === 'production') {
    logger.error('JWT_SECRET must be set and at least 32 characters. Exiting.');
    process.exit(1);
  } else {
    logger.warn('JWT_SECRET not set or too short — using insecure default. Set JWT_SECRET in .env for production.');
  }
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
const PORT = process.env.PORT || 5200;
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// CORS
const CORS_RULES = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isOriginAllowed(origin) {
  if (!origin) return true;
  return CORS_RULES.some((rule) => {
    if (rule === '*') return true;
    if (rule.startsWith('*.')) {
      try { return new URL(origin).hostname.endsWith(rule.slice(1)); } catch { return false; }
    }
    return rule === origin;
  });
}

app.use(cors({ origin: (origin, cb) => cb(null, isOriginAllowed(origin)), credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));

(async () => { await fs.mkdir(UPLOADS_DIR, { recursive: true }); })();

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info({ method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start });
  });
  next();
});

// Rate limiting on auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 10,
  message: { error: 'Too many requests' },
  skip: () => process.env.NODE_ENV === 'test',
});
app.use('/api/auth', authLimiter);

// File upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
});
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });

// Services
const teamsService = new TeamsService(db);
const pollService = new PollService(db, teamsService);
pollService.setLogger(logger);

// ── Benchmarks cache (5-min TTL) ─────────────────────────────────────────────
const benchmarksCache = new Map();

// ── Zod schemas ───────────────────────────────────────────────────────────────

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1).max(100),
  orgName: z.string().min(1).max(100).optional(),
  inviteToken: z.string().optional(),
  confirmPassword: z.string().optional(),
}).refine((d) => !d.confirmPassword || d.confirmPassword === d.password, {
  message: 'Passwords do not match',
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const AliasSchema = z.object({
  alias: z.string().min(1).max(80),
});

const InviteSchema = z.object({
  role: z.enum(['employee', 'manager', 'hr']),
  email: z.string().email().optional(),
});

const UpdateUserSchema = z.object({
  role: z.enum(['admin', 'hr', 'manager', 'employee']).optional(),
  managerId: z.number().int().nullable().optional(),
});

const ReviewExportSchema = z.object({
  userId: z.number().int(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
});

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    req.body = result.data;
    next();
  };
}

// ── Slug generator ────────────────────────────────────────────────────────────

function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

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
    source: row.source || 'manual',
    org_id: row.org_id || null,
  };
}

function formatMeeting(meetingId, userId) {
  const row = db
    .prepare(
      `SELECT m.*, p.name AS project_name, p.color AS project_color
       FROM meetings m
       LEFT JOIN projects p ON p.id = m.project_id
       WHERE m.id = ? AND (m.user_id = ? OR m.org_id = (SELECT org_id FROM users WHERE id = ?))`
    )
    .get(meetingId, userId, userId);
  if (!row) return null;
  const speakers = db
    .prepare(`SELECT * FROM speaker_results WHERE meeting_id = ? ORDER BY talk_ratio DESC`)
    .all(meetingId)
    .map((s) => ({
      speaker_name: s.speaker_name,
      word_count: s.word_count,
      turn_count: s.turn_count,
      talk_ratio: s.talk_ratio,
      scores: {
        engagement: s.score_engagement ?? 0,
        sentiment: s.score_sentiment ?? 0,
        collaboration: s.score_collaboration ?? 0,
        initiative: s.score_initiative ?? 0,
        clarity: s.score_clarity ?? 0,
      },
      utterance_breakdown: {
        ideas: s.ub_ideas ?? 0,
        questions: s.ub_questions ?? 0,
        decisions: s.ub_decisions ?? 0,
        filler: s.ub_filler ?? 0,
      },
      coaching_text: s.coaching_text,
      user_id: s.user_id || null,
    }));
  return {
    ...formatMeetingRow(row),
    raw_text: row.raw_text,
    speakers,
  };
}

// ── AUTH ENDPOINTS ────────────────────────────────────────────────────────────

// POST /api/auth/register
app.post('/api/auth/register', validate(RegisterSchema), (req, res) => {
  try {
    const { email, password, fullName, orgName, inviteToken } = req.body;

    if (getUserByEmail(email)) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    let orgId = null;
    let role = 'employee';
    let invitedBy = null;
    let joinedAt = null;

    if (inviteToken) {
      const inv = db
        .prepare('SELECT * FROM invite_tokens WHERE token = ?')
        .get(inviteToken);
      if (!inv) return res.status(400).json({ error: 'Invalid invite token' });
      if (inv.used_at) return res.status(400).json({ error: 'Invite token already used' });
      if (new Date(inv.expires_at) < new Date()) {
        return res.status(400).json({ error: 'Invite token expired' });
      }
      orgId = inv.org_id;
      role = inv.role;
      invitedBy = inv.created_by;
      joinedAt = new Date().toISOString();
    } else if (orgName) {
      let slug = generateSlug(orgName);
      // Ensure unique slug
      let attempt = 0;
      while (db.prepare('SELECT id FROM organizations WHERE slug = ?').get(attempt ? `${slug}-${attempt}` : slug)) {
        attempt++;
      }
      if (attempt) slug = `${slug}-${attempt}`;
      const orgRow = db
        .prepare('INSERT INTO organizations (name, slug, created_at) VALUES (?, ?, ?) RETURNING id')
        .get(orgName, slug, new Date().toISOString());
      orgId = orgRow.id;
      role = 'admin';
      joinedAt = new Date().toISOString();
    } else {
      return res.status(400).json({
        error: 'Provide orgName to create a new org or inviteToken to join one',
      });
    }

    const password_hash = hashPassword(password);
    const created_at = new Date().toISOString();
    const em = email.toLowerCase().trim();
    const userRow = db
      .prepare(
        `INSERT INTO users (email, password_hash, created_at, full_name, role, org_id, invited_by, joined_at, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1) RETURNING id`
      )
      .get(em, password_hash, created_at, fullName.trim(), role, orgId, invitedBy, joinedAt);

    const userId = userRow.id;

    // Mark invite token used
    if (inviteToken) {
      db.prepare('UPDATE invite_tokens SET used_at = ?, used_by = ? WHERE token = ?')
        .run(new Date().toISOString(), userId, inviteToken);
    }

    const token = signToken(userId, em, { role, orgId });
    logger.info({ userId, email: em, role, orgId }, 'User registered');
    res.status(201).json({
      token,
      user: { id: userId, email: em, fullName: fullName.trim(), role, orgId },
    });
  } catch (e) {
    const msg = e.message?.includes('UNIQUE') ? 'Email already registered' : 'Registration failed';
    logger.error({ err: e.message }, 'register error');
    res.status(500).json({ error: msg });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', validate(LoginSchema), (req, res) => {
  try {
    const { email, password } = req.body;
    const user = getUserByEmail(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (user.active === 0) {
      return res.status(403).json({ error: 'Account deactivated' });
    }
    const token = signToken(user.id, user.email, { role: user.role || 'employee', orgId: user.org_id });
    logger.info({ userId: user.id, email: user.email }, 'User logged in');
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name || null,
        role: user.role || 'employee',
        orgId: user.org_id || null,
      },
    });
  } catch (e) {
    logger.error({ err: e.message }, 'login error');
    res.status(500).json({ error: 'Login failed' });
  }
});

// Legacy endpoints (backward compat)
app.post('/api/register', (req, res) => {
  req.url = '/api/auth/register';
  app._router.handle(req, res, () => {});
});
app.post('/api/login', (req, res) => {
  req.url = '/api/auth/login';
  app._router.handle(req, res, () => {});
});

// ── ME ENDPOINTS ──────────────────────────────────────────────────────────────

// GET /api/me
app.get('/api/me', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const orgId = req.user.orgId;

    const aliases = db
      .prepare('SELECT alias_name, created_at FROM speaker_aliases WHERE user_id = ? AND org_id = ?')
      .all(userId, orgId || 0);

    // Meetings this user participated in (via speaker_results.user_id)
    const myMeetings = db
      .prepare(
        `SELECT sr.*, m.title, m.created_at AS meeting_created_at, m.scheduled_at, m.efficiency_score
         FROM speaker_results sr
         JOIN meetings m ON m.id = sr.meeting_id
         WHERE sr.user_id = ? AND sr.org_id = ?
         ORDER BY COALESCE(m.scheduled_at, m.created_at) DESC`
      )
      .all(userId, orgId || 0);

    const meetingCount = myMeetings.length;

    const dimKeys = ['engagement', 'sentiment', 'collaboration', 'initiative', 'clarity'];
    const colFor = (k) => `score_${k}`;
    const sumScores = { engagement: 0, sentiment: 0, collaboration: 0, initiative: 0, clarity: 0 };
    let scoreCount = 0;

    const trendAll = [];
    for (const row of myMeetings) {
      for (const k of dimKeys) {
        sumScores[k] += row[colFor(k)] ?? 0;
      }
      scoreCount++;
      trendAll.push({
        meeting_title: row.title,
        meeting_date: row.scheduled_at || row.meeting_created_at,
        scores: {
          engagement: Math.round((row.score_engagement ?? 0) * 100),
          sentiment: Math.round((row.score_sentiment ?? 0) * 100),
          collaboration: Math.round((row.score_collaboration ?? 0) * 100),
          initiative: Math.round((row.score_initiative ?? 0) * 100),
          clarity: Math.round((row.score_clarity ?? 0) * 100),
        },
      });
    }

    const avgScores = {};
    for (const k of dimKeys) {
      avgScores[k] = scoreCount ? Math.round((sumScores[k] / scoreCount) * 100) / 100 : 0;
    }

    const trendLast10 = trendAll.slice(0, 10);

    // Percentiles vs org — one query per dimension, fully in SQL
    const percentiles = {};
    if (orgId) {
      for (const k of dimKeys) {
        const col = colFor(k);
        const row = db
          .prepare(
            `SELECT COUNT(*) AS total, SUM(CASE WHEN ${col} <= ? THEN 1 ELSE 0 END) AS below
             FROM speaker_results
             WHERE org_id = ? AND ${col} IS NOT NULL`
          )
          .get(avgScores[k], orgId);
        percentiles[k] = row.total ? Math.round((row.below / row.total) * 100) : 50;
      }
    } else {
      for (const k of dimKeys) percentiles[k] = 50;
    }

    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        fullName: req.user.fullName,
        role: req.user.role,
        orgId,
      },
      aliases,
      stats: {
        meetingCount,
        avgScores,
        trendLast10,
        percentiles,
      },
    });
  } catch (e) {
    logger.error({ err: e.message }, '/api/me error');
    res.status(500).json({ error: e.message });
  }
});

// GET /api/me/aliases
app.get('/api/me/aliases', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT alias_name, created_at FROM speaker_aliases WHERE user_id = ? AND org_id = ?')
    .all(req.user.id, req.user.orgId || 0);
  res.json(rows);
});

// POST /api/me/aliases
app.post('/api/me/aliases', requireAuth, validate(AliasSchema), (req, res) => {
  try {
    const { alias } = req.body;
    const orgId = req.user.orgId || 0;
    const created_at = new Date().toISOString();

    db.prepare(
      'INSERT INTO speaker_aliases (user_id, org_id, alias_name, created_at) VALUES (?, ?, ?, ?)'
    ).run(req.user.id, orgId, alias, created_at);

    // Backfill historical speaker_results
    db.prepare(
      'UPDATE speaker_results SET user_id = ? WHERE speaker_name = ? AND org_id = ? AND user_id IS NULL'
    ).run(req.user.id, alias, orgId);

    logger.info({ userId: req.user.id, alias, orgId }, 'Alias added');
    res.status(201).json({ alias_name: alias, created_at });
  } catch (e) {
    if (e.message?.includes('UNIQUE')) {
      return res.status(400).json({ error: 'This alias is already claimed by another user in your organization' });
    }
    logger.error({ err: e.message }, 'add alias error');
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/me/aliases/:alias
app.delete('/api/me/aliases/:alias', requireAuth, (req, res) => {
  try {
    const alias = req.params.alias;
    const orgId = req.user.orgId || 0;

    const row = db
      .prepare('SELECT id FROM speaker_aliases WHERE user_id = ? AND org_id = ? AND alias_name = ?')
      .get(req.user.id, orgId, alias);
    if (!row) return res.status(404).json({ error: 'Alias not found' });

    db.prepare(
      'DELETE FROM speaker_aliases WHERE user_id = ? AND org_id = ? AND alias_name = ?'
    ).run(req.user.id, orgId, alias);

    // Un-claim historical speaker_results
    db.prepare(
      'UPDATE speaker_results SET user_id = NULL WHERE speaker_name = ? AND org_id = ? AND user_id = ?'
    ).run(alias, orgId, req.user.id);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ORG ENDPOINTS ─────────────────────────────────────────────────────────────

// GET /api/org/roster
app.get('/api/org/roster', requireAuth, requireRole('hr', 'admin'), (req, res) => {
  try {
    const orgId = req.user.orgId;
    if (!orgId) return res.status(400).json({ error: 'No organization assigned' });

    const users = db
      .prepare(
        `SELECT u.id, u.email, u.full_name, u.role, u.active, u.manager_id, u.joined_at,
                m.full_name AS manager_name,
                COUNT(DISTINCT sr.id) AS meeting_count,
                AVG(sr.score_engagement) AS avg_engagement,
                COUNT(DISTINCT tt.user_id) AS teams_connected
         FROM users u
         LEFT JOIN users m ON m.id = u.manager_id
         LEFT JOIN speaker_results sr ON sr.user_id = u.id
         LEFT JOIN teams_tokens tt ON tt.user_id = u.id AND tt.access_token IS NOT NULL
         WHERE u.org_id = ?
         GROUP BY u.id
         ORDER BY u.full_name`
      )
      .all(orgId);

    res.json(
      users.map((u) => ({
        id: u.id,
        email: u.email,
        fullName: u.full_name,
        role: u.role || 'employee',
        active: u.active !== 0,
        managerId: u.manager_id,
        managerName: u.manager_name || null,
        teamsConnected: u.teams_connected > 0,
        meetingCount: u.meeting_count || 0,
        avgEngagement: u.avg_engagement != null ? Math.round(u.avg_engagement * 100) : null,
        joinedAt: u.joined_at,
      }))
    );
  } catch (e) {
    logger.error({ err: e.message }, 'org/roster error');
    res.status(500).json({ error: e.message });
  }
});

// POST /api/org/invite
app.post('/api/org/invite', requireAuth, requireRole('admin', 'hr'), validate(InviteSchema), (req, res) => {
  try {
    const orgId = req.user.orgId;
    if (!orgId) return res.status(400).json({ error: 'No organization assigned' });

    const { role } = req.body;
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'meetingmetric-dev-secret-change-in-production';
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const token = jwt.sign(
      { type: 'invite', orgId, role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    db.prepare(
      `INSERT INTO invite_tokens (token, org_id, role, created_by, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(token, orgId, role, req.user.id, expiresAt);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.status(201).json({
      token,
      expiresAt,
      inviteUrl: `${frontendUrl}/register?invite=${token}`,
    });
  } catch (e) {
    logger.error({ err: e.message }, 'org/invite error');
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/org/users/:userId
app.patch('/api/org/users/:userId', requireAuth, requireRole('admin', 'hr'), validate(UpdateUserSchema), (req, res) => {
  try {
    const targetId = Number(req.params.userId);
    const orgId = req.user.orgId;

    const target = db.prepare('SELECT id, role, org_id FROM users WHERE id = ?').get(targetId);
    if (!target || target.org_id !== orgId) {
      return res.status(404).json({ error: 'User not found in your organization' });
    }

    const { role, managerId } = req.body;
    const updates = [];
    const params = [];

    if (role !== undefined) {
      // Only admin can set role to 'admin' or 'hr'
      if ((role === 'admin' || role === 'hr') && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can assign admin or hr roles' });
      }
      updates.push('role = ?');
      params.push(role);
    }

    if (managerId !== undefined) {
      if (managerId !== null) {
        const mgr = db.prepare('SELECT id FROM users WHERE id = ? AND org_id = ?').get(managerId, orgId);
        if (!mgr) return res.status(400).json({ error: 'Manager not found in your organization' });
      }
      updates.push('manager_id = ?');
      params.push(managerId);
    }

    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    params.push(targetId);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db
      .prepare('SELECT id, email, full_name, role, active, manager_id FROM users WHERE id = ?')
      .get(targetId);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/org/users/:userId (soft delete)
app.delete('/api/org/users/:userId', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const targetId = Number(req.params.userId);
    const orgId = req.user.orgId;
    const target = db.prepare('SELECT id, org_id FROM users WHERE id = ?').get(targetId);
    if (!target || target.org_id !== orgId) {
      return res.status(404).json({ error: 'User not found in your organization' });
    }
    if (targetId === req.user.id) {
      return res.status(400).json({ error: 'Cannot deactivate yourself' });
    }
    db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(targetId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/org/benchmarks
app.get('/api/org/benchmarks', requireAuth, (req, res) => {
  try {
    const orgId = req.user.orgId;
    if (!orgId) return res.json({ days: 30, avgEngagement: null, avgSentiment: null });

    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const cacheKey = `${orgId}:${days}`;
    const cached = benchmarksCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < 5 * 60 * 1000) {
      return res.json(cached.data);
    }

    const agg = db
      .prepare(
        `SELECT AVG(sr.score_engagement)    AS avg_engagement,
                AVG(sr.score_sentiment)     AS avg_sentiment,
                AVG(sr.score_collaboration) AS avg_collaboration,
                AVG(sr.score_initiative)    AS avg_initiative,
                AVG(sr.score_clarity)       AS avg_clarity,
                COUNT(DISTINCT m.id)        AS meeting_count,
                COUNT(DISTINCT sr.user_id)  AS participant_count
         FROM speaker_results sr
         JOIN meetings m ON m.id = sr.meeting_id
         WHERE sr.org_id = ?
           AND datetime(COALESCE(m.scheduled_at, m.created_at)) > datetime('now', '-' || ? || ' day')`
      )
      .get(orgId, days);

    const meetingCount = db
      .prepare(
        `SELECT COUNT(*) AS c FROM meetings
         WHERE org_id = ?
           AND datetime(COALESCE(scheduled_at, created_at)) > datetime('now', '-' || ? || ' day')`
      )
      .get(orgId, days)?.c || 0;

    const r2 = (v) => (v != null ? Math.round(v * 100) / 100 : null);
    const data = {
      days,
      avgEngagement: r2(agg?.avg_engagement),
      avgSentiment: r2(agg?.avg_sentiment),
      avgCollaboration: r2(agg?.avg_collaboration),
      avgInitiative: r2(agg?.avg_initiative),
      avgClarity: r2(agg?.avg_clarity),
      meetingCount,
      participantCount: agg?.participant_count || 0,
    };

    benchmarksCache.set(cacheKey, { ts: Date.now(), data });
    res.json(data);
  } catch (e) {
    logger.error({ err: e.message }, 'org/benchmarks error');
    res.status(500).json({ error: e.message });
  }
});

// POST /api/org/review-export
app.post('/api/org/review-export', requireAuth, requireRole('hr', 'admin'), validate(ReviewExportSchema), async (req, res) => {
  try {
    const { userId, startDate, endDate } = req.body;
    const orgId = req.user.orgId;

    const targetUser = db
      .prepare('SELECT id, email, full_name, role, manager_id FROM users WHERE id = ? AND org_id = ?')
      .get(userId, orgId);
    if (!targetUser) return res.status(404).json({ error: 'User not found in organization' });

    const managerName = targetUser.manager_id
      ? db.prepare('SELECT full_name FROM users WHERE id = ?').get(targetUser.manager_id)?.full_name
      : null;

    const org = db.prepare('SELECT name FROM organizations WHERE id = ?').get(orgId);

    // Get speaker results in date range
    const rows = db
      .prepare(
        `SELECT sr.score_engagement, sr.score_sentiment, sr.score_collaboration,
                sr.score_initiative, sr.score_clarity,
                sr.coaching_text, m.title, m.scheduled_at, m.created_at
         FROM speaker_results sr
         JOIN meetings m ON m.id = sr.meeting_id
         WHERE sr.user_id = ? AND sr.org_id = ?
           AND date(COALESCE(m.scheduled_at, m.created_at)) >= ?
           AND date(COALESCE(m.scheduled_at, m.created_at)) <= ?
         ORDER BY COALESCE(m.scheduled_at, m.created_at) ASC`
      )
      .all(userId, orgId, startDate, endDate);

    const dims = ['engagement', 'sentiment', 'collaboration', 'initiative', 'clarity'];
    const allScores = rows.map((r) => ({
      engagement: r.score_engagement ?? 0,
      sentiment: r.score_sentiment ?? 0,
      collaboration: r.score_collaboration ?? 0,
      initiative: r.score_initiative ?? 0,
      clarity: r.score_clarity ?? 0,
    }));
    const avgS = {};
    for (const k of dims) {
      avgS[k] = allScores.length ? Math.round(avg(allScores.map((s) => s[k] ?? 0)) * 100) : 0;
    }

    // Trend: first half vs second half
    const half = Math.floor(allScores.length / 2);
    const firstHalf = allScores.slice(0, half);
    const secondHalf = allScores.slice(half);
    const trendArrows = {};
    for (const k of dims) {
      const a1 = firstHalf.length ? avg(firstHalf.map((s) => s[k] ?? 0)) : 0;
      const a2 = secondHalf.length ? avg(secondHalf.map((s) => s[k] ?? 0)) : 0;
      trendArrows[k] = a2 > a1 + 0.05 ? '↑' : a2 < a1 - 0.05 ? '↓' : '→';
    }

    // Top 3 coaching insights
    const coachingTexts = rows
      .filter((r) => r.coaching_text)
      .slice(-3)
      .map((r) => r.coaching_text);

    // Percentiles vs org — computed in SQL on the normalized columns
    const percentiles = {};
    for (const k of dims) {
      const col = `score_${k}`;
      const row = db
        .prepare(
          `SELECT COUNT(*) AS total, SUM(CASE WHEN COALESCE(${col}, 0) <= ? THEN 1 ELSE 0 END) AS below
           FROM speaker_results WHERE org_id = ?`
        )
        .get(avgS[k] / 100, orgId);
      percentiles[k] = row.total ? Math.round((row.below / row.total) * 100) : 50;
    }

    // Build PDF
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));

    await new Promise((resolve) => {
      doc.on('end', resolve);

      // Header
      doc.fontSize(20).fillColor('#1e1e2e').text('MeetingMetric — Performance Review', { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(12).fillColor('#555').text(`${org?.name || 'Organization'} | ${startDate} to ${endDate}`, { align: 'center' });
      doc.moveDown(1);

      // User info
      doc.fontSize(14).fillColor('#111').text('Employee Information', { underline: true });
      doc.moveDown(0.3);
      doc.fontSize(11).fillColor('#333')
        .text(`Name: ${targetUser.full_name || 'N/A'}`)
        .text(`Email: ${targetUser.email}`)
        .text(`Role: ${targetUser.role || 'employee'}`)
        .text(`Manager: ${managerName || 'N/A'}`);
      doc.moveDown(1);

      // Summary stats
      doc.fontSize(14).fillColor('#111').text('Performance Summary', { underline: true });
      doc.moveDown(0.3);
      doc.fontSize(11).fillColor('#333').text(`Meetings in period: ${rows.length}`);
      doc.moveDown(0.2);
      for (const k of dims) {
        const label = k.charAt(0).toUpperCase() + k.slice(1);
        doc.text(`${label}: ${avgS[k]}% ${trendArrows[k]}`);
      }
      doc.moveDown(1);

      // Coaching insights
      if (coachingTexts.length > 0) {
        doc.fontSize(14).fillColor('#111').text('Top Coaching Insights', { underline: true });
        doc.moveDown(0.3);
        coachingTexts.forEach((t, i) => {
          doc.fontSize(11).fillColor('#333').text(`${i + 1}. ${t}`);
          doc.moveDown(0.3);
        });
        doc.moveDown(0.5);
      }

      // Percentile ranks
      doc.fontSize(14).fillColor('#111').text('Percentile Rank vs Organization', { underline: true });
      doc.moveDown(0.3);
      for (const k of dims) {
        const label = k.charAt(0).toUpperCase() + k.slice(1);
        doc.fontSize(11).fillColor('#333').text(`${label}: Top ${100 - percentiles[k]}% in organization`);
      }
      doc.moveDown(1);

      // Footer
      doc.fontSize(9).fillColor('#aaa')
        .text(`Generated by MeetingMetric • ${new Date().toLocaleDateString()}`, { align: 'center' });

      doc.end();
    });

    const pdfBuffer = Buffer.concat(chunks);
    const filename = `review-${userId}-${new Date().toISOString().slice(0, 10)}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(pdfBuffer);
  } catch (e) {
    logger.error({ err: e.message }, 'review-export error');
    res.status(500).json({ error: e.message });
  }
});

// ── MEETINGS ENDPOINTS ────────────────────────────────────────────────────────

app.post('/api/meetings/analyze', requireAuth, upload.single('file'), async (req, res) => {
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
    if (!rawText) return res.status(400).json({ error: 'Provide transcript text or a file' });

    const orgId = req.user.orgId || null;
    const { meetingId } = await runMeetingPipeline({
      rawText,
      title,
      userId: req.user.id,
      orgId,
      source: 'manual',
      projectId,
      scheduledAt,
      uploadedBy: req.user.id,
    });

    logger.info({ userId: req.user.id, meetingId, orgId }, 'Meeting analyzed');
    res.status(201).json({ meetingId, meeting: formatMeeting(meetingId, req.user.id) });
  } catch (e) {
    logger.error({ err: e.message }, 'analyze error');
    res.status(500).json({ error: e.message || 'Analysis failed' });
  }
});

app.get('/api/meetings', requireAuth, (req, res) => {
  const orgId = req.user.orgId;
  let rows;
  if (orgId) {
    rows = db
      .prepare(
        `SELECT m.id, m.title, m.summary, m.efficiency_score, m.dominant_speaker_alert,
                m.low_engagement_alert, m.created_at, m.scheduled_at, m.project_id,
                m.source, m.org_id, p.name AS project_name, p.color AS project_color
         FROM meetings m
         LEFT JOIN projects p ON p.id = m.project_id
         WHERE m.user_id = ? OR m.org_id = ?
         ORDER BY m.created_at DESC`
      )
      .all(req.user.id, orgId);
  } else {
    rows = db
      .prepare(
        `SELECT m.id, m.title, m.summary, m.efficiency_score, m.dominant_speaker_alert,
                m.low_engagement_alert, m.created_at, m.scheduled_at, m.project_id,
                m.source, m.org_id, p.name AS project_name, p.color AS project_color
         FROM meetings m
         LEFT JOIN projects p ON p.id = m.project_id
         WHERE m.user_id = ?
         ORDER BY m.created_at DESC`
      )
      .all(req.user.id);
  }
  res.json(rows.map(formatMeetingRow));
});

app.get('/api/meetings/:id', requireAuth, (req, res) => {
  const m = formatMeeting(req.params.id, req.user.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.json(m);
});

// ── DASHBOARD ─────────────────────────────────────────────────────────────────

app.get('/api/dashboard', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const orgId = req.user.orgId;
    const role = req.user.role || 'employee';

    let meetings, speakers;

    if (role === 'employee') {
      // Personal — meetings they participated in
      meetings = db.prepare(
        `SELECT DISTINCT m.id, m.efficiency_score, m.created_at
         FROM meetings m
         JOIN speaker_results sr ON sr.meeting_id = m.id
         WHERE sr.user_id = ?
         ORDER BY m.created_at DESC LIMIT 50`
      ).all(userId);

      speakers = db.prepare(
        `SELECT sr.speaker_name, sr.score_engagement, sr.talk_ratio, sr.word_count, m.created_at
         FROM speaker_results sr
         JOIN meetings m ON m.id = sr.meeting_id
         WHERE sr.user_id = ?
         ORDER BY m.created_at DESC`
      ).all(userId);
    } else if (role === 'manager') {
      // Direct reports
      const directReportIds = db
        .prepare('SELECT id FROM users WHERE manager_id = ? AND active = 1')
        .all(userId)
        .map((u) => u.id);

      const ids = [userId, ...directReportIds];
      const placeholders = ids.map(() => '?').join(',');

      meetings = db.prepare(
        `SELECT DISTINCT m.id, m.efficiency_score, m.created_at
         FROM meetings m
         JOIN speaker_results sr ON sr.meeting_id = m.id
         WHERE sr.user_id IN (${placeholders})
         ORDER BY m.created_at DESC LIMIT 50`
      ).all(...ids);

      speakers = db.prepare(
        `SELECT sr.speaker_name, sr.score_engagement, sr.talk_ratio, sr.word_count, m.created_at
         FROM speaker_results sr
         JOIN meetings m ON m.id = sr.meeting_id
         WHERE sr.user_id IN (${placeholders})
         ORDER BY m.created_at DESC`
      ).all(...ids);
    } else {
      // hr/admin: org-wide
      if (orgId) {
        meetings = db.prepare(
          `SELECT id, efficiency_score, created_at FROM meetings WHERE org_id = ? ORDER BY created_at DESC LIMIT 50`
        ).all(orgId);
        speakers = db.prepare(
          `SELECT sr.speaker_name, sr.score_engagement, sr.talk_ratio, sr.word_count, m.created_at
           FROM speaker_results sr
           JOIN meetings m ON m.id = sr.meeting_id
           WHERE sr.org_id = ?
           ORDER BY m.created_at DESC`
        ).all(orgId);
      } else {
        meetings = db.prepare(
          `SELECT id, efficiency_score, created_at FROM meetings WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
        ).all(userId);
        speakers = db.prepare(
          `SELECT sr.speaker_name, sr.score_engagement, sr.talk_ratio, sr.word_count, m.created_at
           FROM speaker_results sr
           JOIN meetings m ON m.id = sr.meeting_id
           WHERE m.user_id = ?
           ORDER BY m.created_at DESC`
        ).all(userId);
      }
    }

    const bySpeaker = new Map();
    for (const { speaker_name, score_engagement, talk_ratio, word_count } of speakers) {
      if (!bySpeaker.has(speaker_name)) {
        bySpeaker.set(speaker_name, { name: speaker_name, engagements: [], talkRatios: [], wordCounts: [] });
      }
      const b = bySpeaker.get(speaker_name);
      b.engagements.push(score_engagement ?? 0);
      b.talkRatios.push(talk_ratio);
      b.wordCounts.push(word_count);
    }

    const participantSummaries = [];
    for (const [, v] of bySpeaker) {
      const a = (arr) => arr.reduce((x, y) => x + y, 0) / Math.max(arr.length, 1);
      participantSummaries.push({
        name: v.name,
        avgEngagement: Math.round(a(v.engagements) * 100) / 100,
        avgTalkRatio: Math.round(a(v.talkRatios) * 100) / 100,
        meetingsCount: v.engagements.length,
      });
    }
    participantSummaries.sort((a, b) => b.avgEngagement - a.avgEngagement);

    const efficiencyTrend = meetings.map((m) => ({
      date: m.created_at,
      efficiency: m.efficiency_score,
      id: m.id,
    }));

    // Parameterized scope filter: org-wide for managers and above, personal otherwise
    const orgScoped = !!(orgId && role !== 'employee');
    const scopeSql = orgScoped ? 'org_id = ?' : 'user_id = ?';
    const scopeParam = orgScoped ? orgId : userId;

    const last30 = db
      .prepare(`SELECT COUNT(*) AS c, AVG(efficiency_score) AS avg_eff FROM meetings WHERE ${scopeSql} AND datetime(created_at) > datetime('now', '-30 day')`)
      .get(scopeParam);

    let engSum = 0, engN = 0;
    for (const row of speakers) {
      if (typeof row.score_engagement === 'number') { engSum += row.score_engagement; engN++; }
    }
    const liveParticipation = engN ? Math.round((engSum / engN) * 100) : null;

    const uniqueParticipants = bySpeaker.size;

    const recentDominance = db.prepare(
      `SELECT COUNT(*) as c FROM meetings WHERE ${scopeSql} AND dominant_speaker_alert = 1 AND datetime(created_at) > datetime('now', '-30 day')`
    ).get(scopeParam).c;
    const recentLowEngagement = db.prepare(
      `SELECT COUNT(*) as c FROM meetings WHERE ${scopeSql} AND low_engagement_alert = 1 AND datetime(created_at) > datetime('now', '-30 day')`
    ).get(scopeParam).c;

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
      alerts: { recentDominance, recentLowEngagement },
    });
  } catch (e) {
    logger.error({ err: e.message }, 'dashboard error');
    res.status(500).json({ error: e.message });
  }
});

// ── CALENDAR ──────────────────────────────────────────────────────────────────

app.get('/api/calendar', requireAuth, (req, res) => {
  const month = (req.query.month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Query month=YYYY-MM required' });
  const orgId = req.user.orgId;

  // Month filtering in SQL on scheduled_at with created_at fallback
  const monthCond = `strftime('%Y-%m', COALESCE(m.scheduled_at, m.created_at)) = ?`;
  let rows;
  if (orgId) {
    rows = db.prepare(
      `SELECT m.id, m.title, m.efficiency_score, m.created_at, m.scheduled_at,
              m.project_id, p.name AS project_name, p.color AS project_color
       FROM meetings m LEFT JOIN projects p ON p.id = m.project_id
       WHERE (m.user_id = ? OR m.org_id = ?) AND ${monthCond}`
    ).all(req.user.id, orgId, month);
  } else {
    rows = db.prepare(
      `SELECT m.id, m.title, m.efficiency_score, m.created_at, m.scheduled_at,
              m.project_id, p.name AS project_name, p.color AS project_color
       FROM meetings m LEFT JOIN projects p ON p.id = m.project_id
       WHERE m.user_id = ? AND ${monthCond}`
    ).all(req.user.id, month);
  }

  res.json({
    month,
    meetings: rows.map((r) => ({ ...formatMeetingRow(r), calendar_date: r.scheduled_at || r.created_at })),
  });
});

// ── PROJECTS ──────────────────────────────────────────────────────────────────

app.get('/api/projects', requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT p.id, p.name, p.description, p.color, p.created_at,
            (SELECT COUNT(*) FROM meetings m WHERE m.project_id = p.id) AS meeting_count
     FROM projects p WHERE p.user_id = ? ORDER BY p.created_at DESC`
  ).all(req.user.id);
  res.json(rows);
});

app.post('/api/projects', requireAuth, (req, res) => {
  const name = (req.body.name || '').trim().slice(0, 120);
  if (!name) return res.status(400).json({ error: 'Project name required' });
  const description = (req.body.description || '').trim().slice(0, 2000) || null;
  const color = (req.body.color || '#3b82f6').slice(0, 20);
  const created_at = new Date().toISOString();
  const row = db.prepare(
    'INSERT INTO projects (user_id, name, description, color, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id'
  ).get(req.user.id, name, description, color, created_at);
  res.status(201).json({ id: row.id, name, description, color, created_at });
});

app.patch('/api/meetings/:id/project', requireAuth, (req, res) => {
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/projects/:id/detail', requireAuth, (req, res) => {
  try {
    const pid = Number(req.params.id);
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(pid, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const meetings = db.prepare(
      `SELECT m.id, m.title, m.efficiency_score, m.created_at, m.scheduled_at
       FROM meetings m WHERE m.project_id = ? AND m.user_id = ?
       ORDER BY COALESCE(m.scheduled_at, m.created_at) DESC`
    ).all(pid, req.user.id);

    const speakers = db.prepare(
      `SELECT sr.speaker_name, sr.talk_ratio, sr.word_count, sr.turn_count, m.id AS meeting_id,
              sr.score_engagement, sr.score_sentiment, sr.score_collaboration,
              sr.score_initiative, sr.score_clarity
       FROM speaker_results sr
       JOIN meetings m ON m.id = sr.meeting_id
       WHERE m.project_id = ? AND m.user_id = ?`
    ).all(pid, req.user.id);

    const byName = new Map();
    for (const s of speakers) {
      if (!byName.has(s.speaker_name)) byName.set(s.speaker_name, []);
      byName.get(s.speaker_name).push({
        ...s,
        scores: {
          engagement: s.score_engagement ?? 0,
          sentiment: s.score_sentiment ?? 0,
          collaboration: s.score_collaboration ?? 0,
          initiative: s.score_initiative ?? 0,
          clarity: s.score_clarity ?? 0,
        },
      });
    }

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
      meetings: meetings.map((m) => ({ ...m, scheduled_at: m.scheduled_at || null })),
      participants: participantStats,
      avg_efficiency: meetings.length ? Math.round(avg(meetings.map((m) => m.efficiency_score ?? 0)) * 100) / 100 : null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SEARCH ────────────────────────────────────────────────────────────────────

app.post('/api/search', requireAuth, async (req, res) => {
  try {
    const q = (req.body.query || '').trim();
    if (!q) return res.status(400).json({ error: 'query required' });

    const orgId = req.user.orgId;
    let rows;
    if (orgId) {
      rows = db.prepare(
        `SELECT mc.text_snippet, mc.embedding_json, mc.meeting_id, m.title
         FROM meeting_chunks mc
         JOIN meetings m ON m.id = mc.meeting_id
         WHERE m.user_id = ? OR m.org_id = ?`
      ).all(req.user.id, orgId);
    } else {
      rows = db.prepare(
        `SELECT mc.text_snippet, mc.embedding_json, mc.meeting_id, m.title
         FROM meeting_chunks mc
         JOIN meetings m ON m.id = mc.meeting_id
         WHERE m.user_id = ?`
      ).all(req.user.id);
    }

    if (rows.length === 0) return res.json({ results: [], message: 'No indexed chunks yet.' });

    const qVec = await embedText(q);
    if (!qVec) return res.json({ results: [], message: 'Embeddings disabled (set USE_ML=1) or model unavailable.' });

    const scored = rows
      .map((r) => {
        let vec; try { vec = JSON.parse(r.embedding_json); } catch { return null; }
        return { score: cosine(qVec, vec), text_snippet: r.text_snippet, meeting_id: r.meeting_id, title: r.title };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    res.json({ results: scored });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── TEAM PARTICIPANTS ─────────────────────────────────────────────────────────

app.get('/api/team/participants', requireAuth, (req, res) => {
  try {
    const role = req.user.role || 'employee';
    if (role === 'employee') return res.status(403).json({ error: 'Access denied' });

    const { from, to, project_id } = req.query;
    const orgId = req.user.orgId;
    const userId = req.user.id;

    let meetingFilter;
    const params = [];

    if (role === 'manager') {
      // Only direct reports
      const directReportIds = db
        .prepare('SELECT id FROM users WHERE manager_id = ? AND active = 1')
        .all(userId)
        .map((u) => u.id);
      const ids = [userId, ...directReportIds];
      const placeholders = ids.map(() => '?').join(',');
      meetingFilter = `WHERE sr.user_id IN (${placeholders})`;
      params.push(...ids);
    } else if (orgId) {
      meetingFilter = 'WHERE sr.org_id = ?';
      params.push(orgId);
    } else {
      meetingFilter = 'WHERE m.user_id = ?';
      params.push(userId);
    }

    if (from) { meetingFilter += ' AND date(COALESCE(m.scheduled_at, m.created_at)) >= date(?)'; params.push(from); }
    if (to)   { meetingFilter += ' AND date(COALESCE(m.scheduled_at, m.created_at)) <= date(?)'; params.push(to); }
    if (project_id) { meetingFilter += ' AND m.project_id = ?'; params.push(Number(project_id)); }

    const rows = db.prepare(`
      SELECT sr.speaker_name, sr.talk_ratio, sr.word_count, sr.turn_count,
             sr.coaching_text, sr.user_id AS speaker_user_id,
             sr.score_engagement, sr.score_sentiment, sr.score_collaboration,
             sr.score_initiative, sr.score_clarity,
             m.id AS meeting_id, m.title AS meeting_title,
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
      const scores = {
        engagement: r.score_engagement ?? 0,
        sentiment: r.score_sentiment ?? 0,
        collaboration: r.score_collaboration ?? 0,
        initiative: r.score_initiative ?? 0,
        clarity: r.score_clarity ?? 0,
      };
      entry.meetings.push({
        meeting_id: r.meeting_id, meeting_title: r.meeting_title,
        meeting_date: r.meeting_date, project_id: r.project_id,
        project_name: r.project_name, project_color: r.project_color,
        scores, talk_ratio: r.talk_ratio, word_count: r.word_count,
        turn_count: r.turn_count, coaching_text: r.coaching_text,
      });
      if (r.project_name) entry.projects.add(r.project_name);
    }

    const participants = [];
    for (const [, v] of byName) {
      const a = (arr) => arr.reduce((x, y) => x + y, 0) / Math.max(arr.length, 1);
      const engagements = v.meetings.map((m) => m.scores.engagement ?? 0);
      const sentiments = v.meetings.map((m) => m.scores.sentiment ?? 0);
      const collaborations = v.meetings.map((m) => m.scores.collaboration ?? 0);
      const initiatives = v.meetings.map((m) => m.scores.initiative ?? 0);
      const clarities = v.meetings.map((m) => m.scores.clarity ?? 0);
      participants.push({
        name: v.name, meeting_count: v.meetings.length, projects: [...v.projects],
        avg_engagement: Math.round(a(engagements) * 100) / 100,
        avg_sentiment: Math.round(a(sentiments) * 100) / 100,
        avg_collaboration: Math.round(a(collaborations) * 100) / 100,
        avg_initiative: Math.round(a(initiatives) * 100) / 100,
        avg_clarity: Math.round(a(clarities) * 100) / 100,
        avg_talk_ratio: Math.round(a(v.meetings.map((m) => m.talk_ratio)) * 100) / 100,
        total_words: v.meetings.reduce((s, m) => s + m.word_count, 0),
        meetings: v.meetings,
      });
    }
    participants.sort((a, b) => b.meeting_count - a.meeting_count);
    res.json(participants);
  } catch (e) {
    logger.error({ err: e.message }, 'team/participants error');
    res.status(500).json({ error: e.message });
  }
});

// ── REPORTS ───────────────────────────────────────────────────────────────────

app.get('/api/reports', requireAuth, (req, res) => {
  try {
    const { from, to, role: roleFilter, department } = req.query;
    const orgId = req.user.orgId;
    const userRole = req.user.role || 'employee';

    if (userRole === 'employee') return res.status(403).json({ error: 'Access denied' });

    let meetingFilter = orgId ? 'WHERE (m.org_id = ? OR m.user_id = ?)' : 'WHERE m.user_id = ?';
    const params = orgId ? [orgId, req.user.id] : [req.user.id];

    if (from) { meetingFilter += ' AND date(COALESCE(m.scheduled_at, m.created_at)) >= ?'; params.push(from); }
    if (to)   { meetingFilter += ' AND date(COALESCE(m.scheduled_at, m.created_at)) <= ?'; params.push(to); }

    // One LEFT JOIN + GROUP BY: meetings with per-meeting score averages
    // (replaces the previous per-meeting query inside a .map loop)
    const meetings = db.prepare(
      `SELECT m.id, m.title, m.efficiency_score, m.created_at, m.scheduled_at,
              p.name AS project_name, p.color AS project_color,
              AVG(sr.score_engagement)    AS avg_engagement,
              AVG(sr.score_sentiment)     AS avg_sentiment,
              AVG(sr.score_collaboration) AS avg_collaboration,
              AVG(sr.score_initiative)    AS avg_initiative,
              AVG(sr.score_clarity)       AS avg_clarity
       FROM meetings m
       LEFT JOIN projects p ON p.id = m.project_id
       LEFT JOIN speaker_results sr ON sr.meeting_id = m.id
       ${meetingFilter}
       GROUP BY m.id
       ORDER BY COALESCE(m.scheduled_at, m.created_at) ASC`
    ).all(...params);

    const dimensionTrends = meetings.map((m) => ({
      id: m.id, title: m.title, date: (m.scheduled_at || m.created_at).slice(0, 10),
      efficiency: Math.round((m.efficiency_score ?? 0) * 100),
      engagement: Math.round((m.avg_engagement ?? 0) * 100),
      sentiment: Math.round((m.avg_sentiment ?? 0) * 100),
      collaboration: Math.round((m.avg_collaboration ?? 0) * 100),
      initiative: Math.round((m.avg_initiative ?? 0) * 100),
      clarity: Math.round((m.avg_clarity ?? 0) * 100),
    }));

    // Per-participant aggregation done in SQL
    const participantRows = db.prepare(
      `SELECT sr.speaker_name AS name, COUNT(*) AS meeting_count,
              AVG(COALESCE(sr.score_engagement, 0))    AS avg_engagement,
              AVG(COALESCE(sr.score_sentiment, 0))     AS avg_sentiment,
              AVG(COALESCE(sr.score_collaboration, 0)) AS avg_collaboration,
              AVG(COALESCE(sr.score_initiative, 0))    AS avg_initiative,
              AVG(COALESCE(sr.score_clarity, 0))       AS avg_clarity,
              AVG(COALESCE(sr.talk_ratio, 0))          AS avg_talk_ratio
       FROM speaker_results sr
       JOIN meetings m ON m.id = sr.meeting_id
       ${meetingFilter}
       GROUP BY sr.speaker_name`
    ).all(...params);

    const participants = participantRows.map((r) => ({
      name: r.name, meeting_count: r.meeting_count,
      avg_engagement: Math.round(r.avg_engagement * 100) / 100,
      avg_sentiment: Math.round(r.avg_sentiment * 100) / 100,
      avg_collaboration: Math.round(r.avg_collaboration * 100) / 100,
      avg_initiative: Math.round(r.avg_initiative * 100) / 100,
      avg_clarity: Math.round(r.avg_clarity * 100) / 100,
      avg_talk_ratio: Math.round(r.avg_talk_ratio * 100) / 100,
    }));
    participants.sort((a, b) => b.avg_engagement - a.avg_engagement);

    const ranked = [...meetings].filter((m) => m.efficiency_score != null).sort((a, b) => b.efficiency_score - a.efficiency_score);
    const fmt = (m) => ({ id: m.id, title: m.title, efficiency: Math.round(m.efficiency_score * 100), date: (m.scheduled_at || m.created_at).slice(0, 10), project_name: m.project_name || null });

    // Project-level engagement averaged across speaker rows, in SQL
    const projectEngRows = db.prepare(
      `SELECT COALESCE(p.name, 'Unassigned') AS name, AVG(sr.score_engagement) AS avg_engagement
       FROM speaker_results sr
       JOIN meetings m ON m.id = sr.meeting_id
       LEFT JOIN projects p ON p.id = m.project_id
       ${meetingFilter}
       GROUP BY COALESCE(p.name, 'Unassigned')`
    ).all(...params);
    const projectEng = new Map(projectEngRows.map((r) => [r.name, r.avg_engagement]));

    const projectMap = new Map();
    for (const m of meetings) {
      const key = m.project_name || 'Unassigned';
      if (!projectMap.has(key)) projectMap.set(key, { name: key, color: m.project_color || '#6b7280', meetings: [] });
      projectMap.get(key).meetings.push(m);
    }
    const projectBreakdown = [];
    for (const [, pv] of projectMap) {
      const eff = pv.meetings.filter((m) => m.efficiency_score != null).map((m) => m.efficiency_score);
      const eng = projectEng.get(pv.name);
      projectBreakdown.push({
        name: pv.name, color: pv.color, meeting_count: pv.meetings.length,
        avg_efficiency: eff.length ? Math.round(avg(eff) * 100) : null,
        avg_engagement: eng != null ? Math.round(eng * 100) : null,
      });
    }

    const allEff = meetings.filter((m) => m.efficiency_score != null).map((m) => m.efficiency_score);
    res.json({
      summary: {
        totalMeetings: meetings.length,
        avgEfficiency: allEff.length ? Math.round(avg(allEff) * 100) : null,
        totalParticipants: participants.length,
        dateRange: meetings.length ? {
          from: (meetings[0].scheduled_at || meetings[0].created_at).slice(0, 10),
          to: (meetings[meetings.length - 1].scheduled_at || meetings[meetings.length - 1].created_at).slice(0, 10),
        } : null,
      },
      dimensionTrends,
      topParticipants: participants.slice(0, 5),
      bottomParticipants: participants.length > 5 ? participants.slice(-5).reverse() : [],
      topMeetings: ranked.slice(0, 5).map(fmt),
      bottomMeetings: ranked.length > 5 ? ranked.slice(-5).reverse().map(fmt) : [],
      projectBreakdown,
    });
  } catch (e) {
    logger.error({ err: e.message }, 'reports error');
    res.status(500).json({ error: e.message });
  }
});

// ── USER PROFILE ──────────────────────────────────────────────────────────────

app.get('/api/user/profile', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, full_name, organisation, role, created_at, org_id FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const teamsConnected = !!(teamsService.getStoredToken(req.user.id)?.access_token);
  res.json({ ...user, teams_connected: teamsConnected, teams_configured: teamsService.isConfigured() });
});

app.patch('/api/user/profile', requireAuth, (req, res) => {
  try {
    const { fullName, organisation, role } = req.body;
    const updates = [], params = [];
    if (fullName !== undefined) { updates.push('full_name = ?'); params.push(fullName.trim() || null); }
    if (organisation !== undefined) { updates.push('organisation = ?'); params.push(organisation.trim() || null); }
    if (role !== undefined) { updates.push('role = ?'); params.push(role.trim() || null); }
    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    params.push(req.user.id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const user = db.prepare('SELECT id, email, full_name, organisation, role FROM users WHERE id = ?').get(req.user.id);
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── TEAMS ENDPOINTS ───────────────────────────────────────────────────────────

app.get('/api/teams/status', requireAuth, (req, res) => {
  if (!teamsService.isConfigured()) return res.json({ configured: false, connected: false });
  const tok = teamsService.getStoredToken(req.user.id);
  res.json({ configured: true, connected: !!(tok && tok.access_token) });
});

app.get('/api/teams/connect', requireAuth, async (req, res) => {
  try {
    if (!teamsService.isConfigured()) return res.status(501).json({ error: 'Azure AD not configured' });
    const state = Buffer.from(JSON.stringify({ userId: req.user.id, token: req.headers.authorization.slice(7) })).toString('base64url');
    const url = await teamsService.getAuthUrl(state);
    res.json({ url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/teams/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send('Missing code or state');
    let parsed;
    try { parsed = JSON.parse(Buffer.from(state, 'base64url').toString()); } catch { return res.status(400).send('Invalid state'); }
    const result = await teamsService.acquireTokenByCode(code);
    const expiresOn = result.expiresOn ? result.expiresOn.toISOString() : new Date(Date.now() + 3600000).toISOString();
    teamsService.saveTokens(parsed.userId, result.accessToken, expiresOn, result.refreshToken || null);
    const frontendBase = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendBase}/settings?teams=connected`);
  } catch (e) {
    logger.error({ err: e.message }, 'Teams callback error');
    const frontendBase = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendBase}/settings?teams=error&msg=${encodeURIComponent(e.message)}`);
  }
});

app.get('/api/teams/meetings', requireAuth, async (req, res) => {
  try {
    const tok = teamsService.getStoredToken(req.user.id);
    if (!tok || !tok.access_token) return res.status(401).json({ error: 'Connect Microsoft Teams first' });
    const meetings = await teamsService.listMeetings(tok.access_token);
    res.json(meetings);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/teams/import', requireAuth, async (req, res) => {
  try {
    const tok = teamsService.getStoredToken(req.user.id);
    if (!tok || !tok.access_token) return res.status(401).json({ error: 'Connect Microsoft Teams first' });
    const { meetingId, subject } = req.body;
    if (!meetingId) return res.status(400).json({ error: 'meetingId required' });

    const transcripts = await teamsService.getMeetingTranscripts(tok.access_token, meetingId);
    if (!transcripts.length) return res.status(404).json({ error: 'No transcripts found' });

    const vtt = await teamsService.getTranscriptContent(tok.access_token, meetingId, transcripts[0].id);
    const { parseVtt } = require('./lib/vttParser');
    const turns = parseVtt(vtt);
    const rawText = turns.length > 0
      ? turns.map((t) => `${t.speaker}: ${t.text}`).join('\n')
      : teamsService.parseVttToPlaintext(vtt);

    if (!rawText.trim()) return res.status(404).json({ error: 'Transcript was empty after parsing' });

    const title = (subject || 'Teams meeting').slice(0, 200);
    const scheduledAt = transcripts[0].createdDateTime || null;
    const orgId = req.user.orgId || null;

    const { meetingId: newMeetingId } = await runMeetingPipeline({
      rawText,
      title,
      userId: req.user.id,
      orgId,
      source: 'teams_import',
      scheduledAt,
      uploadedBy: req.user.id,
      teamsMeetingId: meetingId,
      teamsTranscriptId: transcripts[0].id,
    });

    logger.info({ userId: req.user.id, meetingId: newMeetingId }, 'Teams meeting imported');
    res.status(201).json({ meetingId: newMeetingId, meeting: formatMeeting(newMeetingId, req.user.id) });
  } catch (e) {
    logger.error({ err: e.message }, 'Teams import error');
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/teams/disconnect', requireAuth, (req, res) => {
  teamsService.deleteTokens(req.user.id);
  res.json({ ok: true });
});

app.get('/api/teams/calendar', requireAuth, async (req, res) => {
  try {
    const tok = teamsService.getStoredToken(req.user.id);
    if (!tok || !tok.access_token) return res.status(401).json({ error: 'Connect Microsoft Teams first' });
    const { start, end } = req.query;
    const startDate = start || new Date(Date.now() - 30 * 86400000).toISOString();
    const endDate = end || new Date(Date.now() + 30 * 86400000).toISOString();
    const events = await teamsService.getCalendarEvents(tok.access_token, startDate, endDate);
    res.json(events);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/teams/profile', requireAuth, async (req, res) => {
  try {
    const tok = teamsService.getStoredToken(req.user.id);
    if (!tok || !tok.access_token) return res.status(401).json({ error: 'Not connected' });
    const profile = await teamsService.getUserProfile(tok.access_token);
    res.json(profile);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/teams/poll-status
app.get('/api/teams/poll-status', requireAuth, (req, res) => {
  try {
    const orgId = req.user.orgId;
    const state = db
      .prepare('SELECT last_polled_at, last_meeting_end_time FROM transcript_poll_state WHERE user_id = ?')
      .get(req.user.id);

    const connectedUsersInOrg = orgId ? db
      .prepare(
        `SELECT COUNT(*) AS c FROM teams_tokens tt
         JOIN users u ON u.id = tt.user_id
         WHERE u.org_id = ? AND tt.access_token IS NOT NULL`
      )
      .get(orgId)?.c || 0 : 0;

    res.json({
      lastPolledAt: state?.last_polled_at || null,
      lastMeetingEndTime: state?.last_meeting_end_time || null,
      connectedUsersInOrg,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/teams/poll-now
app.post('/api/teams/poll-now', requireAuth, (req, res) => {
  // Fire and forget
  pollService.pollUser(req.user.id).catch((e) => logger.error({ userId: req.user.id, err: e.message }, 'poll-now error'));
  res.json({ ok: true, message: 'Poll started' });
});

// ── BOT ENDPOINT ──────────────────────────────────────────────────────────────

app.post('/api/bot/transcript', async (req, res) => {
  try {
    const { meetingId, transcript, title, participants, apiKey } = req.body;
    if (!transcript || !apiKey) return res.status(400).json({ error: 'transcript and apiKey required' });
    const payload = verifyToken(apiKey);
    if (!payload) return res.status(401).json({ error: 'Invalid API key' });
    const userId = payload.sub;

    const rawText = typeof transcript === 'string'
      ? transcript
      : (transcript || []).map((t) => `${t.speaker || 'Unknown'}: ${t.text}`).join('\n');

    if (!rawText.trim()) return res.status(400).json({ error: 'Empty transcript' });

    const userRow = db.prepare('SELECT org_id FROM users WHERE id = ?').get(userId);
    const orgId = userRow?.org_id || null;

    const meetingTitle = (title || 'Teams Live Meeting').slice(0, 200);
    const { meetingId: newId } = await runMeetingPipeline({
      rawText,
      title: meetingTitle,
      userId,
      orgId,
      source: 'bot',
      scheduledAt: new Date().toISOString(),
      uploadedBy: userId,
    });

    res.status(201).json({ meetingId: newId, message: 'Transcript received and analyzed' });
  } catch (e) {
    logger.error({ err: e.message }, 'bot transcript error');
    res.status(500).json({ error: e.message });
  }
});

// ── HEALTH ────────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ ok: true, teams: teamsService.isConfigured() });
});

// ── STARTUP ───────────────────────────────────────────────────────────────────

// Export app for testing (when required as a module)
if (require.main === module) {
  app.listen(PORT, () => {
    logger.info({ port: PORT }, `MeetingMetric API listening on :${PORT}`);

    const seedDemo = require('../seed');
    seedDemo().catch((e) => logger.error({ err: e.message }, 'Auto-seed failed'));

    // Start poll service
    pollService.start();
  });
}

module.exports = { app };
