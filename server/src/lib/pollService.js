'use strict';

const { analyzeTranscript } = require('./analyzePipeline');
const { parseVtt } = require('./vttParser');

class PollService {
  constructor(db, teamsService, intervalMs = 5 * 60 * 1000) {
    this.db = db;
    this.teamsService = teamsService;
    this.intervalMs = intervalMs;
    this._timer = null;
    this._logger = null; // set by server after pino init
  }

  setLogger(logger) {
    this._logger = logger;
  }

  _log(level, obj, msg) {
    if (this._logger) {
      this._logger[level](obj, msg);
    } else {
      console.log(`[PollService] ${msg}`, obj);
    }
  }

  start() {
    const minutes = Math.round(this.intervalMs / 60000);
    this._log('info', {}, `Teams poll service started (interval: ${minutes}m)`);
    this._timer = setInterval(() => {
      this.pollAll().catch((e) => this._log('error', { err: e.message }, 'pollAll error'));
    }, this.intervalMs);
    // Don't unref — we want it to keep the process alive
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
      this._log('info', {}, 'Teams poll service stopped');
    }
  }

  async pollAll() {
    const users = this.db
      .prepare(
        `SELECT u.id FROM users u
         JOIN teams_tokens tt ON tt.user_id = u.id
         WHERE tt.access_token IS NOT NULL AND u.active = 1`
      )
      .all();

    for (const u of users) {
      try {
        await this.pollUser(u.id);
      } catch (e) {
        this._log('error', { userId: u.id, err: e.message }, 'pollUser error');
      }
    }
  }

  async pollUser(userId) {
    const valid = await this.teamsService.refreshTokenIfNeeded(userId);
    if (!valid) {
      this._log('info', { userId }, `Skipping user ${userId} — token expired`);
      return;
    }

    const tok = this.teamsService.getStoredToken(userId);
    if (!tok || !tok.access_token) return;

    // Get last poll state
    const pollState = this.db
      .prepare('SELECT last_meeting_end_time FROM transcript_poll_state WHERE user_id = ?')
      .get(userId);

    const lastEndTime =
      pollState?.last_meeting_end_time ||
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Get user's org_id
    const userRow = this.db.prepare('SELECT org_id FROM users WHERE id = ?').get(userId);
    const orgId = userRow?.org_id || null;

    let meetings;
    try {
      meetings = await this.teamsService.getRecentMeetings(tok.access_token, lastEndTime);
    } catch (e) {
      this._log('warn', { userId, err: e.message }, 'getRecentMeetings failed');
      return;
    }

    const { resolveAliases } = require('./db');
    const aliasMap = orgId ? resolveAliases(orgId) : new Map();

    for (const meeting of meetings) {
      try {
        // Check for dedup
        const existing = this.db
          .prepare(
            'SELECT id FROM meetings WHERE teams_meeting_id = ? AND org_id = ?'
          )
          .get(meeting.id, orgId);
        if (existing) continue;

        let transcripts;
        try {
          transcripts = await this.teamsService.getMeetingTranscripts(
            tok.access_token,
            meeting.id
          );
        } catch {
          continue;
        }

        if (!transcripts || transcripts.length === 0) {
          this._log(
            'info',
            { userId, meetingSubject: meeting.subject },
            `No transcripts yet for "${meeting.subject}"`
          );
          continue;
        }

        let vtt;
        try {
          vtt = await this.teamsService.downloadTranscriptVtt(
            tok.access_token,
            meeting.id,
            transcripts[0].id
          );
        } catch (e) {
          this._log('warn', { userId, err: e.message }, 'downloadTranscriptVtt failed');
          continue;
        }

        const turns = parseVtt(vtt);
        if (!turns || turns.length === 0) continue;

        const rawText = turns.map((t) => `${t.speaker}: ${t.text}`).join('\n');

        const title = (meeting.subject || 'Teams Meeting').slice(0, 200);

        let analysis;
        try {
          analysis = await analyzeTranscript(rawText, title);
        } catch (e) {
          this._log('warn', { userId, err: e.message }, 'analyzeTranscript failed');
          continue;
        }

        const created_at = new Date().toISOString();

        const rowM = this.db
          .prepare(
            `INSERT INTO meetings
             (user_id, title, raw_text, summary, efficiency_score, dominant_speaker_alert,
              low_engagement_alert, created_at, project_id, scheduled_at, uploaded_by,
              source, teams_meeting_id, teams_transcript_id, org_id)
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
            null,
            meeting.startDateTime || null,
            userId,
            'teams_auto',
            meeting.id,
            transcripts[0].id,
            orgId
          );

        const meetingId = rowM.id;

        const insertS = this.db.prepare(
          `INSERT INTO speaker_results
           (meeting_id, speaker_name, word_count, turn_count, talk_ratio,
            scores_json, utterance_breakdown_json, coaching_text, embedding_json,
            user_id, org_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );

        for (const s of analysis.speakers) {
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
            orgId
          );
        }

        const insertC = this.db.prepare(
          `INSERT INTO meeting_chunks (meeting_id, chunk_index, text_snippet, embedding_json)
           VALUES (?, ?, ?, ?)`
        );
        for (const c of analysis.chunkEmbeddings) {
          insertC.run(meetingId, c.chunk_index, c.text_snippet, c.embedding_json);
        }

        this._log(
          'info',
          { userId, meetingId, title },
          `Auto-ingested: "${title}" for user ${userId}`
        );
      } catch (e) {
        this._log('error', { userId, meetingId: meeting.id, err: e.message }, 'meeting ingest error');
      }
    }

    // Update poll state
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO transcript_poll_state (user_id, last_polled_at, last_meeting_end_time)
         VALUES (?, ?, ?)`
      )
      .run(userId, now, now);
  }
}

module.exports = PollService;
