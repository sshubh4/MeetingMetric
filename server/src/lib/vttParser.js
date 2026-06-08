'use strict';

/**
 * parseVtt(vttString) → [{speaker, text, timestamp}, ...]
 *
 * Handles ALL edge cases:
 * - BOM characters at start of file
 * - WEBVTT header (with or without metadata)
 * - NOTE / REGION / STYLE blocks — skipped entirely
 * - Blank lines (cue separator)
 * - Sequence numbers (lines that are just digits)
 * - Timestamp lines: 00:00:05.000 --> 00:00:10.000 (with optional positioning)
 * - Cue payload: single or multi-line
 * - Speaker tags: <v Speaker Name>text</v>
 * - Plain cue text with no speaker tag — attributed to last known speaker or "Unknown"
 * - HTML-like tags stripped: <c>, <b>, <i>, <u>, <ruby>, <rt> and closing variants
 * - Timestamp tags within cue text: <00:00:05.000> — stripped
 * - Escape sequences: &amp; &lt; &gt; &nbsp;
 * - Multiple speakers in one cue (split by <v> tags)
 * - Empty cue text after stripping — skipped
 */

const TIMESTAMP_LINE_RE = /^\d{2}:\d{2}:\d{2}\.\d{3}\s+-->/;
// Short form timestamps in cue line: 0:00:00.000 or 00:00.000
const TIMESTAMP_LINE_SHORT_RE = /^\d{1,2}:\d{2}:\d{2}[.,]\d{3}\s+-->/;

function isTimestampLine(line) {
  return TIMESTAMP_LINE_RE.test(line) || TIMESTAMP_LINE_SHORT_RE.test(line);
}

function extractStartTime(line) {
  // Grab everything before " -->"
  const part = line.split('-->')[0].trim();
  // Format: HH:MM:SS.mmm → HH:MM:SS
  return part.replace(/\.\d{3}$/, '').replace(/,\d{3}$/, '');
}

function stripHtmlAndTimestampTags(text) {
  // Strip timestamp tags like <00:00:05.000>
  text = text.replace(/<\d{1,2}:\d{2}[:.]\d{2,3}(?:\.\d{3})?>/g, '');
  // Strip <c.color>, <b>, <i>, <u>, <ruby>, <rt> and closing tags
  text = text.replace(/<\/?(?:c(?:\.[^>]*)?|b|i|u|ruby|rt)>/gi, '');
  // Strip remaining unknown tags that look like HTML (but preserve <v> — handled separately)
  text = text.replace(/<(?!v[\s>]|\/v>)[^>]+>/g, '');
  return text;
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

function parseCuePayload(payload, timestamp, lastSpeaker) {
  const results = [];

  // Split on <v ...> boundaries to handle multiple speakers in one cue
  // A cue may look like: <v Speaker1>text1</v><v Speaker2>text2</v>
  // Or simply: <v Speaker>text
  const voiceTagRe = /<v\s+([^>]+?)>([\s\S]*?)(?=<v\s|<\/v>|$)/g;
  let matched = false;
  let match;

  while ((match = voiceTagRe.exec(payload)) !== null) {
    matched = true;
    const speaker = match[1].trim();
    let text = match[2];
    text = stripHtmlAndTimestampTags(text);
    text = decodeEntities(text).trim();
    if (text) {
      results.push({ speaker, text, timestamp });
      lastSpeaker = speaker;
    }
  }

  if (!matched) {
    // No <v> tags — plain text; attribute to last known speaker
    let text = payload;
    text = stripHtmlAndTimestampTags(text);
    text = decodeEntities(text).trim();
    if (text) {
      results.push({ speaker: lastSpeaker || 'Unknown', text, timestamp });
    }
  }

  return { entries: results, lastSpeaker };
}

/**
 * @param {string} vttString
 * @returns {{speaker: string, text: string, timestamp: string}[]}
 */
function parseVtt(vttString) {
  if (!vttString || typeof vttString !== 'string') return [];

  // Strip BOM
  let content = vttString.replace(/^﻿/, '');

  const lines = content.split(/\r?\n/);
  const results = [];
  let lastSpeaker = 'Unknown';
  let i = 0;

  // Skip WEBVTT header line
  if (lines[i] && lines[i].replace(/^﻿/, '').startsWith('WEBVTT')) {
    i++;
    // Skip any header metadata lines until first blank line
    while (i < lines.length && lines[i].trim() !== '') {
      i++;
    }
  }

  while (i < lines.length) {
    const line = lines[i].trim();

    // Skip blank lines
    if (!line) {
      i++;
      continue;
    }

    // Skip NOTE blocks
    if (line.startsWith('NOTE')) {
      i++;
      while (i < lines.length && lines[i].trim() !== '') {
        i++;
      }
      continue;
    }

    // Skip REGION blocks
    if (line.startsWith('REGION')) {
      i++;
      while (i < lines.length && lines[i].trim() !== '') {
        i++;
      }
      continue;
    }

    // Skip STYLE blocks
    if (line.startsWith('STYLE')) {
      i++;
      while (i < lines.length && lines[i].trim() !== '') {
        i++;
      }
      continue;
    }

    // Skip sequence numbers (lines that are just digits)
    if (/^\d+$/.test(line)) {
      i++;
      continue;
    }

    // Timestamp line
    if (isTimestampLine(line)) {
      const timestamp = extractStartTime(line);
      i++;

      // Collect cue payload lines until blank line or EOF
      const payloadLines = [];
      while (i < lines.length && lines[i].trim() !== '') {
        payloadLines.push(lines[i]);
        i++;
      }

      if (payloadLines.length > 0) {
        const payload = payloadLines.join('\n');
        const { entries, lastSpeaker: newLastSpeaker } = parseCuePayload(
          payload,
          timestamp,
          lastSpeaker
        );
        lastSpeaker = newLastSpeaker;
        for (const e of entries) {
          results.push(e);
        }
      }
      continue;
    }

    // Anything else — skip
    i++;
  }

  return results;
}

module.exports = { parseVtt };
