const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.MEETINGMETRIC_DB || path.join(__dirname, '..', '..', 'data', 'meetingmetric.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
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
`);

function tableColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

const userCols = tableColumns('users');
if (!userCols.includes('full_name')) {
  db.exec('ALTER TABLE users ADD COLUMN full_name TEXT');
}
if (!userCols.includes('organisation')) {
  db.exec('ALTER TABLE users ADD COLUMN organisation TEXT');
}
if (!userCols.includes('role')) {
  db.exec('ALTER TABLE users ADD COLUMN role TEXT');
}

const meetingCols = tableColumns('meetings');
if (!meetingCols.includes('project_id')) {
  db.exec('ALTER TABLE meetings ADD COLUMN project_id INTEGER');
}
if (!meetingCols.includes('scheduled_at')) {
  db.exec('ALTER TABLE meetings ADD COLUMN scheduled_at TEXT');
}

const projectCols = tableColumns('projects');
if (!projectCols.includes('department')) {
  db.exec('ALTER TABLE projects ADD COLUMN department TEXT');
}

module.exports = db;
