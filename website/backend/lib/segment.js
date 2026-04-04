/**
 * Segment transcript into speaker turns.
 * Supports: "Name: text", "Name (role): text", lines starting with timestamps.
 */

const SPEAKER_LINE =
  /^\s*(?:\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*)?(?:([^:\n]{1,80}):\s*)(.+)$/;

function normalizeLine(line) {
  return line.replace(/\r/g, '').trim();
}

function segmentTranscript(raw) {
  const lines = raw.split(/\n/).map(normalizeLine).filter(Boolean);
  const turns = [];
  let currentSpeaker = 'Unknown';
  let buffer = [];

  for (const line of lines) {
    const m = line.match(SPEAKER_LINE);
    if (m && m[1] && m[2] && !m[1].includes('http')) {
      if (buffer.length) {
        turns.push({
          speaker: currentSpeaker.trim(),
          text: buffer.join(' ').trim(),
        });
        buffer = [];
      }
      currentSpeaker = m[1].replace(/\s*\([^)]*\)\s*$/, '').trim() || 'Unknown';
      buffer.push(m[2].trim());
    } else {
      buffer.push(line);
    }
  }

  if (buffer.length) {
    turns.push({
      speaker: currentSpeaker.trim(),
      text: buffer.join(' ').trim(),
    });
  }

  if (turns.length === 0 && raw.trim()) {
    return [{ speaker: 'Unknown', text: raw.trim() }];
  }

  return turns.filter((t) => t.text.length > 0);
}

module.exports = { segmentTranscript };
