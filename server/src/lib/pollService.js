'use strict';

const { runMeetingPipeline } = require('./analyzePipeline');
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

        let meetingId;
        try {
          ({ meetingId } = await runMeetingPipeline({
            rawText,
            title,
            userId,
            orgId,
            source: 'teams_auto',
            scheduledAt: meeting.startDateTime || null,
            uploadedBy: userId,
            teamsMeetingId: meeting.id,
            teamsTranscriptId: transcripts[0].id,
          }));
        } catch (e) {
          this._log('warn', { userId, err: e.message }, 'runMeetingPipeline failed');
          continue;
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
