/**
 * Chunk embeddings for semantic search (RAG-style retrieval over meetings).
 * Skips if USE_ML=0 or on failure.
 */

const USE_ML = process.env.USE_ML !== '0';

let extractorPromise = null;

async function getExtractor() {
  if (!extractorPromise) {
    const { pipeline } = await import('@xenova/transformers');
    extractorPromise = pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2'
    );
  }
  return extractorPromise;
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

function tensorToArray(output) {
  const data = output.data;
  const dims = output.dims;
  if (!dims || dims.length === 0) {
    return Array.from(data);
  }
  if (dims.length === 1) {
    return Array.from(data);
  }
  if (dims.length === 2) {
    const dim = dims[1];
    const row = [];
    for (let i = 0; i < dim; i++) row.push(data[i]);
    return row;
  }
  return Array.from(data);
}

async function embedText(text) {
  if (!USE_ML) return null;
  try {
    const ext = await getExtractor();
    const t = text.length > 512 ? text.slice(0, 512) : text;
    const out = await ext(t, { pooling: 'mean', normalize: true });
    return tensorToArray(out);
  } catch (e) {
    console.warn('Embedding failed:', e.message);
    return null;
  }
}

function chunkText(raw, maxLen = 400) {
  const sentences = raw.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
  const chunks = [];
  let buf = '';
  for (const s of sentences) {
    if ((buf + s).length > maxLen && buf) {
      chunks.push(buf.trim());
      buf = s;
    } else {
      buf += (buf ? ' ' : '') + s;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  if (chunks.length === 0) chunks.push(raw.slice(0, maxLen));
  return chunks.slice(0, 12);
}

module.exports = { embedText, cosine, chunkText };
