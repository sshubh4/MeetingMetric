/**
 * Backfills the medallion data lake from SQLite: replays EVERY existing
 * meeting through writeBronze + writeSilver.
 *
 * Idempotent — keys that already exist in the lake are skipped, so it is
 * safe to re-run after partial failures or new ingests.
 *
 * Run: cd server && npm run backfill:lake
 * Respects STORAGE_MODE (local/s3) like the live pipeline.
 */
require('dotenv').config();

const db = require('../src/lib/db');
const { getDataLake } = require('../src/lib/dataLake');

async function main() {
  const lake = getDataLake();
  console.log(`Backfilling data lake (mode: ${lake.mode}${lake.mode === 'local' ? `, root: ${lake.localRoot}` : `, bucket: ${lake.bucket}`})`);

  const meetings = db.prepare('SELECT * FROM meetings ORDER BY id').all();
  const speakersFor = db.prepare('SELECT * FROM speaker_results WHERE meeting_id = ?');

  let bronzeWritten = 0, silverWritten = 0, skipped = 0, failed = 0;

  for (const m of meetings) {
    const dateLike = m.created_at;

    const bronzeKey = lake.bronzeKey(m.id, m.org_id, dateLike);
    if (await lake.exists(bronzeKey)) {
      skipped++;
    } else {
      const ok = await lake.writeBronze(m.id, m.org_id, m.raw_text || '', m.source, dateLike);
      ok ? bronzeWritten++ : failed++;
    }

    const silverKey = lake.silverKey(m.id, m.org_id, dateLike);
    if (await lake.exists(silverKey)) {
      skipped++;
    } else {
      const ok = await lake.writeSilver(m.id, m.org_id, m, speakersFor.all(m.id), dateLike);
      ok ? silverWritten++ : failed++;
    }
  }

  console.log(
    `Done: ${meetings.length} meetings — bronze written: ${bronzeWritten}, silver written: ${silverWritten}, skipped (already present): ${skipped}, failed: ${failed}`
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('Backfill failed:', e);
  process.exit(1);
});
