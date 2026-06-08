'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseVtt } = require('../src/lib/vttParser');

// ─── 1. Basic cue with speaker tags ────────────────────────────────────────
test('parses a basic <v Speaker>text</v> cue', () => {
  const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
<v Alice>Hello everyone</v>
`;
  const result = parseVtt(vtt);
  assert.equal(result.length, 1);
  assert.equal(result[0].speaker, 'Alice');
  assert.equal(result[0].text, 'Hello everyone');
});

// ─── 2. Multiple speakers ──────────────────────────────────────────────────
test('parses multiple distinct speakers', () => {
  const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
<v Alice>Hi there</v>

00:00:05.000 --> 00:00:08.000
<v Bob>Good morning</v>
`;
  const result = parseVtt(vtt);
  assert.equal(result.length, 2);
  assert.equal(result[0].speaker, 'Alice');
  assert.equal(result[1].speaker, 'Bob');
});

// ─── 3. BOM and whitespace ─────────────────────────────────────────────────
test('strips BOM at the start of the file', () => {
  const vtt = '﻿WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<v Alice>Hi</v>\n';
  const result = parseVtt(vtt);
  assert.equal(result.length, 1);
  assert.equal(result[0].speaker, 'Alice');
});

// ─── 4. NOTE / STYLE / REGION blocks skipped ─────────────────────────────
test('skips NOTE, STYLE, and REGION blocks', () => {
  const vtt = `WEBVTT

NOTE This is a comment

STYLE
::cue { color: white; }

REGION
id:left

00:00:01.000 --> 00:00:04.000
<v Alice>Only this remains</v>
`;
  const result = parseVtt(vtt);
  assert.equal(result.length, 1);
  assert.equal(result[0].speaker, 'Alice');
});

// ─── 5. Plain cue attributed to last speaker ─────────────────────────────
test('plain cue text attributed to last known speaker', () => {
  const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
<v Alice>First line</v>

00:00:05.000 --> 00:00:08.000
Continuation without speaker tag
`;
  const result = parseVtt(vtt);
  assert.equal(result.length, 2);
  assert.equal(result[1].speaker, 'Alice');
  assert.equal(result[1].text, 'Continuation without speaker tag');
});

// ─── 6. HTML tags stripped ────────────────────────────────────────────────
test('strips HTML-like formatting tags from cue text', () => {
  const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
<v Alice><b>Bold</b> and <i>italic</i> text</v>
`;
  const result = parseVtt(vtt);
  assert.equal(result[0].text, 'Bold and italic text');
});

// ─── 7. Timestamp tags stripped ───────────────────────────────────────────
test('strips inline timestamp tags from cue text', () => {
  const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
<v Alice><00:00:01.500>Hello <00:00:02.000>world</v>
`;
  const result = parseVtt(vtt);
  assert.equal(result[0].text, 'Hello world');
});

// ─── 8. Entity decoding ───────────────────────────────────────────────────
test('decodes HTML entities in cue text', () => {
  const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
<v Alice>It&apos;s &amp; fun &lt;or&gt; not</v>
`;
  const result = parseVtt(vtt);
  assert.match(result[0].text, /It.*fun/);
});
