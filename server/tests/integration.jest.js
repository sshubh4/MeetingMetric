'use strict';

/**
 * Integration tests (Jest + supertest) — RBAC boundaries, cross-org
 * isolation, and the end-to-end analyze pipeline including the data lake
 * and pipeline_runs telemetry.
 *
 * Runs against the real Express app with an in-memory SQLite DB and a
 * temp-dir local data lake.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const LAKE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-lake-'));

process.env.MEETINGMETRIC_DB = ':memory:';
process.env.JWT_SECRET = 'integration-test-secret-1234567890';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.USE_ML = '0';
process.env.SEED_DEMO = '0';
process.env.STORAGE_MODE = 'local';
process.env.DATA_LAKE_DIR = LAKE_DIR;
delete process.env.ANTHROPIC_API_KEY;

const supertest = require('supertest');
const { app } = require('../src/server');
const db = require('../src/lib/db');

const request = supertest(app);

afterAll(() => {
  fs.rmSync(LAKE_DIR, { recursive: true, force: true });
});

async function registerAdmin(orgName, email) {
  const res = await request
    .post('/api/auth/register')
    .send({ orgName, email, password: 'Passw0rd!', fullName: `${orgName} Admin` });
  expect(res.status).toBe(201);
  return res.body.token;
}

async function registerViaInvite(adminToken, role, email) {
  const inv = await request
    .post('/api/org/invite')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ role });
  expect(inv.status).toBe(201);
  const res = await request.post('/api/auth/register').send({
    email,
    password: 'Passw0rd!',
    fullName: `${role} user`,
    inviteToken: inv.body.token,
  });
  expect(res.status).toBe(201);
  return res.body.token;
}

describe('RBAC and cross-org isolation', () => {
  let adminA, employeeA, managerA, hrA, adminB;

  beforeAll(async () => {
    adminA = await registerAdmin('Org Alpha', 'admin@alpha.test');
    employeeA = await registerViaInvite(adminA, 'employee', 'employee@alpha.test');
    managerA = await registerViaInvite(adminA, 'manager', 'manager@alpha.test');
    hrA = await registerViaInvite(adminA, 'hr', 'hr@alpha.test');
    adminB = await registerAdmin('Org Beta', 'admin@beta.test');
  });

  test('employee gets 403 on /api/team/participants', async () => {
    const res = await request
      .get('/api/team/participants')
      .set('Authorization', `Bearer ${employeeA}`);
    expect(res.status).toBe(403);
  });

  test('manager gets 403 on /api/org/roster', async () => {
    const res = await request
      .get('/api/org/roster')
      .set('Authorization', `Bearer ${managerA}`);
    expect(res.status).toBe(403);
  });

  test('hr can access /api/reports', async () => {
    const res = await request
      .get('/api/reports')
      .set('Authorization', `Bearer ${hrA}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('summary');
    expect(res.body).toHaveProperty('dimensionTrends');
    expect(res.body).toHaveProperty('projectBreakdown');
  });

  test('user from org A cannot read org B meeting', async () => {
    // Org B admin analyzes a meeting
    const created = await request
      .post('/api/meetings/analyze')
      .set('Authorization', `Bearer ${adminB}`)
      .field('title', 'Org B private meeting')
      .field(
        'text',
        'Dana: This is confidential to Org Beta.\nEli: Agreed, keep it internal.\nDana: Decision made — we ship Friday.'
      );
    expect(created.status).toBe(201);
    const meetingId = created.body.meetingId;

    // Org A admin must not be able to read it
    const res = await request
      .get(`/api/meetings/${meetingId}`)
      .set('Authorization', `Bearer ${adminA}`);
    expect([403, 404]).toContain(res.status);
  });
});

describe('end-to-end analyze pipeline (STORAGE_MODE=local)', () => {
  test('POST /api/meetings/analyze writes bronze + silver and a successful pipeline_runs row', async () => {
    const token = await registerAdmin('Org Lake', 'admin@lake.test');

    const res = await request
      .post('/api/meetings/analyze')
      .set('Authorization', `Bearer ${token}`)
      .field('title', 'Pipeline e2e meeting')
      .field(
        'text',
        [
          'Ana Torres: Quick update — the migration finished in staging last night.',
          'Ben Cho: How do we want to roll this out to existing customers?',
          'Ana Torres: I propose a phased rollout starting with the two pilot accounts.',
          'Ben Cho: Agreed — decision made, phased rollout starts Monday.',
          'Ana Torres: I will document the criteria and send them tonight.',
        ].join('\n')
      );
    expect(res.status).toBe(201);
    const meetingId = res.body.meetingId;

    // Response shape: speakers with normalized scores
    const speakers = res.body.meeting.speakers;
    expect(speakers.length).toBe(2);
    for (const s of speakers) {
      for (const k of ['engagement', 'sentiment', 'collaboration', 'initiative', 'clarity']) {
        expect(s.scores[k]).toBeGreaterThanOrEqual(0);
        expect(s.scores[k]).toBeLessThanOrEqual(1);
      }
    }

    // Bronze + silver files exist in the local lake
    const all = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        e.isDirectory() ? walk(p) : all.push(p);
      }
    })(LAKE_DIR);

    const bronze = all.find((p) => p.includes(`${path.sep}bronze${path.sep}`) && p.endsWith(`${meetingId}.txt`));
    const silver = all.find((p) => p.includes(`${path.sep}silver${path.sep}`) && p.endsWith(`meeting=${meetingId}.json`));
    expect(bronze).toBeDefined();
    expect(silver).toBeDefined();

    // Bronze holds the raw transcript
    expect(fs.readFileSync(bronze, 'utf8')).toContain('Ana Torres: Quick update');

    // Silver holds flat per-speaker records as JSONL (one record per line)
    const records = fs
      .readFileSync(silver, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(records.length).toBe(2);
    expect(records[0]).toMatchObject({ meeting_id: meetingId, title: 'Pipeline e2e meeting' });
    expect(typeof records[0].score_engagement).toBe('number');

    // pipeline_runs row: successful, with duration and scoring method
    const run = db
      .prepare('SELECT * FROM pipeline_runs WHERE meeting_id = ?')
      .get(meetingId);
    expect(run).toBeDefined();
    expect(run.success).toBe(1);
    expect(run.speaker_count).toBe(2);
    expect(run.scoring_method).toBe('heuristic'); // no API key / ML in tests
    expect(run.source).toBe('manual');
    expect(run.duration_ms).toBeGreaterThanOrEqual(0);
    expect(run.completed_at).toBeTruthy();
    expect(JSON.parse(run.quality_warnings)).toEqual([]);
  });
});
