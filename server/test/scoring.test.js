'use strict';

// Force the deterministic heuristic path — no model downloads, no API calls.
process.env.USE_ML = '0';
delete process.env.ANTHROPIC_API_KEY;

const { test } = require('node:test');
const assert = require('node:assert');

const { segmentTranscript } = require('../src/lib/segment');
const { aggregateTurnsBySpeaker, classifyUtteranceType } = require('../src/lib/metrics');
const { meetingEfficiencyScore } = require('../src/lib/analyzePipeline');

test('segmentTranscript splits "Name: text" into speaker turns', () => {
  const turns = segmentTranscript('Alice: Hello team.\nBob: Hi Alice.\nAlice: Let us start.');
  assert.equal(turns.length, 3);
  assert.equal(turns[0].speaker, 'Alice');
  assert.equal(turns[0].text, 'Hello team.');
  assert.equal(turns[1].speaker, 'Bob');
});

test('segmentTranscript strips a parenthetical role from the speaker name', () => {
  const turns = segmentTranscript('Sarah Chen (PM): We should ship.');
  assert.equal(turns[0].speaker, 'Sarah Chen');
  assert.equal(turns[0].text, 'We should ship.');
});

test('segmentTranscript does not treat a URL as a speaker name', () => {
  const turns = segmentTranscript('Alice: Check the link.\nhttps://example.com/x: spurious');
  assert.ok(turns.every((t) => !t.speaker.includes('http')), 'a URL must not become a speaker');
  assert.ok(turns.some((t) => t.speaker === 'Alice'));
});

test('segmentTranscript falls back to a single Unknown turn for unstructured text', () => {
  const turns = segmentTranscript('just some free-form text with no speakers');
  assert.equal(turns.length, 1);
  assert.equal(turns[0].speaker, 'Unknown');
});

test('aggregateTurnsBySpeaker computes talk ratios that sum to 1', () => {
  const turns = segmentTranscript('Alice: one two three four.\nBob: five six.');
  const { speakers, totalWords } = aggregateTurnsBySpeaker(turns);
  assert.equal(speakers.length, 2);
  assert.equal(totalWords, 6);
  const sum = speakers.reduce((s, sp) => s + sp.talkRatio, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, 'talk ratios should sum to 1');
  const alice = speakers.find((s) => s.name === 'Alice');
  assert.equal(alice.wordCount, 4);
  assert.ok(Math.abs(alice.talkRatio - 4 / 6) < 1e-9);
});

test('classifyUtteranceType recognises questions, decisions and filler', () => {
  assert.equal(classifyUtteranceType('How should we handle the rollout?'), 'questions');
  assert.equal(classifyUtteranceType('We decided to ship CSV first.'), 'decisions');
  assert.equal(classifyUtteranceType('um'), 'filler');
});

test('meetingEfficiencyScore stays in [0,1] and penalises a dominant speaker', () => {
  const balanced = meetingEfficiencyScore(
    [
      { talkRatio: 0.34, utteranceBreakdown: { decisions: 1 }, turnCount: 3 },
      { talkRatio: 0.33, utteranceBreakdown: { decisions: 1 }, turnCount: 3 },
      { talkRatio: 0.33, utteranceBreakdown: { decisions: 1 }, turnCount: 3 },
    ],
    0.7
  );
  const dominated = meetingEfficiencyScore(
    [
      { talkRatio: 0.9, utteranceBreakdown: { decisions: 0 }, turnCount: 3 },
      { talkRatio: 0.05, utteranceBreakdown: { decisions: 0 }, turnCount: 1 },
      { talkRatio: 0.05, utteranceBreakdown: { decisions: 0 }, turnCount: 1 },
    ],
    0.7
  );
  for (const v of [balanced, dominated]) {
    assert.ok(v >= 0 && v <= 1, `score ${v} out of range`);
  }
  assert.ok(balanced > dominated, 'a balanced meeting should out-score a dominated one');
});
