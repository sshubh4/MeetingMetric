/**
 * Medallion data lake writer (bronze → silver → gold) with dual storage modes.
 *
 * STORAGE_MODE env:
 *   - 'local' (default): writes under ./data-lake/ at the repo's server root
 *   - 's3':              writes to s3://S3_BUCKET_NAME using @aws-sdk/client-s3
 *
 * Key layout (identical in both modes):
 *   bronze/org={orgId}/year={y}/month={m}/day={d}/{meetingId}.txt   raw transcripts
 *   silver/org={orgId}/year={y}/month={m}/meeting={meetingId}.json  flat speaker records
 *   gold/org={orgId}/date={dateStr}/benchmarks.json                 daily aggregates
 *
 * Failure policy: the lake is best-effort. Every write is wrapped — on any
 * error we log and return false; the transactional path (SQLite) is never
 * affected. If s3 mode is selected but credentials/bucket are missing, we
 * warn once and fall back to local mode.
 */

const fs = require('fs');
const path = require('path');

const LOCAL_ROOT = process.env.DATA_LAKE_DIR
  || path.join(__dirname, '..', '..', '..', 'data-lake');

function pad2(n) {
  return String(n).padStart(2, '0');
}

class DataLake {
  constructor({ logger } = {}) {
    this.logger = logger || console;
    this.localRoot = LOCAL_ROOT;
    this.mode = (process.env.STORAGE_MODE || 'local').toLowerCase();

    if (this.mode === 's3') {
      const bucket = process.env.S3_BUCKET_NAME;
      // Credentials may come from env vars or anywhere else in the SDK's
      // default chain (~/.aws/credentials, SSO cache, instance profile).
      const hasCreds =
        (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ||
        fs.existsSync(path.join(require('os').homedir(), '.aws', 'credentials')) ||
        !!process.env.AWS_PROFILE;
      if (!bucket || !hasCreds) {
        this._warn(
          'STORAGE_MODE=s3 but S3_BUCKET_NAME or AWS credentials are missing — falling back to local data lake'
        );
        this.mode = 'local';
      } else {
        const { S3Client } = require('@aws-sdk/client-s3');
        this.bucket = bucket;
        this.s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
      }
    }
  }

  _warn(msg) {
    if (typeof this.logger.warn === 'function') this.logger.warn(msg);
    else console.warn(msg);
  }

  _error(msg, err) {
    const detail = err ? `${msg}: ${err.message}` : msg;
    if (typeof this.logger.error === 'function') this.logger.error(detail);
    else console.error(detail);
  }

  /** True if a key already exists (used by the idempotent backfill). */
  async exists(key) {
    try {
      if (this.mode === 's3') {
        const { HeadObjectCommand } = require('@aws-sdk/client-s3');
        await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
        return true;
      }
      return fs.existsSync(path.join(this.localRoot, key));
    } catch {
      return false;
    }
  }

  /**
   * Low-level write. Returns true on success, false on failure — never throws.
   * metadata is attached as S3 object metadata in s3 mode and ignored for
   * local .txt files (silver/gold JSON embed their metadata in the payload).
   */
  async _write(key, body, { contentType = 'application/json', metadata = {} } = {}) {
    try {
      if (this.mode === 's3') {
        const { PutObjectCommand } = require('@aws-sdk/client-s3');
        await this.s3.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            Metadata: Object.fromEntries(
              Object.entries(metadata).map(([k, v]) => [k, String(v)])
            ),
          })
        );
      } else {
        const filePath = path.join(this.localRoot, key);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, body);
      }
      return true;
    } catch (e) {
      this._error(`Data lake write failed for ${key}`, e);
      return false;
    }
  }

  _datedParts(dateLike) {
    const d = dateLike ? new Date(dateLike) : new Date();
    const valid = !Number.isNaN(d.getTime()) ? d : new Date();
    return { y: valid.getUTCFullYear(), m: pad2(valid.getUTCMonth() + 1), day: pad2(valid.getUTCDate()) };
  }

  bronzeKey(meetingId, orgId, dateLike) {
    const { y, m, day } = this._datedParts(dateLike);
    return `bronze/org=${orgId ?? 0}/year=${y}/month=${m}/day=${day}/${meetingId}.txt`;
  }

  silverKey(meetingId, orgId, dateLike) {
    const { y, m } = this._datedParts(dateLike);
    return `silver/org=${orgId ?? 0}/year=${y}/month=${m}/meeting=${meetingId}.json`;
  }

  goldKey(orgId, dateStr) {
    return `gold/org=${orgId ?? 0}/date=${dateStr}/benchmarks.json`;
  }

  /**
   * Bronze layer: the raw transcript exactly as ingested, with a small
   * metadata header file-side (S3 metadata in s3 mode, JSON sidecar omitted
   * locally — the partition path already encodes meeting/org/date).
   */
  async writeBronze(meetingId, orgId, rawText, source, dateLike = null) {
    const key = this.bronzeKey(meetingId, orgId, dateLike);
    return this._write(key, rawText, {
      contentType: 'text/plain',
      metadata: {
        meetingId,
        orgId: orgId ?? 0,
        source: source || 'manual',
        ingestedAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Silver layer: cleaned, FLAT records — one object per speaker with all
   * scores as top-level numeric fields, written as JSONL (one record per
   * line). No nesting and newline-delimited, so the files are directly
   * readable by Athena's JSON SerDe, Glue crawlers, and Spark.
   */
  async writeSilver(meetingId, orgId, meetingRow, speakerResults, dateLike = null) {
    const key = this.silverKey(meetingId, orgId, dateLike ?? meetingRow?.created_at);
    const records = (speakerResults || []).map((s) => ({
      meeting_id: meetingId,
      org_id: orgId ?? 0,
      title: meetingRow?.title ?? null,
      efficiency_score: meetingRow?.efficiency_score ?? null,
      source: meetingRow?.source || 'manual',
      created_at: meetingRow?.created_at ?? null,
      scheduled_at: meetingRow?.scheduled_at ?? null,
      speaker_name: s.speaker_name,
      user_id: s.user_id ?? null,
      word_count: s.word_count ?? 0,
      turn_count: s.turn_count ?? 0,
      talk_ratio: s.talk_ratio ?? 0,
      score_engagement: s.score_engagement ?? null,
      score_sentiment: s.score_sentiment ?? null,
      score_collaboration: s.score_collaboration ?? null,
      score_initiative: s.score_initiative ?? null,
      score_clarity: s.score_clarity ?? null,
      ub_ideas: s.ub_ideas ?? null,
      ub_questions: s.ub_questions ?? null,
      ub_decisions: s.ub_decisions ?? null,
      ub_filler: s.ub_filler ?? null,
    }));
    const jsonl = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
    return this._write(key, jsonl, {
      metadata: { meetingId, orgId: orgId ?? 0, recordCount: records.length },
    });
  }

  /** Gold layer: pre-computed aggregates (e.g. daily org benchmarks). */
  async writeGold(orgId, dateStr, aggregates) {
    const key = this.goldKey(orgId, dateStr);
    return this._write(key, JSON.stringify(aggregates, null, 2), {
      metadata: { orgId: orgId ?? 0, date: dateStr },
    });
  }
}

// Shared singleton — server code should use this instance so the s3→local
// fallback warning is only emitted once per process.
let _instance = null;
function getDataLake(opts) {
  if (!_instance) _instance = new DataLake(opts);
  return _instance;
}

module.exports = { DataLake, getDataLake };
