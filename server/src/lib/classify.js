/**
 * Dimension scores 0-1: engagement, sentiment, collaboration, initiative, clarity.
 *
 * Priority: ANTHROPIC_API_KEY (Claude) → @xenova/transformers (USE_ML) → heuristic fallback
 */

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const USE_ML = process.env.USE_ML !== '0';

const DIMENSION_LABELS = [
  {
    key: 'engagement',
    positive: 'actively participating and contributing to the discussion',
    negative: 'passive or minimally involved in the conversation',
  },
  {
    key: 'sentiment',
    positive: 'constructive cooperative and positive tone',
    negative: 'negative critical or dismissive tone',
  },
  {
    key: 'collaboration',
    positive: 'building on others ideas and working together',
    negative: 'dismissive or working in isolation from the group',
  },
  {
    key: 'initiative',
    positive: 'driving topics forward proposing actions and ownership',
    negative: 'only reacting without proposing direction',
  },
  {
    key: 'clarity',
    positive: 'clear articulate and well structured points',
    negative: 'unclear rambling or hard to follow',
  },
];

/* ── Claude scoring ──────────────────────────────────────── */

let anthropic = null;

function getAnthropic() {
  if (!anthropic && ANTHROPIC_KEY) {
    const Anthropic = require('@anthropic-ai/sdk');
    anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
  }
  return anthropic;
}

async function scoreDimensionsClaude(text) {
  const client = getAnthropic();
  const truncated = text.length > 2000 ? text.slice(0, 2000) + '...' : text;

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: `You are an AI meeting analyst. Score the following speaker's transcript on these 5 dimensions, each from 0.00 to 1.00:

1. engagement - how actively they participate and contribute
2. sentiment - how constructive/positive their tone is
3. collaboration - how well they build on others' ideas
4. initiative - how much they drive topics and propose actions
5. clarity - how clear and well-structured their points are

Speaker transcript:
"""
${truncated}
"""

Respond ONLY with valid JSON, no markdown, no explanation:
{"engagement":0.00,"sentiment":0.00,"collaboration":0.00,"initiative":0.00,"clarity":0.00}`,
      },
    ],
  });

  const raw = msg.content[0].text.trim();
  const jsonStr = raw.replace(/```json\s*/g, '').replace(/```/g, '').trim();
  const scores = JSON.parse(jsonStr);

  const out = {};
  for (const dim of DIMENSION_LABELS) {
    out[dim.key] = round2(typeof scores[dim.key] === 'number' ? scores[dim.key] : 0.5);
  }
  return out;
}

/* ── Claude coaching ─────────────────────────────────────── */

async function buildCoachingClaude(name, scores, talkRatio, teamAvgTalkRatio, breakdown, turnCount, text) {
  try {
    const client = getAnthropic();
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: `You are an executive meeting coach. Based on this data for participant "${name}", write 2-3 concise, actionable coaching sentences. Be specific and evidence-based.

Scores (0-1): engagement=${scores.engagement}, sentiment=${scores.sentiment}, collaboration=${scores.collaboration}, initiative=${scores.initiative}, clarity=${scores.clarity}
Talk ratio: ${(talkRatio * 100).toFixed(0)}% (team avg: ${(teamAvgTalkRatio * 100).toFixed(0)}%)
Turns: ${turnCount}, Questions asked: ${breakdown.questions}, Ideas: ${breakdown.ideas}, Decisions: ${breakdown.decisions}

Their transcript excerpt:
"""
${(text || '').slice(0, 800)}
"""

Write coaching feedback directly (no bullet points, no markdown, 2-3 sentences max):`,
        },
      ],
    });
    return msg.content[0].text.trim();
  } catch (e) {
    console.warn('Claude coaching failed:', e.message);
    return null;
  }
}

/* ── Xenova zero-shot scoring ────────────────────────────── */

let classifierPromise = null;

async function getClassifier() {
  if (!classifierPromise) {
    const { pipeline } = await import('@xenova/transformers');
    classifierPromise = pipeline(
      'zero-shot-classification',
      'Xenova/distilbert-base-uncased-mnli'
    );
  }
  return classifierPromise;
}

async function scoreDimensionsML(text) {
  const pipe = await getClassifier();
  const out = {};
  const truncated = text.length > 1500 ? `${text.slice(0, 1500)}…` : text;
  for (const dim of DIMENSION_LABELS) {
    const z = await pipe(truncated, [dim.positive, dim.negative]);
    const idx = z.labels.indexOf(dim.positive);
    const score = idx >= 0 ? z.scores[idx] : 0.5;
    out[dim.key] = round2(score);
  }
  return out;
}

/* ── Heuristic fallback ──────────────────────────────────── */

function heuristicScores(text, talkRatio, turnCount) {
  const lower = text.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean).length;
  const q = (lower.match(/\?/g) || []).length;
  const engagement = Math.min(
    1,
    0.25 + talkRatio * 0.5 + Math.min(turnCount / 8, 1) * 0.25
  );
  const negHits = (lower.match(/\b(no|not|wrong|bad|never|can't|won't)\b/g) || []).length;
  const sentiment = Math.max(0.15, Math.min(1, 0.75 - negHits * 0.05 + q * 0.02));
  const collabHits = (lower.match(
    /\b(we|together|team|agree|build on|thanks|good point)\b/g
  ) || []).length;
  const collaboration = Math.min(
    1,
    0.4 + collabHits * 0.08 + (talkRatio > 0.1 && talkRatio < 0.45 ? 0.15 : 0)
  );
  const initiativeHits = (lower.match(
    /\b(should|let's|propose|i will|i'll|action|next step|owner)\b/g
  ) || []).length;
  const initiative = Math.min(1, 0.35 + initiativeHits * 0.06 + (words > 50 ? 0.15 : 0));
  const clarity = Math.min(
    1,
    0.45 + (text.split(/[.!?]/).filter((s) => s.trim().length > 10).length / 10) * 0.2
  );
  return {
    engagement: round2(engagement),
    sentiment: round2(sentiment),
    collaboration: round2(collaboration),
    initiative: round2(initiative),
    clarity: round2(clarity),
  };
}

/* ── Main dispatcher ─────────────────────────────────────── */

function round2(x) {
  return Math.round(Math.max(0, Math.min(1, x)) * 100) / 100;
}

async function scoreDimensionsDetailed(text, talkRatio, turnCount) {
  if (ANTHROPIC_KEY) {
    try {
      return { scores: await scoreDimensionsClaude(text), method: 'claude' };
    } catch (e) {
      console.warn('Claude scoring failed, falling back:', e.message);
    }
  }
  if (USE_ML) {
    try {
      return { scores: await scoreDimensionsML(text), method: 'transformers' };
    } catch (e) {
      console.warn('ML scoring failed, using heuristics:', e.message);
    }
  }
  return { scores: heuristicScores(text, talkRatio, turnCount), method: 'heuristic' };
}

async function scoreDimensions(text, talkRatio, turnCount) {
  return (await scoreDimensionsDetailed(text, talkRatio, turnCount)).scores;
}

/* ── Heuristic coaching fallback ─────────────────────────── */

function buildCoaching(name, scores, talkRatio, teamAvgTalkRatio, breakdown, turnCount) {
  const lines = [];
  if (talkRatio > 0.45 && teamAvgTalkRatio > 0) {
    lines.push(
      `${name} used about ${(talkRatio * 100).toFixed(0)}% of speaking time (team avg ${(teamAvgTalkRatio * 100).toFixed(0)}%), which can indicate dominance in this meeting.`
    );
  }
  if (talkRatio < 0.08 && talkRatio > 0) {
    lines.push(
      `${name} had a low share of airtime (${(talkRatio * 100).toFixed(0)}%) — check whether quieter roles are intentional.`
    );
  }
  if (scores.initiative < 0.4) {
    lines.push(
      `Initiative score is relatively low; try opening with proposed next steps or owning action items.`
    );
  }
  if (breakdown.questions < 2 && turnCount > 3) {
    lines.push(
      `Few clarifying questions vs. turns (${breakdown.questions} questions); asking more "how" and "what" questions can raise collaboration scores.`
    );
  }
  if (breakdown.ideas > 0 && breakdown.decisions === 0 && turnCount > 4) {
    lines.push(
      `You contributed ideas but rarely drove decisions — consider summarizing agreements before the meeting ends.`
    );
  }
  if (lines.length === 0) {
    lines.push(
      `Scores are balanced for this meeting. Keep reinforcing clear asks and collaborative language.`
    );
  }
  return lines.join(' ');
}

module.exports = {
  DIMENSION_LABELS,
  scoreDimensions,
  scoreDimensionsDetailed,
  heuristicScores,
  buildCoaching,
  buildCoachingClaude,
};
