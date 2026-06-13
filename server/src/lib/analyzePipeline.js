const db = require('./db');
const { resolveAliases } = require('./db');
const { segmentTranscript } = require('./segment');
const { aggregateTurnsBySpeaker } = require('./metrics');
const { scoreDimensionsDetailed, buildCoaching, buildCoachingClaude } = require('./classify');
const { embedText, chunkText } = require('./embeddings');
const { getDataLake } = require('./dataLake');

function meetingEfficiencyScore(speakers, avgEngagement) {
  const n = speakers.length;
  if (n <= 1) return round2(avgEngagement * 0.9);
  const ratios = speakers.map((s) => s.talkRatio).sort((a, b) => b - a);
  const dominance = ratios[0] - (ratios[1] || 0);
  const balancePenalty = dominance > 0.5 ? 0.15 : dominance > 0.35 ? 0.08 : 0;
  const decisionDensity =
    speakers.reduce((sum, s) => sum + s.utteranceBreakdown.decisions, 0) /
    Math.max(1, speakers.reduce((sum, s) => sum + s.turnCount, 0));
  const boost = Math.min(0.15, decisionDensity * 2);
  return round2(
    Math.max(0.1, Math.min(1, avgEngagement * 0.7 + 0.2 - balancePenalty + boost))
  );
}

function round2(x) {
  return Math.round(Math.max(0, Math.min(1, x)) * 100) / 100;
}

const SCORE_KEYS = ['engagement', 'sentiment', 'collaboration', 'initiative', 'clarity'];

/**
 * Inline data-quality validation. Mutates scores in place (clamping) and
 * returns an array of human-readable warning strings for pipeline_runs.
 */
function validateSpeaker(speaker, warnings) {
  if (!speaker.speaker_name || !speaker.speaker_name.trim()) {
    speaker.speaker_name = 'Unknown Speaker';
    warnings.push('Empty speaker name replaced with "Unknown Speaker"');
  }
  for (const k of SCORE_KEYS) {
    const v = speaker.scores[k];
    if (typeof v !== 'number' || Number.isNaN(v)) {
      speaker.scores[k] = 0.5;
      warnings.push(`Score ${k} for "${speaker.speaker_name}" was not a number; defaulted to 0.5`);
    } else if (v < 0 || v > 1) {
      speaker.scores[k] = Math.max(0, Math.min(1, v));
      warnings.push(`Score ${k}=${v} for "${speaker.speaker_name}" out of [0,1]; clamped to ${speaker.scores[k]}`);
    }
  }
}

async function analyzeTranscript(rawText, title) {
  const qualityWarnings = [];
  const turns = segmentTranscript(rawText);
  if (turns.length < 1) {
    qualityWarnings.push('Transcript produced zero speaker turns');
    const err = new Error('Transcript produced zero speaker turns');
    err.qualityWarnings = qualityWarnings;
    throw err;
  }
  const { speakers, totalWords } = aggregateTurnsBySpeaker(turns);
  const avgTalkRatio =
    speakers.length > 0 ? speakers.reduce((s, x) => s + x.talkRatio, 0) / speakers.length : 0;

  const enriched = [];
  const methodsUsed = new Set();
  let sumEng = 0;

  for (const sp of speakers) {
    const { scores, method } = await scoreDimensionsDetailed(
      sp.combinedText,
      sp.talkRatio,
      sp.turnCount
    );
    methodsUsed.add(method);
    let coaching = null;
    if (process.env.ANTHROPIC_API_KEY) {
      coaching = await buildCoachingClaude(
        sp.name, scores, sp.talkRatio, avgTalkRatio,
        sp.utteranceBreakdown, sp.turnCount, sp.combinedText
      );
    }
    if (!coaching) {
      coaching = buildCoaching(
        sp.name, scores, sp.talkRatio, avgTalkRatio,
        sp.utteranceBreakdown, sp.turnCount
      );
    }
    let embJson = null;
    const emb = await embedText(sp.combinedText.slice(0, 800));
    if (emb) embJson = JSON.stringify(emb);

    const speaker = {
      speaker_name: sp.name,
      word_count: sp.wordCount,
      turn_count: sp.turnCount,
      talk_ratio: round2(sp.talkRatio),
      scores,
      utterance_breakdown: sp.utteranceBreakdown,
      coaching_text: coaching,
      embedding_json: embJson,
    };
    validateSpeaker(speaker, qualityWarnings);
    sumEng += speaker.scores.engagement;
    enriched.push(speaker);
  }

  const avgEngagement =
    enriched.length > 0 ? sumEng / enriched.length : 0;
  const efficiency = meetingEfficiencyScore(
    enriched.map((e) => ({
      talkRatio: e.talk_ratio,
      utteranceBreakdown: e.utterance_breakdown,
      turnCount: e.turn_count,
    })),
    avgEngagement
  );

  const sorted = [...enriched].sort((a, b) => b.talk_ratio - a.talk_ratio);
  const dominant_speaker_alert =
    enriched.length >= 3 && sorted[0].talk_ratio > 0.55 ? 1 : 0;
  const low_engagement_alert = avgEngagement < 0.38 ? 1 : 0;

  const summary = buildSummary(title, enriched, totalWords, efficiency);

  const chunkEmbeddings = [];
  if (process.env.USE_ML !== '0') {
    const chunks = chunkText(rawText, 450);
    let idx = 0;
    for (const ch of chunks) {
      const v = await embedText(ch);
      if (v) {
        chunkEmbeddings.push({
          chunk_index: idx++,
          text_snippet: ch,
          embedding_json: JSON.stringify(v),
        });
      }
    }
  }

  // Report the highest-fidelity method that contributed to this analysis.
  const scoringMethod = methodsUsed.has('claude')
    ? 'claude'
    : methodsUsed.has('transformers')
      ? 'transformers'
      : 'heuristic';

  return {
    turns: turns.length,
    speakers: enriched,
    summary,
    efficiency_score: efficiency,
    dominant_speaker_alert,
    low_engagement_alert,
    chunkEmbeddings,
    scoringMethod,
    qualityWarnings,
  };
}

function buildSummary(title, speakers, totalWords, efficiency) {
  const names = speakers.map((s) => s.speaker_name).join(', ');
  const top = [...speakers].sort((a, b) => b.talk_ratio - a.talk_ratio)[0];
  const parts = [
    `"${title}" included ${speakers.length} participant(s) (${names}) with ${totalWords} words total.`,
    `Meeting efficiency index: ${(efficiency * 100).toFixed(0)}/100.`,
  ];
  if (top) {
    parts.push(
      `Highest share of airtime: ${top.speaker_name} (${(top.talk_ratio * 100).toFixed(0)}%).`
    );
  }
  return parts.join(' ');
}

// ── Persistence ────────────────────────────────────────────────────────────────

/**
 * Inserts speaker_results rows writing both the normalized score columns
 * (the read path for the whole app) and the legacy JSON blobs (back-compat).
 */
function insertSpeakerResults(meetingId, speakers, orgId) {
  const aliasMap = orgId ? resolveAliases(orgId) : new Map();
  const insertS = db.prepare(`
    INSERT INTO speaker_results
    (meeting_id, speaker_name, word_count, turn_count, talk_ratio, scores_json,
     utterance_breakdown_json, coaching_text, embedding_json, user_id, org_id,
     score_engagement, score_sentiment, score_collaboration, score_initiative, score_clarity,
     ub_ideas, ub_questions, ub_decisions, ub_filler)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const s of speakers) {
    const speakerUserId = aliasMap.get(s.speaker_name) || null;
    insertS.run(
      meetingId,
      s.speaker_name,
      s.word_count,
      s.turn_count,
      s.talk_ratio,
      JSON.stringify(s.scores),
      JSON.stringify(s.utterance_breakdown),
      s.coaching_text ?? '',
      s.embedding_json ?? null,
      speakerUserId,
      orgId ?? null,
      s.scores.engagement,
      s.scores.sentiment,
      s.scores.collaboration,
      s.scores.initiative,
      s.scores.clarity,
      s.utterance_breakdown.ideas,
      s.utterance_breakdown.questions,
      s.utterance_breakdown.decisions,
      s.utterance_breakdown.filler
    );
  }
}

function insertChunks(meetingId, chunkEmbeddings) {
  const insertC = db.prepare(
    `INSERT INTO meeting_chunks (meeting_id, chunk_index, text_snippet, embedding_json)
     VALUES (?, ?, ?, ?)`
  );
  for (const c of chunkEmbeddings) {
    insertC.run(meetingId, c.chunk_index, c.text_snippet, c.embedding_json);
  }
}

/**
 * Full ingest pipeline used by every analysis path (manual upload, Teams
 * auto-poll, Teams import, live bot). Records a pipeline_runs row at start
 * and updates it on completion/failure with duration, speaker count, the
 * scoring method actually used, and any data-quality warnings.
 *
 * Returns { meetingId, analysis }.
 */
async function runMeetingPipeline({
  rawText,
  title,
  userId,
  orgId = null,
  source = 'manual',
  projectId = null,
  scheduledAt = null,
  uploadedBy = null,
  teamsMeetingId = null,
  teamsTranscriptId = null,
}) {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const runId = db
    .prepare(
      `INSERT INTO pipeline_runs (meeting_id, org_id, started_at, source)
       VALUES (NULL, ?, ?, ?) RETURNING id`
    )
    .get(orgId, startedAt, source).id;

  try {
    const analysis = await analyzeTranscript(rawText, title);
    const created_at = new Date().toISOString();

    const rowM = db
      .prepare(
        `INSERT INTO meetings (user_id, title, raw_text, summary, efficiency_score, dominant_speaker_alert,
          low_engagement_alert, created_at, project_id, scheduled_at, uploaded_by, source,
          teams_meeting_id, teams_transcript_id, org_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
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
        projectId,
        scheduledAt,
        uploadedBy ?? userId,
        source,
        teamsMeetingId,
        teamsTranscriptId,
        orgId
      );
    const meetingId = rowM.id;

    insertSpeakerResults(meetingId, analysis.speakers, orgId);
    insertChunks(meetingId, analysis.chunkEmbeddings);

    // Best-effort medallion lake writes (bronze = raw transcript, silver =
    // flat per-speaker records). DataLake never throws — lake failures must
    // never fail an ingest.
    const lake = getDataLake();
    await lake.writeBronze(meetingId, orgId, rawText, source, created_at);
    const meetingRow = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId);
    const speakerRows = db.prepare('SELECT * FROM speaker_results WHERE meeting_id = ?').all(meetingId);
    await lake.writeSilver(meetingId, orgId, meetingRow, speakerRows, created_at);

    db.prepare(
      `UPDATE pipeline_runs
       SET meeting_id = ?, completed_at = ?, duration_ms = ?, speaker_count = ?,
           scoring_method = ?, success = 1, quality_warnings = ?
       WHERE id = ?`
    ).run(
      meetingId,
      new Date().toISOString(),
      Date.now() - t0,
      analysis.speakers.length,
      analysis.scoringMethod,
      JSON.stringify(analysis.qualityWarnings),
      runId
    );

    return { meetingId, analysis };
  } catch (e) {
    db.prepare(
      `UPDATE pipeline_runs
       SET completed_at = ?, duration_ms = ?, success = 0, error_message = ?, quality_warnings = ?
       WHERE id = ?`
    ).run(
      new Date().toISOString(),
      Date.now() - t0,
      e.message,
      JSON.stringify(e.qualityWarnings || []),
      runId
    );
    throw e;
  }
}

module.exports = {
  analyzeTranscript,
  meetingEfficiencyScore,
  runMeetingPipeline,
  insertSpeakerResults,
  insertChunks,
};
