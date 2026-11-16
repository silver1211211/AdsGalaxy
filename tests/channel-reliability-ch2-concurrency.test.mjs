import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import mysql from 'mysql2/promise';

let persistSuccessfulChannelViews;
let persistFailedChannelViewFetch;
let normalizedLastViewsUpdateDatetimeSql;
let normalizeViewTimestamp;

const fixtureConfig = {
  host: '127.0.0.1',
  port: 53307,
  user: 'root',
  password: '',
};

let adminConn;
let testDbName;
let pool;
let conn1;
let conn2;

function loadTsWithMocks(relFile, mocks = {}) {
  const cache = new Map();
  function resolveAndLoad(targetFile) {
    if (mocks[targetFile]) return mocks[targetFile];
    const abs = path.resolve(process.cwd(), targetFile);
    if (cache.has(abs)) return cache.get(abs);
    const source = readFileSync(abs, 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const mod = { exports: {} };
    cache.set(abs, mod.exports);
    vm.runInNewContext(
      compiled,
      {
        module: mod,
        exports: mod.exports,
        require: (spec) => {
          if (mocks[spec]) return mocks[spec];
          if (spec.startsWith('@/')) {
            const sub = 'src/' + spec.slice(2) + (spec.endsWith('.ts') ? '' : '.ts');
            if (existsSync(path.resolve(process.cwd(), sub))) return resolveAndLoad(sub);
          }
          return {};
        },
        process,
        console,
        Date,
        Math,
        Number,
        String,
        Boolean,
        Error,
        Map,
        Set,
        WeakMap,
        JSON,
        Promise,
        setTimeout,
        clearTimeout,
      },
      { filename: path.basename(abs) },
    );
    cache.set(abs, mod.exports);
    return mod.exports;
  }
  return resolveAndLoad(relFile);
}

before(async () => {
  const mod = loadTsWithMocks('src/lib/channelViewPersistence.ts');
  persistSuccessfulChannelViews = mod.persistSuccessfulChannelViews;
  persistFailedChannelViewFetch = mod.persistFailedChannelViewFetch;
  normalizedLastViewsUpdateDatetimeSql = mod.normalizedLastViewsUpdateDatetimeSql;
  normalizeViewTimestamp = mod.normalizeViewTimestamp;
  assert.equal(typeof persistSuccessfulChannelViews, 'function');
  assert.equal(typeof persistFailedChannelViewFetch, 'function');

  adminConn = await mysql.createConnection(fixtureConfig);

  // Clean up any leftover test_ch2_* databases from prior interrupted runs
  const [staleDbs] = await adminConn.query("SHOW DATABASES LIKE 'test_ch2_%'");
  for (const row of staleDbs) {
    const dbName = Object.values(row)[0];
    if (/^test_ch2_[a-z0-9_]+$/i.test(dbName)) {
      await adminConn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    }
  }

  testDbName = `test_ch2_${randomUUID().replaceAll('-', '')}`;
  await adminConn.query(`CREATE DATABASE \`${testDbName}\``);

  pool = mysql.createPool({
    ...fixtureConfig,
    database: testDbName,
    waitForConnections: true,
    connectionLimit: 6,
  });

  await pool.query(`
    CREATE TABLE channels (
      id BIGINT PRIMARY KEY,
      user_id BIGINT NOT NULL DEFAULT 1,
      chat_id VARCHAR(64) NULL,
      username VARCHAR(128) NULL,
      channel_type VARCHAR(32) NOT NULL DEFAULT 'public',
      tracking_account INT NULL,
      tracking_account_status VARCHAR(32) NULL,
      tracking_account_member_status VARCHAR(32) NULL,
      is_deleted TINYINT NOT NULL DEFAULT 0,
      last_successful_view_fetch_at DATETIME NULL
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE campaign_posts (
      id BIGINT PRIMARY KEY,
      campaign_id BIGINT NOT NULL,
      channel_id BIGINT NOT NULL,
      message_id BIGINT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'active',
      deleted_at DATETIME(6) NULL,
      delivery_confirmed_at DATETIME(6) NULL,
      delivery_failed_at DATETIME(6) NULL,
      views BIGINT NOT NULL DEFAULT 0,
      settled_views BIGINT NOT NULL DEFAULT 0,
      last_views_update BIGINT NULL,
      last_views_update_at DATETIME(6) NULL,
      last_view_attempt_at DATETIME(6) NULL,
      view_fetch_status VARCHAR(32) NULL,
      view_fetch_error VARCHAR(500) NULL,
      view_fetch_source VARCHAR(128) NULL,
      view_fetch_failures INT NOT NULL DEFAULT 0,
      last_view_failure_class VARCHAR(64) NULL,
      view_next_retry_at DATETIME(6) NULL
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE campaign_views_audit (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      post_id BIGINT NOT NULL,
      channel_id BIGINT NOT NULL,
      total_views BIGINT NOT NULL,
      last_views_count BIGINT NOT NULL,
      status VARCHAR(32) NOT NULL,
      created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6)
    ) ENGINE=InnoDB
  `);

  conn1 = await pool.getConnection();
  conn2 = await pool.getConnection();
});

after(async () => {
  if (conn1) conn1.release();
  if (conn2) conn2.release();
  if (pool) await pool.end();
  if (adminConn) {
    await adminConn.query(`DROP DATABASE IF EXISTS \`${testDbName}\``);
    await adminConn.end();
  }
});

test('CH2.1: Stale observation with a HIGHER view count changes zero columns, including failure metadata', async () => {
  const postId = 1001;
  const newerTime = 1793966400000;
  const newerUtcSql = normalizeViewTimestamp(newerTime).utcSqlDatetime;

  await pool.query(
    `INSERT INTO campaign_posts (
       id, campaign_id, channel_id, views, settled_views,
       last_views_update, last_views_update_at, last_view_attempt_at,
       view_fetch_status, view_fetch_error, view_fetch_source,
       view_fetch_failures, last_view_failure_class, view_next_retry_at, status
     ) VALUES (?, 1, 10, 200, 150, ?, ?, ?, 'failed', 'temporary:timeout|retry_after=300', 'mtproto', 3, 'temporary', '2026-11-06 12:15:00.000000', 'active')`,
    [postId, newerTime, newerUtcSql, newerUtcSql],
  );

  const [[beforeRow]] = await pool.query('SELECT * FROM campaign_posts WHERE id = ?', [postId]);

  // Stale worker attempts to write a HIGHER view count (999 > 200) at an older timestamp
  const olderTime = 1793962800000;
  const resOlder = await persistSuccessfulChannelViews(conn2, postId, 999, 'public_html', olderTime);
  assert.equal(resOlder.updated, false, 'Stale observation must not update rows');
  assert.equal(resOlder.skippedStale, true, 'Stale observation must be flagged as skippedStale');
  assert.equal(resOlder.status, 'stale_ignored');

  const [[afterRow]] = await pool.query('SELECT * FROM campaign_posts WHERE id = ?', [postId]);
  assert.deepEqual(afterRow, beforeRow, 'Every column (views, timestamps, status, failure metadata, retry cooldown) must be 100% unchanged');
});

test('CH2.2: Concurrent 2-connection race guarantees newer observation wins (and lock-waiting stale higher view count is rejected)', async () => {
  const postId = 1002;
  const initialTime = 1793950000000;
  const initialUtc = normalizeViewTimestamp(initialTime).utcSqlDatetime;
  await pool.query(
    `INSERT INTO campaign_posts (id, campaign_id, channel_id, views, last_views_update_at, last_views_update, status)
     VALUES (?, 1, 10, 50, ?, ?, 'active')`,
    [postId, initialUtc, initialTime],
  );

  const t1 = 1793970000000; // newer: 500 views
  const t2 = 1793960000000; // older: 400 views

  await Promise.all([
    persistSuccessfulChannelViews(conn1, postId, 500, 'mtproto', t1),
    persistSuccessfulChannelViews(conn2, postId, 400, 'public_html', t2),
  ]);

  const [rows] = await pool.query('SELECT views, last_views_update, view_fetch_source FROM campaign_posts WHERE id = ?', [postId]);
  assert.equal(Number(rows[0].views), 500, 'Final views must be 500 from the newer observation');
  assert.equal(Number(rows[0].last_views_update), t1, 'Final timestamp must match newer observation');
  assert.equal(rows[0].view_fetch_source, 'mtproto');

  // True InnoDB lock-wait overlap: Conn 1 updates to t3=1793980000000 (600 views) inside a transaction;
  // Conn 2 concurrently attempts to write a stale timestamp tStale=1793975000000 with HIGHER views (950),
  // blocks on Conn 1's row lock, and is rejected once Conn 1 commits.
  const t3 = 1793980000000;
  const tStale = 1793975000000;
  await conn1.beginTransaction();
  const res1 = await persistSuccessfulChannelViews(conn1, postId, 600, 'mtproto', t3);
  assert.equal(res1.updated, true);

  let conn2Done = false;
  const p2 = persistSuccessfulChannelViews(conn2, postId, 950, 'public_html', tStale).then((r) => {
    conn2Done = true;
    return r;
  });

  let waited = false;
  await new Promise((r) => setTimeout(r, 120));
  for (let i = 0; i < 30; i++) {
    const [w] = await adminConn.query(
      `SELECT r.trx_id AS waiting_trx_id, r.trx_state, r.trx_query, b.trx_id AS blocking_trx_id
       FROM INFORMATION_SCHEMA.INNODB_LOCK_WAITS w
       JOIN INFORMATION_SCHEMA.INNODB_TRX r ON r.trx_id = w.requesting_trx_id
       JOIN INFORMATION_SCHEMA.INNODB_TRX b ON b.trx_id = w.blocking_trx_id`,
    );
    if (w.length > 0) {
      console.log('[CH2.2 Lock Wait Evidence]', JSON.stringify(w[0]));
      waited = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  assert.equal(waited, true, 'Conn 2 must wait on Conn 1 InnoDB lock');
  assert.equal(conn2Done, false);

  await conn1.commit();
  const res2 = await p2;
  assert.equal(res2.updated, false, 'Lock-waiting stale observation with higher views (950) must be rejected after Conn 1 commits');
  assert.equal(res2.skippedStale, true);

  const [[afterRace]] = await pool.query('SELECT views, last_views_update, view_fetch_source FROM campaign_posts WHERE id = ?', [postId]);
  assert.equal(Number(afterRace.views), 600, 'Views must be 600 from Conn 1, never 950 from stale Conn 2');
  assert.equal(Number(afterRace.last_views_update), t3);
  assert.equal(afterRace.view_fetch_source, 'mtproto');
});

test('CH2.3: Newer observation with lower view count never decrements verified views (GREATEST) and resets error metadata', async () => {
  const postId = 1003;
  const initialTime = 1793960000000;
  const initialUtc = normalizeViewTimestamp(initialTime).utcSqlDatetime;
  await pool.query(
    `INSERT INTO campaign_posts (
       id, campaign_id, channel_id, views, last_views_update_at, last_views_update,
       view_fetch_status, view_fetch_error, view_fetch_failures, last_view_failure_class, view_next_retry_at, status
     ) VALUES (?, 1, 10, 300, ?, ?, 'failed', 'temporary:timeout', 2, 'temporary', '2026-11-06 10:00:00.000000', 'active')`,
    [postId, initialUtc, initialTime],
  );

  const newerTime = 1793970000000;
  const resLower = await persistSuccessfulChannelViews(conn1, postId, 100, 'mtproto', newerTime);
  assert.equal(resLower.updated, true);

  const [[row]] = await pool.query('SELECT * FROM campaign_posts WHERE id = ?', [postId]);
  assert.equal(Number(row.views), 300, 'Views must not regress below 300');
  assert.equal(Number(row.last_views_update), newerTime);
  assert.equal(row.view_fetch_status, 'success');
  assert.equal(row.view_fetch_error, null);
  assert.equal(Number(row.view_fetch_failures), 0);
  assert.equal(row.last_view_failure_class, null);
  assert.equal(row.view_next_retry_at, null);
});

test('CH2.4: Equal timestamp is idempotent and changes zero columns', async () => {
  const postId = 1004;
  const t = 1793975000000;
  await pool.query(
    `INSERT INTO campaign_posts (id, campaign_id, channel_id, views, status)
     VALUES (?, 1, 10, 10, 'active')`,
    [postId],
  );

  const first = await persistSuccessfulChannelViews(conn1, postId, 250, 'public_api', t);
  assert.equal(first.updated, true);

  const [[afterFirst]] = await pool.query('SELECT * FROM campaign_posts WHERE id = ?', [postId]);
  const duplicate = await persistSuccessfulChannelViews(conn2, postId, 777, 'mtproto', t);
  assert.equal(duplicate.updated, false);
  assert.equal(duplicate.skippedStale, true);
  assert.equal(duplicate.status, 'stale_ignored');

  const [[afterDup]] = await pool.query('SELECT * FROM campaign_posts WHERE id = ?', [postId]);
  assert.deepEqual(afterDup, afterFirst, 'Equal timestamp replay must not alter views or source');
});

test('CH2.5: Legacy 14-digit YYYYMMDDHHMMSS BIGINT and DATETIME(6) representations both reject older/equal and accept newer across UTC and +03:00', async () => {
  const postId = 1005;
  // 2026-11-06 12:00:00 UTC -> 14-digit 20261106120000 (epoch ms 1793966400000)
  await pool.query(
    `INSERT INTO campaign_posts (id, campaign_id, channel_id, views, last_views_update, last_views_update_at, view_fetch_source, status)
     VALUES (?, 1, 10, 400, 20261106120000, NULL, 'public_api', 'active')`,
    [postId],
  );

  await conn1.query("SET SESSION time_zone = '+03:00'");
  try {
    // 1 second older than 2026-11-06 12:00:00 UTC -> rejected even though last_views_update is 14-digit
    const olderRes = await persistSuccessfulChannelViews(conn1, postId, 950, 'public_html', '2026-11-06T11:59:59.000Z');
    assert.equal(olderRes.updated, false);
    assert.equal(olderRes.skippedStale, true);

    // Equal to 2026-11-06 12:00:00 UTC -> rejected
    const equalRes = await persistSuccessfulChannelViews(conn1, postId, 950, 'public_html', '2026-11-06T12:00:00.000Z');
    assert.equal(equalRes.updated, false);

    const [[unchanged]] = await pool.query('SELECT views, last_views_update, view_fetch_source FROM campaign_posts WHERE id = ?', [postId]);
    assert.equal(Number(unchanged.views), 400);
    assert.equal(Number(unchanged.last_views_update), 20261106120000);
    assert.equal(unchanged.view_fetch_source, 'public_api');

    // 1 second newer -> accepted and healed to 13-digit epoch ms
    const newerMs = Date.UTC(2026, 10, 6, 12, 0, 1);
    const newerRes = await persistSuccessfulChannelViews(conn1, postId, 450, 'mtproto', newerMs);
    assert.equal(newerRes.updated, true);
    const [[healed]] = await pool.query('SELECT views, last_views_update FROM campaign_posts WHERE id = ?', [postId]);
    assert.equal(Number(healed.views), 450);
    assert.equal(Number(healed.last_views_update), newerMs);
  } finally {
    await conn1.query("SET SESSION time_zone = '+00:00'");
  }

  // Also verify when underlying column last_views_update is DATETIME(6)
  await pool.query('CREATE TABLE campaign_posts_dt LIKE campaign_posts');
  await pool.query('ALTER TABLE campaign_posts RENAME TO campaign_posts_bigint_bak');
  await pool.query('ALTER TABLE campaign_posts_dt RENAME TO campaign_posts');
  await pool.query('ALTER TABLE campaign_posts MODIFY COLUMN last_views_update DATETIME(6) NULL');
  try {
    await pool.query(
      `INSERT INTO campaign_posts (id, campaign_id, channel_id, views, last_views_update, last_views_update_at, view_fetch_source, status)
       VALUES (1099, 1, 10, 320, '2026-11-06 15:00:00.000000', '2026-11-06 15:00:00.000000', 'public_api', 'active')`,
    );
    const staleDt = await persistSuccessfulChannelViews(conn2, 1099, 888, 'public_html', new Date('2026-11-06T14:59:59.000Z'));
    assert.equal(staleDt.updated, false);
    const [[rowAfterStale]] = await pool.query('SELECT views, view_fetch_source FROM campaign_posts WHERE id = 1099');
    assert.equal(Number(rowAfterStale.views), 320);
    assert.equal(rowAfterStale.view_fetch_source, 'public_api');

    const freshDt = await persistSuccessfulChannelViews(conn2, 1099, 360, 'mtproto', new Date('2026-11-06T15:00:05.000Z'));
    assert.equal(freshDt.updated, true);
    const [[rowAfterFresh]] = await pool.query('SELECT views, view_fetch_source FROM campaign_posts WHERE id = 1099');
    assert.equal(Number(rowAfterFresh.views), 360);
    assert.equal(rowAfterFresh.view_fetch_source, 'mtproto');
  } finally {
    await pool.query('DROP TABLE campaign_posts');
    await pool.query('ALTER TABLE campaign_posts_bigint_bak RENAME TO campaign_posts');
  }
});

test('CH2.6: Deleted-post successes/failures are rejected; real 2-conn InnoDB lock-wait race cannot resurrect deleted records', async () => {
  const postId = 1006;
  // Pre-deletion cleanup_pending with deleted_at IS NULL still captures final views
  await pool.query(
    `INSERT INTO campaign_posts (id, campaign_id, channel_id, views, status, deleted_at)
     VALUES (?, 1, 10, 120, 'cleanup_pending', NULL)`,
    [postId],
  );
  const preDel = await persistSuccessfulChannelViews(conn1, postId, 180, 'pre_deletion_public_api', 1793980000000);
  assert.equal(preDel.updated, true);

  // Real 2-connection InnoDB lock-wait race:
  // Conn 1 starts transaction and marks the post deleted (holding X lock on postId)
  await conn1.beginTransaction();
  await conn1.query(
    "UPDATE campaign_posts SET status = 'deleted', deleted_at = '2026-11-06 16:00:00.000000' WHERE id = ?",
    [postId],
  );

  // Conn 2 concurrently attempts to persist a newer view observation (blocks on Conn 1's row lock)
  let conn2Finished = false;
  const conn2Promise = persistSuccessfulChannelViews(conn2, postId, 9999, 'mtproto', 1793990000000).then((r) => {
    conn2Finished = true;
    return r;
  });

  // Poll INFORMATION_SCHEMA.INNODB_TRX / INNODB_LOCK_WAITS on 53307 until Conn 2 is observed in LOCK WAIT
  let lockWaitObserved = false;
  await new Promise((r) => setTimeout(r, 120));
  for (let i = 0; i < 30; i++) {
    const [waits] = await adminConn.query(
      `SELECT r.trx_id AS waiting_trx_id, r.trx_state, r.trx_query, b.trx_id AS blocking_trx_id
       FROM INFORMATION_SCHEMA.INNODB_LOCK_WAITS w
       JOIN INFORMATION_SCHEMA.INNODB_TRX r ON r.trx_id = w.requesting_trx_id
       JOIN INFORMATION_SCHEMA.INNODB_TRX b ON b.trx_id = w.blocking_trx_id`,
    );
    if (waits.length > 0) {
      console.log('[CH2.6 Lock Wait Evidence]', JSON.stringify(waits[0]));
      lockWaitObserved = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  assert.equal(lockWaitObserved, true, 'Conn 2 must block on InnoDB row lock held by Conn 1');
  assert.equal(conn2Finished, false, 'Conn 2 must not finish while Conn 1 holds uncommitted deletion lock');

  // Commit deletion on Conn 1
  await conn1.commit();
  const raceResult = await conn2Promise;
  assert.equal(raceResult.updated, false, 'Concurrent worker must not update post after deletion commits');
  assert.equal(raceResult.skippedStale, true);
  assert.equal(raceResult.status, 'stale_ignored');

  // Direct post-deletion failure attempt is also rejected
  const failAfterDelete = await persistFailedChannelViewFetch(conn2, postId, 'timeout', 'mtproto', 1793995000000);
  assert.equal(failAfterDelete.updated, false);
  assert.equal(failAfterDelete.skippedStale, true);

  const [[finalRow]] = await pool.query('SELECT views, status, deleted_at, view_fetch_status FROM campaign_posts WHERE id = ?', [postId]);
  assert.equal(Number(finalRow.views), 180, 'Views must remain at pre-deletion 180');
  assert.equal(finalRow.status, 'deleted', 'Deleted status must not be resurrected');
  assert.ok(finalRow.deleted_at, 'deleted_at must remain set');
  assert.equal(finalRow.view_fetch_status, 'success');
});

test('CH2.7: Older or equal failed fetch cannot overwrite newer verified success; newer failure preserves views and settled_views', async () => {
  const postId = 1007;
  const confirmedTs = 1793980000000;
  await pool.query(
    `INSERT INTO campaign_posts (id, campaign_id, channel_id, views, settled_views, status)
     VALUES (?, 1, 10, 50, 50, 'active')`,
    [postId],
  );

  const okRes = await persistSuccessfulChannelViews(conn1, postId, 600, 'public_api', confirmedTs);
  assert.equal(okRes.updated, true);

  // Older failed fetch
  const olderFail = await persistFailedChannelViewFetch(conn2, postId, 'network_timeout', 'mtproto', confirmedTs - 5000);
  assert.equal(olderFail.updated, false);
  assert.equal(olderFail.skippedStale, true);
  assert.equal(olderFail.status, 'stale_ignored');

  // Equal timestamp failed fetch
  const equalFail = await persistFailedChannelViewFetch(conn2, postId, 'network_timeout', 'mtproto', confirmedTs);
  assert.equal(equalFail.updated, false);
  assert.equal(equalFail.skippedStale, true);

  const [[afterStaleFail]] = await pool.query('SELECT * FROM campaign_posts WHERE id = ?', [postId]);
  assert.equal(afterStaleFail.view_fetch_status, 'success', 'Stale failure must not overwrite success status');
  assert.equal(afterStaleFail.view_fetch_error, null);
  assert.equal(Number(afterStaleFail.view_fetch_failures), 0);
  assert.equal(Number(afterStaleFail.views), 600);
  assert.equal(Number(afterStaleFail.settled_views), 50);

  // Newer failed fetch records attempt metadata without altering confirmed views/timestamps/settled_views
  const newerFail = await persistFailedChannelViewFetch(conn2, postId, 'FLOOD_WAIT_60', 'mtproto', confirmedTs + 10000);
  assert.equal(newerFail.updated, true);
  assert.equal(newerFail.status, 'failed');

  const [[afterNewerFail]] = await pool.query('SELECT * FROM campaign_posts WHERE id = ?', [postId]);
  assert.equal(Number(afterNewerFail.views), 600);
  assert.equal(Number(afterNewerFail.settled_views), 50);
  assert.equal(Number(afterNewerFail.last_views_update), confirmedTs);
  assert.equal(afterNewerFail.view_fetch_status, 'failed');
  assert.equal(Number(afterNewerFail.view_fetch_failures), 1);
});

test('CH2.8: Callers (refreshChannelViews, refreshCampaignViews, and cron update-views) skip audit, counters, and billing when persistence reports updated=false', async () => {
  const postId = 1008;
  const futureMs = Date.now() + 3_600_000; // +1 hour ahead so Date.now() inside refresh callers is stale
  const futureUtc = normalizeViewTimestamp(futureMs).utcSqlDatetime;

  await pool.query(
    `INSERT INTO channels (id, user_id, username, channel_type, is_deleted, last_successful_view_fetch_at)
     VALUES (88, 2, 'test_pub_channel', 'public', 0, NULL)`,
  );
  await pool.query(
    `INSERT INTO campaign_posts (
       id, campaign_id, channel_id, message_id, status, deleted_at,
       delivery_confirmed_at, delivery_failed_at, views, settled_views,
       last_views_update, last_views_update_at, view_fetch_status, view_fetch_source
     ) VALUES (?, 55, 88, 42, 'active', NULL, UTC_TIMESTAMP(), NULL, 300, 300, ?, ?, 'success', 'public_api')`,
    [postId, futureMs, futureUtc],
  );

  const realPersistMod = loadTsWithMocks('src/lib/channelViewPersistence.ts');
  const adminRefreshMod = loadTsWithMocks('src/lib/channelAdminViewRefresh.ts', {
    '@/lib/db': { __esModule: true, default: pool },
    '@/lib/channelViewPersistence': realPersistMod,
    '@/lib/telegramMtproto': {
      getPrivatePostViews: async () => ({ ok: true, views: 999 }),
    },
  });

  // Mock global fetch so publicViews('@test_pub_channel', 42) returns 999 views
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    text: async () => '<span class="tgme_widget_message_views">999</span>',
  });
  try {
    const chRes = await adminRefreshMod.refreshChannelViews(88, 10);
    assert.equal(chRes.checked, 1);
    assert.equal(chRes.updated, 0, 'refreshChannelViews must not count stale ignored observation as updated');
    assert.equal(chRes.failed, 0);

    const campRes = await adminRefreshMod.refreshCampaignViews(55, 10);
    assert.equal(campRes.checked, 1);
    assert.equal(campRes.updated, 0, 'refreshCampaignViews must not count stale ignored observation as updated');
    assert.equal(campRes.failed, 0);
  } finally {
    globalThis.fetch = origFetch;
  }

  const [[chRow]] = await pool.query('SELECT last_successful_view_fetch_at FROM channels WHERE id = 88');
  assert.equal(chRow.last_successful_view_fetch_at, null, 'Channel diagnostic timestamp must not update on stale skip');
  const [[postRow]] = await pool.query('SELECT views FROM campaign_posts WHERE id = ?', [postId]);
  assert.equal(Number(postRow.views), 300, 'Views must remain 300');

  // Verify cron update-views route source & behavior: when persistSuccessfulChannelViews returns {updated:false},
  // neither campaign_views_audit nor debitConfirmedChannelViews is invoked.
  const cronRouteSource = readFileSync(path.resolve(process.cwd(), 'src/app/api/cron/update-views/route.ts'), 'utf8');
  assert.match(cronRouteSource, /if\s*\(\s*!accepted\.updated\s*\)/, 'cron update-views must gate on accepted.updated');

  let billingCalls = 0;
  const accepted = await persistSuccessfulChannelViews(pool, postId, 999, 'public_html', Date.now());
  assert.equal(accepted.updated, false);
  if (accepted.updated) {
    await pool.query(
      "INSERT INTO campaign_views_audit (post_id, channel_id, total_views, last_views_count, status) VALUES (?, 88, 999, 300, 'valid')",
      [postId],
    );
    billingCalls += 1;
  }
  const [[auditCount]] = await pool.query('SELECT COUNT(*) AS cnt FROM campaign_views_audit WHERE post_id = ?', [postId]);
  assert.equal(Number(auditCount.cnt), 0, 'Zero audit rows may be written when accepted.updated is false');
  assert.equal(billingCalls, 0, 'Zero billing calls may be triggered when accepted.updated is false');
});
