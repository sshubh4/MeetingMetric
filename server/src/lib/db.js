const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.MEETINGMETRIC_DB || path.join(__dirname, '..', '..', 'data', 'meetingmetric.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

// ── Core tables ────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    summary TEXT,
    efficiency_score REAL,
    dominant_speaker_alert INTEGER DEFAULT 0,
    low_engagement_alert INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS speaker_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id INTEGER NOT NULL,
    speaker_name TEXT NOT NULL,
    word_count INTEGER NOT NULL,
    turn_count INTEGER NOT NULL,
    talk_ratio REAL NOT NULL,
    scores_json TEXT NOT NULL,
    utterance_breakdown_json TEXT NOT NULL,
    coaching_text TEXT,
    embedding_json TEXT,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id)
  );

  CREATE TABLE IF NOT EXISTS meeting_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    text_snippet TEXT NOT NULL,
    embedding_json TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id)
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT DEFAULT '#3b82f6',
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_meetings_user ON meetings(user_id);
  CREATE INDEX IF NOT EXISTS idx_speaker_meeting ON speaker_results(meeting_id);
  CREATE INDEX IF NOT EXISTS idx_chunks_meeting ON meeting_chunks(meeting_id);

  CREATE TABLE IF NOT EXISTS teams_tokens (
    user_id INTEGER PRIMARY KEY,
    access_token TEXT,
    refresh_token TEXT,
    expires_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);

  CREATE TABLE IF NOT EXISTS speaker_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    org_id INTEGER NOT NULL,
    alias_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (org_id) REFERENCES organizations(id),
    UNIQUE(org_id, alias_name)
  );

  CREATE TABLE IF NOT EXISTS invite_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    org_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'employee',
    created_by INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    used_by INTEGER,
    FOREIGN KEY (org_id) REFERENCES organizations(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS transcript_poll_state (
    user_id INTEGER PRIMARY KEY,
    last_polled_at TEXT,
    last_meeting_end_time TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// ── Additive ALTER TABLE migrations ───────────────────────────────────────────

function tableColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

const userCols = tableColumns('users');
if (!userCols.includes('full_name'))   db.exec('ALTER TABLE users ADD COLUMN full_name TEXT');
if (!userCols.includes('organisation')) db.exec('ALTER TABLE users ADD COLUMN organisation TEXT');
if (!userCols.includes('role'))        db.exec('ALTER TABLE users ADD COLUMN role TEXT');
if (!userCols.includes('org_id'))      db.exec('ALTER TABLE users ADD COLUMN org_id INTEGER');
if (!userCols.includes('manager_id'))  db.exec('ALTER TABLE users ADD COLUMN manager_id INTEGER');
if (!userCols.includes('active'))      db.exec('ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1');
if (!userCols.includes('invited_by'))  db.exec('ALTER TABLE users ADD COLUMN invited_by INTEGER');
if (!userCols.includes('joined_at'))   db.exec('ALTER TABLE users ADD COLUMN joined_at TEXT');

const meetingCols = tableColumns('meetings');
if (!meetingCols.includes('project_id'))          db.exec('ALTER TABLE meetings ADD COLUMN project_id INTEGER');
if (!meetingCols.includes('scheduled_at'))        db.exec('ALTER TABLE meetings ADD COLUMN scheduled_at TEXT');
if (!meetingCols.includes('uploaded_by'))         db.exec('ALTER TABLE meetings ADD COLUMN uploaded_by INTEGER');
if (!meetingCols.includes('source'))              db.exec("ALTER TABLE meetings ADD COLUMN source TEXT DEFAULT 'manual'");
if (!meetingCols.includes('teams_meeting_id'))    db.exec('ALTER TABLE meetings ADD COLUMN teams_meeting_id TEXT');
if (!meetingCols.includes('teams_transcript_id')) db.exec('ALTER TABLE meetings ADD COLUMN teams_transcript_id TEXT');
if (!meetingCols.includes('org_id'))              db.exec('ALTER TABLE meetings ADD COLUMN org_id INTEGER');

const speakerCols = tableColumns('speaker_results');
if (!speakerCols.includes('user_id')) db.exec('ALTER TABLE speaker_results ADD COLUMN user_id INTEGER');
if (!speakerCols.includes('org_id'))  db.exec('ALTER TABLE speaker_results ADD COLUMN org_id INTEGER');

const projectCols = tableColumns('projects');
if (!projectCols.includes('department')) db.exec('ALTER TABLE projects ADD COLUMN department TEXT');

// ── New indexes ────────────────────────────────────────────────────────────────

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_users_org            ON users(org_id);
  CREATE INDEX IF NOT EXISTS idx_meetings_org         ON meetings(org_id);
  CREATE INDEX IF NOT EXISTS idx_speaker_results_user ON speaker_results(user_id);
  CREATE INDEX IF NOT EXISTS idx_speaker_aliases_user ON speaker_aliases(user_id);
  CREATE INDEX IF NOT EXISTS idx_speaker_aliases_org  ON speaker_aliases(org_id);
`);

// ── Helper: resolve speaker aliases for an org ────────────────────────────────

/**
 * Returns a Map<aliasName, userId> for the given orgId.
 * Used by pollService and analyze endpoints to auto-link speaker_results rows.
 */
function resolveAliases(orgId) {
  const rows = db
    .prepare('SELECT alias_name, user_id FROM speaker_aliases WHERE org_id = ?')
    .all(orgId);
  const map = new Map();
  for (const r of rows) {
    map.set(r.alias_name, r.user_id);
  }
  return map;
}

module.exports = db;
module.exports.resolveAliases = resolveAliases;
