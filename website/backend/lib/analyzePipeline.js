const { segmentTranscript } = require('./segment');
const { aggregateTurnsBySpeaker } = require('./metrics');
const { scoreDimensions, buildCoaching, buildCoachingClaude } = require('./classify');
const { embedText, chunkText, cosine } = require('./embeddings');

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

async function analyzeTranscript(rawText, title) {
  const turns = segmentTranscript(rawText);
  const { speakers, totalWords } = aggregateTurnsBySpeaker(turns);
  const avgTalkRatio =
    speakers.length > 0 ? speakers.reduce((s, x) => s + x.talkRatio, 0) / speakers.length : 0;

  const enriched = [];
  let sumEng = 0;

  for (const sp of speakers) {
    const scores = await scoreDimensions(
      sp.combinedText,
      sp.talkRatio,
      sp.turnCount
    );
    sumEng += scores.engagement;
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

    enriched.push({
      speaker_name: sp.name,
      word_count: sp.wordCount,
      turn_count: sp.turnCount,
      talk_ratio: round2(sp.talkRatio),
      scores,
      utterance_breakdown: sp.utteranceBreakdown,
      coaching_text: coaching,
      embedding_json: embJson,
    });
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

  return {
    turns: turns.length,
    speakers: enriched,
    summary,
    efficiency_score: efficiency,
    dominant_speaker_alert,
    low_engagement_alert,
    chunkEmbeddings,
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

module.exports = { analyzeTranscript, meetingEfficiencyScore };
