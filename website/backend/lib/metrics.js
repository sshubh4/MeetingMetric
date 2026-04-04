const IDEA_WORDS = /\b(idea|propose|suggest|think we should|what if|innovat|brainstorm)\b/i;
const QUESTION_WORDS = /\?|\b(how|why|what|could you|can we|clarif|question)\b/i;
const DECISION_WORDS = /\b(decide|decision|agreement|approved|locked|go with|ship|sign off|commit to)\b/i;
const FILLER_WORDS = /^(um+|uh+|like|you know|yeah|ok|okay|so|well)[,\s.]*$/i;

function classifyUtteranceType(text) {
  const t = text.trim();
  if (t.length < 8) return 'filler';
  if (FILLER_WORDS.test(t.trim())) return 'filler';
  if (QUESTION_WORDS.test(t) && t.length < 400) return 'questions';
  if (DECISION_WORDS.test(t)) return 'decisions';
  if (IDEA_WORDS.test(t)) return 'ideas';
  if (t.length < 40 && !/\?/.test(t)) return 'filler';
  return 'ideas';
}

function aggregateTurnsBySpeaker(turns) {
  const map = new Map();
  for (const { speaker, text } of turns) {
    if (!map.has(speaker)) {
      map.set(speaker, { name: speaker, segments: [], texts: [] });
    }
    const entry = map.get(speaker);
    entry.segments.push(text);
    entry.texts.push(text);
  }
  const totalWords = turns.reduce(
    (sum, t) => sum + t.text.split(/\s+/).filter(Boolean).length,
    0
  );

  const speakers = [];
  for (const [, v] of map) {
    const words = v.texts.join(' ').split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const breakdown = { ideas: 0, questions: 0, decisions: 0, filler: 0 };
    for (const seg of v.segments) {
      const ty = classifyUtteranceType(seg);
      if (ty === 'ideas') breakdown.ideas += 1;
      else if (ty === 'questions') breakdown.questions += 1;
      else if (ty === 'decisions') breakdown.decisions += 1;
      else breakdown.filler += 1;
    }
    speakers.push({
      name: v.name,
      wordCount,
      turnCount: v.segments.length,
      talkRatio: totalWords > 0 ? wordCount / totalWords : 0,
      segments: v.segments,
      combinedText: v.texts.join('\n'),
      utteranceBreakdown: breakdown,
    });
  }

  return { speakers, totalWords, totalTurns: turns.length };
}

module.exports = { classifyUtteranceType, aggregateTurnsBySpeaker };
