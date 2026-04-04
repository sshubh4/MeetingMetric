/**
 * Seeds a demo user and realistic multi-speaker meetings.
 * Uses Claude when ANTHROPIC_API_KEY is set (via .env), otherwise heuristic fallback.
 * Run: cd website/backend && npm run seed
 */
require('dotenv').config();

const db = require('./lib/db');
const { createUser, getUserByEmail } = require('./lib/auth');
const { analyzeTranscript } = require('./lib/analyzePipeline');

const DEMO_EMAIL = 'demo@meetingmetric.local';
const DEMO_PASSWORD = 'Demo123!';

const TRANSCRIPTS = [
  {
    title: 'Q1 Strategy & Resource Alignment',
    scheduled_at: '2026-03-03T14:00:00.000Z',
    text: `Sarah Chen: Thanks everyone for joining. Our goal today is to lock Q1 priorities and agree on owners.

David Okonkwo: From product, we need the analytics dashboard shipped by week six. I am concerned about scope creep on the export feature.

Marcus Webb: Engineering can commit to the core dashboard. The PDF export might slip unless we cut the custom templates — I propose we ship CSV first and add PDF in Q2.

Priya Patel: Design is aligned. We need two more review cycles with HR for the engagement labels — those are sensitive from a legal standpoint.

Sarah Chen: Good call. Priya, can you own the HR review by next Friday?

Priya Patel: Yes, I will circulate the copy by Wednesday.

David Okonkwo: On revenue, we should decide today whether we pilot with two enterprise accounts or widen the beta.

Marcus Webb: I vote two enterprise pilots — we get deeper feedback without burning support.

Sarah Chen: Agreed. David, document the pilot criteria and send tonight. Marcus, schedule the technical kickoff with those accounts.

David Okonkwo: Will do. I will send the criteria by 6pm.

Sarah Chen: Great — we have a decision on pilots and a path on exports. Next meeting Thursday same time.`,
  },
  {
    title: 'Weekly Engineering Sync',
    scheduled_at: '2026-03-10T16:30:00.000Z',
    text: `Alex Rivera: Quick standup — blockers first.

Jordan Lee: I am blocked on the API rate limit spec. Who owns the final numbers?

Sam Okada: That is on me — I will post the limits in Slack by noon.

Alex Rivera: Thanks. Nina, how is the transcript pipeline?

Nina Park: Stable in staging. I want one more load test before we enable for HR pilot groups.

Alex Rivera: Schedule that for tomorrow morning. Anything else?

Jordan Lee: Can we add a dark mode toggle to the internal demo? Low effort, helps exec reviews.

Sam Okada: I can pair with you Friday if you want.

Alex Rivera: Do it if it does not push the pilot. Otherwise backlog it.

Nina Park: Sounds good. I will update the board with load-test tasks.

Alex Rivera: Alright — ship the spec, load test tomorrow, dark mode only if time. Thanks everyone.`,
  },
  {
    title: 'HR — Performance Calibration (Remote)',
    scheduled_at: '2026-03-18T11:00:00.000Z',
    text: `Taylor Morgan: We are calibrating ratings for the northeast pod. Remember we weight meeting contribution only where role expectations include facilitation.

Jamie Foster: I have a concern on one IC who is quiet in large meetings but delivers strong written strategy. We should not penalize introverted styles.

Riley Brooks: Agreed. The transcript tool is one signal — not the whole story. I used it to spot dominance issues, not to rank quiet contributors poorly.

Taylor Morgan: Let us document that in the guidance. Jamie, can you add a paragraph to the manager FAQ?

Jamie Foster: Yes — I will have a draft by end of week.

Riley Brooks: For calibration, I propose we bump the two borderline cases up one notch given delivery quality.

Taylor Morgan: I am comfortable with that if everyone signs off.

Jamie Foster: Sign me in.

Taylor Morgan: Motion carries. Next — we align on promotion readiness for two leads.`,
  },
];

async function persistMeeting(userId, projectId, title, rawText, scheduledAt, analysis) {
  const created_at = new Date().toISOString();
  const rowM = db
    .prepare(
      `INSERT INTO meetings (user_id, title, raw_text, summary, efficiency_score, dominant_speaker_alert, low_engagement_alert, created_at, project_id, scheduled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .get(
      userId,
      title,
      rawText,
      analysis.summary ?? '',
      Number(analysis.efficiency_score ?? 0),
      analysis.dominant_speaker_alert ? 1 : 0,
      analysis.low_engagement_alert ? 1 : 0,
      created_at,
      projectId == null ? null : Number(projectId),
      scheduledAt == null ? null : String(scheduledAt)
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
      s.coaching_text ?? '',
      s.embedding_json ?? null
    );
  }

  const insertC = db.prepare(`
    INSERT INTO meeting_chunks (meeting_id, chunk_index, text_snippet, embedding_json)
    VALUES (?, ?, ?, ?)
  `);
  for (const c of analysis.chunkEmbeddings) {
    insertC.run(meetingId, c.chunk_index, c.text_snippet, c.embedding_json);
  }

  return meetingId;
}

async function main() {
  let user = getUserByEmail(DEMO_EMAIL);
  if (!user) {
    const created = createUser(DEMO_EMAIL, DEMO_PASSWORD);
    user = { id: created.id };
    console.log(`Created demo user: ${DEMO_EMAIL}`);
  } else {
    console.log(`Demo user already exists: ${DEMO_EMAIL}`);
  }

  const uid = user.id;

  const existingMeetings = db.prepare('SELECT COUNT(*) AS c FROM meetings WHERE user_id = ?').get(uid).c;
  if (existingMeetings > 0) {
    console.log(
      `User already has ${existingMeetings} meeting(s). Delete rows or use a fresh DB to re-seed. Skipping inserts.`
    );
    console.log(`\nLogin: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
    return;
  }

  const now = new Date().toISOString();
  function ensureProject(name, description, color) {
    const row = db.prepare('SELECT id FROM projects WHERE user_id = ? AND name = ?').get(uid, name);
    if (row) return row.id;
    return db
      .prepare(
        'INSERT INTO projects (user_id, name, description, color, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id'
      )
      .get(uid, name, description, color, now).id;
  }

  const p1 = ensureProject(
    'Executive initiatives',
    'Strategy, pilots, and leadership forums',
    '#55E7FC'
  );
  const p2 = ensureProject(
    'People & HR',
    'Calibration, policy, and people analytics',
    '#2B80FF'
  );

  const projectFor = (i) => (i === 2 ? p2 : p1);

  for (let i = 0; i < TRANSCRIPTS.length; i++) {
    const t = TRANSCRIPTS[i];
    const analysis = await analyzeTranscript(t.text, t.title);
    const mid = await persistMeeting(uid, projectFor(i), t.title, t.text, t.scheduled_at, analysis);
    console.log(`Seeded meeting #${mid}: ${t.title}`);
  }

  console.log(`\nDone. Login with:\n  Email: ${DEMO_EMAIL}\n  Password: ${DEMO_PASSWORD}`);
}

module.exports = main;

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
