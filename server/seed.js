/**
 * Rich demo seeder.
 *
 * Gating (SEED_DEMO env):
 *   - Never runs if the database already contains any users or meetings.
 *   - SEED_DEMO=1 forces seeding (on an empty DB).
 *   - SEED_DEMO=0 disables it entirely.
 *   - Unset: seeds automatically in non-production when the DB is empty.
 *
 * Seeds one org, 10 users (admin / hr / 2 managers / 6 employees) with
 * speaker aliases, 4 projects, and 60 meetings spread over the past 6 months
 * with deliberate story arcs:
 *   - Liam O'Connor trends UP over the 6 months
 *   - Chloe Bennett trends DOWN
 *   - Daniel Kim dominates airtime (triggers dominant_speaker_alert)
 *   - a handful of low_engagement_alert meetings
 *
 * Scores are generated directly (no model calls) so seeding is instant, and
 * are written to BOTH the normalized columns and the legacy JSON columns.
 * Every meeting also gets a plausible pipeline_runs row.
 *
 * Run standalone: cd server && npm run seed
 */
require('dotenv').config();

const db = require('./src/lib/db');
const { hashPassword } = require('./src/lib/auth');
const { buildCoaching } = require('./src/lib/classify');

const DEMO_PASSWORD = 'Demo123!';

// Deterministic RNG so re-seeding a fresh DB produces the same demo story.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const between = (lo, hi) => lo + rand() * (hi - lo);
const intBetween = (lo, hi) => Math.floor(between(lo, hi + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const round2 = (x) => Math.round(Math.max(0, Math.min(1, x)) * 100) / 100;

// ── Cast ───────────────────────────────────────────────────────────────────────

const CAST = [
  { key: 'avery',  name: 'Avery Thompson',  email: 'avery.thompson@demo.meetingmetric.local',  role: 'admin',    manager: null },
  { key: 'morgan', name: 'Morgan Reyes',    email: 'morgan.reyes@demo.meetingmetric.local',    role: 'hr',       manager: null },
  { key: 'daniel', name: 'Daniel Kim',      email: 'daniel.kim@demo.meetingmetric.local',      role: 'manager',  manager: null },
  { key: 'sofia',  name: 'Sofia Marchetti', email: 'sofia.marchetti@demo.meetingmetric.local', role: 'manager',  manager: null },
  { key: 'liam',   name: "Liam O'Connor",   email: 'liam.oconnor@demo.meetingmetric.local',    role: 'employee', manager: 'daniel' },
  { key: 'raj',    name: 'Raj Iyer',        email: 'raj.iyer@demo.meetingmetric.local',        role: 'employee', manager: 'daniel' },
  { key: 'emma',   name: 'Emma Lindqvist',  email: 'emma.lindqvist@demo.meetingmetric.local',  role: 'employee', manager: 'daniel' },
  { key: 'chloe',  name: 'Chloe Bennett',   email: 'chloe.bennett@demo.meetingmetric.local',   role: 'employee', manager: 'sofia' },
  { key: 'noah',   name: 'Noah Washington', email: 'noah.washington@demo.meetingmetric.local', role: 'employee', manager: 'sofia' },
  { key: 'grace',  name: 'Grace Park',      email: 'grace.park@demo.meetingmetric.local',      role: 'employee', manager: 'sofia' },
];

const PROJECTS = [
  { name: 'Platform Rebuild',    description: 'Re-architecture of the core platform and data layer',  color: '#55E7FC', department: 'Engineering' },
  { name: 'Customer Onboarding', description: 'Streamlining activation and first-week experience',    color: '#2B80FF', department: 'Product' },
  { name: 'People Analytics',    description: 'HR insights, calibration, and review tooling',         color: '#F59E0B', department: 'People' },
  { name: 'Q3 Launch',           description: 'Cross-team launch planning and go-to-market',          color: '#10B981', department: 'Go-to-market' },
];

const MEETING_TITLES = [
  'Sprint planning', 'Weekly sync', 'Architecture review', 'Roadmap check-in',
  'Incident retro', 'Design critique', 'Pipeline review', 'Stakeholder update',
  'Backlog grooming', 'Launch readiness', 'Metrics deep-dive', 'Hiring sync',
  'Customer feedback review', '1:1 skip-level forum', 'Quarterly planning',
];

// Line templates per utterance flavor; {name} is replaced with another participant.
const LINES = {
  status: [
    'Quick update from my side — the migration scripts are done and tested in staging.',
    'We closed out twelve tickets this week, two are blocked on the API contract.',
    'The onboarding funnel numbers improved four percent after the copy change.',
    'I finished the review pass and left comments on the open pull requests.',
    'Load tests came back green, p95 latency is under two hundred milliseconds.',
  ],
  question: [
    'How do we want to handle the rollout for existing customers?',
    'What is the deadline for the security review, and who owns it?',
    'Can we get one more pair of eyes on the schema change before Friday?',
    'Do we have budget to extend the contractor for another month?',
    'Why did the conversion numbers dip last week — do we know yet?',
  ],
  idea: [
    'What if we shipped the CSV export first and added PDF in the next cycle?',
    'I propose we pilot this with two enterprise accounts before widening the beta.',
    'We could batch the nightly jobs and cut the warehouse cost roughly in half.',
    'I think we should add a feedback widget right inside the onboarding flow.',
    'One idea: route the alerts through the on-call channel instead of email.',
  ],
  decision: [
    'Agreed — let us lock that scope and ship it. I will sign off on the spec today.',
    'Decision made: we go with the phased rollout starting Monday.',
    'Let us commit to the two-pilot approach and revisit in four weeks.',
    'Approved. {name}, can you document the criteria and send them tonight?',
    'We are going with option B — I will update the board after this call.',
  ],
  ack: [
    'Sounds good to me.',
    'Works for me — I will pick that up.',
    'Makes sense, thanks for clarifying.',
    'Yes, I can own that by end of week.',
    'No objections from my side.',
  ],
};

// ── Gating ─────────────────────────────────────────────────────────────────────

function shouldSeed(log) {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const meetingCount = db.prepare('SELECT COUNT(*) AS c FROM meetings').get().c;
  if (userCount > 0 || meetingCount > 0) {
    if (process.env.SEED_DEMO === '1') {
      log(`SEED_DEMO=1 but database already has data (${userCount} users, ${meetingCount} meetings) — skipping.`);
    }
    return false;
  }
  if (process.env.SEED_DEMO === '1') return true;
  if (process.env.SEED_DEMO === '0') return false;
  return process.env.NODE_ENV !== 'production';
}

// ── Generators ─────────────────────────────────────────────────────────────────

/**
 * Per-speaker base personalities (0-1 score tendencies). progress is 0..1
 * across the 6-month window and drives the trend arcs.
 */
function baseScores(key, progress) {
  const noise = () => between(-0.06, 0.06);
  let base;
  switch (key) {
    case 'liam':   base = 0.35 + 0.45 * progress; break;      // trending up
    case 'chloe':  base = 0.78 - 0.38 * progress; break;      // trending down
    case 'daniel': base = 0.72; break;                        // strong but domineering
    case 'avery':  base = 0.68; break;
    case 'morgan': base = 0.64; break;
    case 'sofia':  base = 0.70; break;
    default:       base = between(0.5, 0.7);
  }
  const b = () => round2(Math.max(0.05, Math.min(0.98, base + noise())));
  return {
    engagement: b(),
    sentiment: b(),
    collaboration: round2(Math.max(0.05, Math.min(0.98, base + noise() + (key === 'daniel' ? -0.12 : 0)))),
    initiative: round2(Math.max(0.05, Math.min(0.98, base + noise() + (key === 'daniel' ? 0.1 : 0)))),
    clarity: b(),
  };
}

function buildTranscript(participants, talkRatios) {
  const turnsTotal = intBetween(5, 10);
  const lines = [];
  // Weighted round-robin: heavier talkers get more turns.
  const weighted = [];
  participants.forEach((p, i) => {
    const n = Math.max(1, Math.round(talkRatios[i] * turnsTotal * 1.5));
    for (let j = 0; j < n; j++) weighted.push(p);
  });
  const flavors = ['status', 'question', 'idea', 'decision', 'ack'];
  const usedLines = new Set();
  let prevSpeaker = null;
  for (let t = 0; t < turnsTotal; t++) {
    let sp = t === 0 ? participants[0] : pick(weighted);
    // Avoid back-to-back turns from the same person when possible
    for (let tries = 0; sp === prevSpeaker && tries < 4 && participants.length > 1; tries++) sp = pick(weighted);
    const other = pick(participants.filter((p) => p !== sp)) || sp;
    const flavor = t === 0 ? 'status' : t === turnsTotal - 1 ? 'decision' : pick(flavors);
    let line = pick(LINES[flavor]);
    for (let tries = 0; usedLines.has(line) && tries < 6; tries++) line = pick(LINES[pick(flavors)]);
    usedLines.add(line);
    lines.push(`${sp.name}: ${line.replace('{name}', other.name.split(' ')[0])}`);
    prevSpeaker = sp;
  }
  return lines.join('\n');
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(logger) {
  const log = (msg) => (logger ? logger.info(msg) : console.log(msg));

  if (!shouldSeed(log)) {
    if (process.env.SEED_DEMO !== '1') log('Seeder: skipped (data exists or seeding disabled).');
    return;
  }

  log('Seeder: empty database — creating demo org, 10 users, 4 projects, 60 meetings…');
  const nowIso = new Date().toISOString();

  // Org
  const org = db
    .prepare('INSERT INTO organizations (name, slug, created_at) VALUES (?, ?, ?) RETURNING id')
    .get('Northwind Labs', 'northwind-labs', nowIso);
  const orgId = org.id;

  // Users + aliases (joined ~7 months ago)
  const joinedAt = new Date(Date.now() - 215 * 86400000).toISOString();
  const passwordHash = hashPassword(DEMO_PASSWORD);
  const insertUser = db.prepare(
    `INSERT INTO users (email, password_hash, created_at, full_name, role, org_id, manager_id, active, joined_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) RETURNING id`
  );
  const idByKey = {};
  for (const c of CAST) {
    idByKey[c.key] = insertUser.get(c.email, passwordHash, joinedAt, c.name, c.role, orgId, null, joinedAt).id;
  }
  const setManager = db.prepare('UPDATE users SET manager_id = ? WHERE id = ?');
  for (const c of CAST) {
    if (c.manager) setManager.run(idByKey[c.manager], idByKey[c.key]);
  }
  const insertAlias = db.prepare(
    'INSERT INTO speaker_aliases (user_id, org_id, alias_name, created_at) VALUES (?, ?, ?, ?)'
  );
  for (const c of CAST) insertAlias.run(idByKey[c.key], orgId, c.name, joinedAt);

  // Projects (owned by the admin)
  const adminId = idByKey.avery;
  const insertProject = db.prepare(
    'INSERT INTO projects (user_id, name, description, color, created_at, department) VALUES (?, ?, ?, ?, ?, ?) RETURNING id'
  );
  const projectIds = PROJECTS.map((p) =>
    insertProject.get(adminId, p.name, p.description, p.color, joinedAt, p.department).id
  );

  // Meetings
  const insertMeeting = db.prepare(
    `INSERT INTO meetings (user_id, title, raw_text, summary, efficiency_score, dominant_speaker_alert,
      low_engagement_alert, created_at, project_id, scheduled_at, uploaded_by, source,
      teams_meeting_id, teams_transcript_id, org_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  );
  const insertSpeaker = db.prepare(
    `INSERT INTO speaker_results
     (meeting_id, speaker_name, word_count, turn_count, talk_ratio, scores_json,
      utterance_breakdown_json, coaching_text, embedding_json, user_id, org_id,
      score_engagement, score_sentiment, score_collaboration, score_initiative, score_clarity,
      ub_ideas, ub_questions, ub_decisions, ub_filler)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertRun = db.prepare(
    `INSERT INTO pipeline_runs (meeting_id, org_id, started_at, completed_at, duration_ms,
      speaker_count, scoring_method, source, success, error_message, quality_warnings)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, '[]')`
  );

  const TOTAL = 60;
  const WINDOW_DAYS = 180;
  let dominantAlerts = 0;
  let lowEngagementMeetings = 0;

  for (let i = 0; i < TOTAL; i++) {
    const progress = i / (TOTAL - 1); // 0 = 6 months ago, 1 = now
    const daysAgo = WINDOW_DAYS - progress * (WINDOW_DAYS - 2) + between(-1, 1);
    const scheduled = new Date(Date.now() - daysAgo * 86400000);
    scheduled.setHours(intBetween(9, 16), pick([0, 15, 30, 45]), 0, 0);
    const scheduledAt = scheduled.toISOString();
    const createdAt = new Date(scheduled.getTime() + intBetween(45, 120) * 60000).toISOString();

    const source = i % 10 < 3 ? 'teams_auto' : 'manual'; // ~30% / ~70%
    const projectId = projectIds[i % projectIds.length];

    // 4-7 speakers; Daniel appears in most meetings to build the dominance arc
    const speakerCount = intBetween(4, 7);
    const pool = [...CAST];
    const participants = [];
    if (i % 3 !== 2) {
      participants.push(CAST.find((c) => c.key === 'daniel'));
      pool.splice(pool.findIndex((c) => c.key === 'daniel'), 1);
    }
    while (participants.length < speakerCount && pool.length) {
      const idx = Math.floor(rand() * pool.length);
      participants.push(pool.splice(idx, 1)[0]);
    }

    // Talk ratios: dominant meetings give Daniel 56-68% of airtime
    const danielIdx = participants.findIndex((c) => c.key === 'daniel');
    const dominantMeeting = danielIdx >= 0 && i % 5 === 0;
    let weights = participants.map(() => between(0.6, 1.4));
    if (dominantMeeting) weights[danielIdx] = weights.reduce((a, b) => a + b, 0) * between(1.3, 2.1);
    else if (danielIdx >= 0) weights[danielIdx] *= 1.6;
    const wSum = weights.reduce((a, b) => a + b, 0);
    const talkRatios = weights.map((w) => w / wSum);

    // Low-engagement story meetings sprinkled through the middle of the window
    const lowEngagement = i % 13 === 6;

    const rawText = buildTranscript(participants, talkRatios);
    const totalWords = intBetween(420, 980);

    const speakerRows = participants.map((p, idx) => {
      const scores = baseScores(p.key, progress);
      if (lowEngagement) {
        for (const k of Object.keys(scores)) scores[k] = round2(Math.min(scores[k], between(0.15, 0.34)));
      }
      const turnCount = Math.max(1, Math.round(talkRatios[idx] * intBetween(8, 14)));
      const breakdown = {
        ideas: intBetween(0, Math.max(1, turnCount - 1)),
        questions: intBetween(0, 2),
        decisions: rand() < 0.45 ? intBetween(1, 2) : 0,
        filler: intBetween(0, 2),
      };
      const avgRatio = 1 / participants.length;
      return {
        speaker: p,
        scores,
        talkRatio: round2(talkRatios[idx]),
        wordCount: Math.max(12, Math.round(talkRatios[idx] * totalWords)),
        turnCount,
        breakdown,
        coaching: buildCoaching(p.name, scores, talkRatios[idx], avgRatio, breakdown, turnCount),
      };
    });

    const avgEngagement = speakerRows.reduce((s, r) => s + r.scores.engagement, 0) / speakerRows.length;
    // Efficiency spread realistically across 0.35-0.92
    const efficiency = round2(Math.max(0.35, Math.min(0.92, avgEngagement * 0.85 + between(0.08, 0.38))));
    const dominantAlert = dominantMeeting && speakerRows.length >= 3 && talkRatios[danielIdx] > 0.55 ? 1 : 0;
    const lowAlert = avgEngagement < 0.38 ? 1 : 0;
    dominantAlerts += dominantAlert;
    lowEngagementMeetings += lowAlert;

    const title = `${pick(MEETING_TITLES)} — ${PROJECTS[i % projectIds.length].name}`;
    const ownerKey = source === 'teams_auto' ? 'daniel' : pick(participants).key;
    const summary = `"${title}" included ${speakerRows.length} participant(s) (${participants.map((p) => p.name).join(', ')}) with ${totalWords} words total. Meeting efficiency index: ${Math.round(efficiency * 100)}/100.`;

    const meetingId = insertMeeting.get(
      idByKey[ownerKey], title, rawText, summary, efficiency, dominantAlert, lowAlert,
      createdAt, projectId, scheduledAt, idByKey[ownerKey], source,
      source === 'teams_auto' ? `demo-teams-meeting-${i}` : null,
      source === 'teams_auto' ? `demo-teams-transcript-${i}` : null,
      orgId
    ).id;

    for (const r of speakerRows) {
      insertSpeaker.run(
        meetingId, r.speaker.name, r.wordCount, r.turnCount, r.talkRatio,
        JSON.stringify(r.scores), JSON.stringify(r.breakdown), r.coaching, null,
        idByKey[r.speaker.key], orgId,
        r.scores.engagement, r.scores.sentiment, r.scores.collaboration, r.scores.initiative, r.scores.clarity,
        r.breakdown.ideas, r.breakdown.questions, r.breakdown.decisions, r.breakdown.filler
      );
    }

    insertRun.run(
      meetingId, orgId, createdAt,
      new Date(new Date(createdAt).getTime() + intBetween(900, 4200)).toISOString(),
      intBetween(900, 4200), speakerRows.length, 'heuristic', source
    );
  }

  log(`Seeder: done — 60 meetings, ${dominantAlerts} dominant-speaker alerts, ${lowEngagementMeetings} low-engagement meetings.`);
  log(`Seeder: login as avery.thompson@demo.meetingmetric.local / ${DEMO_PASSWORD} (admin). All demo users share the same password.`);
}

module.exports = main;

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
