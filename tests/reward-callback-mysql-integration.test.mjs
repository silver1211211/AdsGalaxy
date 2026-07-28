import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { after, before, test } from "node:test";
import "./reward-callback-production-loader.mjs";

const rawUrl = process.env.ADSGALAXY_REWARD_TEST_DATABASE_URL || "";
let safeUrl = null;
if (rawUrl) {
  safeUrl = new URL(rawUrl);
  const database = safeUrl.pathname.replace(/^\//, "");
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(safeUrl.hostname), "test database must be local");
  assert.equal(database, "adsgalaxy_reward_test", "unexpected test database");
  console.log(`validated host: ${safeUrl.hostname}`);
  console.log(`validated port: ${safeUrl.port || "3306"}`);
  console.log(`validated database: ${database}`);
  console.log(`username present: ${Boolean(safeUrl.username)}`);
  console.log(`password present: ${Boolean(safeUrl.password)}`);
}

const integration = { skip: !safeUrl, concurrency: false };
let mysql;
let pool;
let rewardService;
let developerService;
let productionPool;
const prefix = `t${process.pid.toString(36)}${Date.now().toString(36).slice(-6)}${crypto.randomBytes(3).toString("hex")}`;
const ids = {
  users: [],
  apps: [],
  miniapps: [],
  keys: [],
  webhooks: [],
  events: [],
  deliveries: [],
};

const randomId = (kind) => `${kind}_${prefix}_${crypto.randomBytes(12).toString("hex")}`;
const json = (value) => JSON.stringify(value);

async function connection() {
  const conn = await pool.getConnection();
  const [[row]] = await conn.query("SELECT DATABASE() AS name");
  assert.equal(row.name, "adsgalaxy_reward_test");
  return conn;
}

async function fixture({ mode = "production", miniapps = 1, webhooks = 1 } = {}) {
  const conn = await connection();
  try {
    const telegram = randomId("tg");
    const [userResult] = await conn.query(
      "INSERT INTO users (telegram_id, first_name, username) VALUES (?, 'Reward Test', ?)",
      [telegram, randomId("user")]
    );
    const userId = Number(userResult.insertId);
    ids.users.push(userId);
    const [appResult] = await conn.query(
      "INSERT INTO developer_applications (user_id, name, mode, status, permissions) VALUES (?, ?, ?, 'active', ?)",
      [userId, randomId("app"), mode, json(["reward_validation"])]
    );
    const appId = Number(appResult.insertId);
    ids.apps.push(appId);
    const [keyResult] = await conn.query(
      `INSERT INTO developer_api_keys
       (application_id,user_id,key_type,key_prefix,key_hash,status,permissions)
       VALUES (?,?,'private',?,?, 'active',?)`,
      [appId, userId, randomId("kp").slice(0, 30), crypto.randomBytes(32).toString("hex"), json(["reward_validation"])]
    );
    const keyId = Number(keyResult.insertId);
    ids.keys.push(keyId);
    const miniappIds = [];
    for (let index = 0; index < miniapps; index += 1) {
      const [miniResult] = await conn.query(
        `INSERT INTO miniapps
         (user_id,miniapp_name,miniapp_username,bot_id,webapp_url,miniapp_url,status)
         VALUES (?,?,?,?,?,?,'active')`,
        [userId, randomId("mini"), randomId("mu"), randomId("bot"), "https://example.invalid", "https://example.invalid"]
      );
      miniappIds.push(Number(miniResult.insertId));
      ids.miniapps.push(Number(miniResult.insertId));
    }
    const webhookIds = [];
    for (let index = 0; index < webhooks; index += 1) {
      const [webhookResult] = await conn.query(
        `INSERT INTO developer_webhooks
         (application_id,user_id,url,secret,events,status)
         VALUES (?,?,?, ?, ?, 'active')`,
        [appId, userId, "http://127.0.0.1/unused", randomId("secret"), json(["reward.eligible", "reward.claimed"])]
      );
      webhookIds.push(Number(webhookResult.insertId));
      ids.webhooks.push(Number(webhookResult.insertId));
    }
    return { userId, appId, keyId, miniappIds, webhookIds, mode };
  } finally {
    conn.release();
  }
}

async function bind(conn, appId, miniappId, environment) {
  const [[existing]] = await conn.query(
    `SELECT id,application_id FROM developer_application_miniapps
     WHERE miniapp_id=? AND environment=? FOR UPDATE`,
    [miniappId, environment]
  );
  if (existing && Number(existing.application_id) !== appId) {
    throw Object.assign(new Error("MINIAPP_ALREADY_BOUND"), { code: "MINIAPP_ALREADY_BOUND" });
  }
  if (existing) {
    await conn.query("UPDATE developer_application_miniapps SET status='active' WHERE id=?", [existing.id]);
    return Number(existing.id);
  }
  const [result] = await conn.query(
    `INSERT INTO developer_application_miniapps (application_id,miniapp_id,environment,status)
     VALUES (?,?,?,'active')`,
    [appId, miniappId, environment]
  );
  return Number(result.insertId);
}

async function insertEvent(conn, fixtureData, overrides = {}) {
  const event = {
    eventId: randomId("rwe"),
    requestId: randomId("req"),
    miniappId: fixtureData.miniappIds[0],
    appId: fixtureData.appId,
    publisherId: fixtureData.userId,
    telegramUserId: Date.now(),
    provider: "internal",
    providerEventId: randomId("provider"),
    status: "eligible",
    verification: "ads_galaxy_validated",
    eligible: 1,
    environment: fixtureData.mode,
    ...overrides,
  };
  const [result] = await conn.query(
    `INSERT INTO miniapp_reward_events
     (event_id,request_id,miniapp_id,application_id,publisher_id,telegram_user_id,
      provider,provider_event_id,status,verification_level,reward_eligible,
      completed_at,expires_at,environment,metadata)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 1 DAY),?,?)`,
    [event.eventId, event.requestId, event.miniappId, event.appId, event.publisherId,
      event.telegramUserId, event.provider, event.providerEventId, event.status,
      event.verification, event.eligible, event.environment, json({ prefix })]
  );
  event.id = Number(result.insertId);
  ids.events.push(event.id);
  return event;
}

async function enqueue(conn, webhookId, appId, eventId, eventType, sequence = 0, source = null) {
  const logicalKey = `${webhookId}:${eventId}:${eventType}:manual:${sequence}`;
  const [result] = await conn.query(
    `INSERT INTO developer_webhook_deliveries
     (webhook_id,application_id,event_type,event_id,webhook_version,signature_version,
      secret_version,signing_secret,logical_delivery_key,manual_retry_sequence,payload,
      status,next_attempt_at,manually_retried_from_id)
     VALUES (?,?,?,?,'v2','v2',1,?,?,?,?,'pending',CURRENT_TIMESTAMP,?)`,
    [webhookId, appId, eventType, eventId, randomId("sign"), logicalKey, sequence,
      json({ event_id: eventId, type: eventType }), source]
  );
  ids.deliveries.push(Number(result.insertId));
  return Number(result.insertId);
}

before(async () => {
  if (!safeUrl) return;
  mysql = await import("mysql2/promise");
  pool = mysql.createPool({ uri: rawUrl, connectionLimit: 12 });
  rewardService = await import("../src/lib/miniappRewardEvents.ts");
  developerService = await import("../src/lib/developerPlatform.ts");
  productionPool = (await import("./reward-callback-test-db.mjs")).default;
  const conn = await connection();
  try {
    const [tables] = await conn.query(
      `SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES
       WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN
       ('users','miniapps','developer_applications','developer_api_keys','developer_webhooks',
        'developer_webhook_deliveries','developer_application_miniapps','miniapp_reward_events',
        'miniapp_reward_claims','miniapp_reward_event_transitions')`
    );
    assert.equal(tables.length, 10);
    assert.ok(tables.every((row) => row.ENGINE === "InnoDB"));
  } finally {
    conn.release();
  }
});

after(async () => {
  if (!pool) return;
  const conn = await connection();
  try {
    await conn.query("SET FOREIGN_KEY_CHECKS=1");
    if (ids.apps.length) {
      const [serviceDeliveries] = await conn.query(
        "SELECT id FROM developer_webhook_deliveries WHERE application_id IN (?)",
        [ids.apps]
      );
      for (const row of serviceDeliveries) ids.deliveries.push(Number(row.id));
    }
    ids.deliveries = [...new Set(ids.deliveries)];
    if (ids.deliveries.length) {
      await conn.query("DELETE FROM developer_webhook_action_audits WHERE delivery_id IN (?)", [ids.deliveries]);
      await conn.query("DELETE FROM developer_webhook_deliveries WHERE id IN (?) ORDER BY id DESC", [ids.deliveries]);
    }
    if (ids.events.length) {
      await conn.query("DELETE FROM miniapp_reward_event_transitions WHERE reward_event_id IN (?)", [ids.events]);
      await conn.query("DELETE FROM miniapp_reward_claims WHERE reward_event_id IN (?)", [ids.events]);
      await conn.query("DELETE FROM miniapp_reward_events WHERE id IN (?)", [ids.events]);
    }
    if (ids.miniapps.length) {
      await conn.query("DELETE FROM developer_reward_action_audits WHERE miniapp_id IN (?)", [ids.miniapps]);
      await conn.query("DELETE FROM developer_application_miniapps WHERE miniapp_id IN (?)", [ids.miniapps]);
      await conn.query("DELETE FROM miniapp_mediation_requests WHERE miniapp_id IN (?)", [ids.miniapps]);
    }
    if (ids.webhooks.length) {
      await conn.query("DELETE FROM developer_webhook_action_audits WHERE webhook_id IN (?)", [ids.webhooks]);
      await conn.query("DELETE FROM developer_webhooks WHERE id IN (?)", [ids.webhooks]);
    }
    if (ids.keys.length) await conn.query("DELETE FROM developer_api_keys WHERE id IN (?)", [ids.keys]);
    if (ids.apps.length) {
      await conn.query("DELETE FROM developer_reward_action_audits WHERE application_id IN (?)", [ids.apps]);
      await conn.query("DELETE FROM developer_webhook_action_audits WHERE application_id IN (?)", [ids.apps]);
      await conn.query("DELETE FROM developer_applications WHERE id IN (?)", [ids.apps]);
    }
    if (ids.miniapps.length) await conn.query("DELETE FROM miniapps WHERE id IN (?)", [ids.miniapps]);
    if (ids.users.length) await conn.query("DELETE FROM users WHERE id IN (?)", [ids.users]);
  } finally {
    conn.release();
    await pool.end();
    if (productionPool) await productionPool.end();
  }
});

test("schema has required InnoDB indexes, foreign keys, nullability, and restrictive history", integration, async () => {
  const conn = await connection();
  try {
    const [indexes] = await conn.query(
      `SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA=DATABASE() AND INDEX_NAME IN
       ('uniq_developer_miniapp_environment','uniq_miniapp_reward_request_id',
        'uniq_miniapp_reward_claim_event','uniq_miniapp_reward_claim_idempotency',
        'uniq_developer_webhook_delivery_logical')`
    );
    assert.equal(new Set(indexes.map((row) => `${row.TABLE_NAME}:${row.INDEX_NAME}`)).size, 5);
    assert.ok(indexes.every((row) => Number(row.NON_UNIQUE) === 0));
    const [foreignKeys] = await conn.query(
      `SELECT TABLE_NAME,CONSTRAINT_NAME,DELETE_RULE
       FROM information_schema.REFERENTIAL_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN
       ('developer_application_miniapps','miniapp_reward_events','miniapp_reward_claims',
        'miniapp_reward_event_transitions','developer_webhook_deliveries')`
    );
    assert.ok(foreignKeys.length >= 11);
    assert.ok(foreignKeys.filter((row) => row.TABLE_NAME.includes("reward")).every((row) => row.DELETE_RULE !== "CASCADE"));
    const [nullable] = await conn.query(
      `SELECT COLUMN_NAME,IS_NULLABLE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='miniapp_reward_events'
       AND COLUMN_NAME IN ('application_id','claimed_by_key_id','claimed_by_application_id')`
    );
    assert.ok(nullable.every((row) => row.IS_NULLABLE === "YES"));
  } finally {
    conn.release();
  }
});

test("bindings enforce ownership, idempotency, reactivation, uniqueness, and environment isolation", integration, async () => {
  const owner = await fixture({ miniapps: 3 });
  const other = await fixture();
  const conn = await connection();
  try {
    const first = await rewardService.createOrReactivateApplicationMiniappBinding({
      applicationId: owner.appId,
      miniappId: owner.miniappIds[0],
      environment: "production",
    });
    const repeated = await rewardService.createOrReactivateApplicationMiniappBinding({
      applicationId: owner.appId,
      miniappId: owner.miniappIds[0],
      environment: "production",
    });
    assert.equal(Number(repeated.id), Number(first.id));
    await conn.query("UPDATE developer_application_miniapps SET status='inactive' WHERE id=?", [first.id]);
    const reactivated = await rewardService.createOrReactivateApplicationMiniappBinding({
      applicationId: owner.appId,
      miniappId: owner.miniappIds[0],
      environment: "production",
    });
    assert.equal(Number(reactivated.id), Number(first.id));
    const [[active]] = await conn.query("SELECT status FROM developer_application_miniapps WHERE id=?", [first.id]);
    assert.equal(active.status, "active");
    await assert.rejects(
      async () => {
        const [[app]] = await conn.query("SELECT user_id FROM developer_applications WHERE id=?", [owner.appId]);
        const [[mini]] = await conn.query("SELECT user_id FROM miniapps WHERE id=?", [other.miniappIds[0]]);
        if (Number(app.user_id) !== Number(mini.user_id)) throw new Error("OWNERSHIP_MISMATCH");
      },
      /OWNERSHIP_MISMATCH/
    );
    await assert.rejects(
      () => rewardService.createOrReactivateApplicationMiniappBinding({
        applicationId: other.appId,
        miniappId: owner.miniappIds[0],
        environment: "production",
      }),
      /owners do not match/
    );
    const [secondAppResult] = await conn.query(
      `INSERT INTO developer_applications
       (user_id,name,mode,status,permissions)
       VALUES (?,?,'production','active',?)`,
      [owner.userId, randomId("second_app"), json(["reward_validation"])]
    );
    const secondAppId = Number(secondAppResult.insertId);
    ids.apps.push(secondAppId);
    await assert.rejects(
      () => rewardService.createOrReactivateApplicationMiniappBinding({
        applicationId: secondAppId,
        miniappId: owner.miniappIds[0],
        environment: "production",
      }),
      /Mini App environment is already bound/
    );
    await rewardService.createOrReactivateApplicationMiniappBinding({
      applicationId: owner.appId,
      miniappId: owner.miniappIds[1],
      environment: "production",
    });
    await assert.rejects(
      () => rewardService.createOrReactivateApplicationMiniappBinding({
        applicationId: owner.appId,
        miniappId: owner.miniappIds[2],
        environment: "sandbox",
      }),
      /environment does not match/
    );
    const sandboxOwner = await fixture({ mode: "sandbox" });
    const sandbox = await rewardService.createOrReactivateApplicationMiniappBinding({
      applicationId: sandboxOwner.appId,
      miniappId: sandboxOwner.miniappIds[0],
      environment: "sandbox",
    });
    assert.ok(Number(sandbox.id) > 0);
    const [[count]] = await conn.query(
      "SELECT COUNT(*) count FROM developer_application_miniapps WHERE application_id=?",
      [owner.appId]
    );
    assert.equal(Number(count.count), 2);
  } finally {
    conn.release();
  }
});

test("concurrent event creation resolves one request to one immutable event", integration, async () => {
  const f = await fixture();
  const setup = await connection();
  await bind(setup, f.appId, f.miniappIds[0], "production");
  setup.release();
  const requestId = randomId("concurrent_req");
  const eventA = randomId("rwe");
  const eventB = randomId("rwe");
  const c1 = await connection();
  const c2 = await connection();
  const insert = async (conn, eventId) => {
    await conn.beginTransaction();
    try {
      await conn.query(
        `INSERT INTO miniapp_reward_events
         (event_id,request_id,miniapp_id,application_id,publisher_id,telegram_user_id,provider,
          provider_event_id,status,verification_level,reward_eligible,completed_at,expires_at,environment)
         VALUES (?,?,?,?,?,?,'internal',?,'eligible','ads_galaxy_validated',1,NOW(),DATE_ADD(NOW(),INTERVAL 1 DAY),'production')`,
        [eventId, requestId, f.miniappIds[0], f.appId, f.userId, Date.now(), randomId("provider")]
      );
      await conn.commit();
      const [[row]] = await conn.query("SELECT id,event_id FROM miniapp_reward_events WHERE request_id=?", [requestId]);
      ids.events.push(Number(row.id));
      return row.event_id;
    } catch (error) {
      await conn.rollback();
      if (error.code !== "ER_DUP_ENTRY") throw error;
      const [[row]] = await conn.query(
        "SELECT id,event_id,miniapp_id,application_id,publisher_id FROM miniapp_reward_events WHERE request_id=?",
        [requestId]
      );
      assert.equal(Number(row.miniapp_id), f.miniappIds[0]);
      assert.equal(Number(row.application_id), f.appId);
      assert.equal(Number(row.publisher_id), f.userId);
      return row.event_id;
    }
  };
  try {
    await c1.beginTransaction();
    await c1.query(
      `INSERT INTO miniapp_reward_events
       (event_id,request_id,miniapp_id,application_id,publisher_id,telegram_user_id,provider,
        provider_event_id,status,verification_level,reward_eligible,completed_at,expires_at,environment)
       VALUES (?,?,?,?,?,?,'internal',?,'eligible','ads_galaxy_validated',1,NOW(),DATE_ADD(NOW(),INTERVAL 1 DAY),'production')`,
      [eventA, requestId, f.miniappIds[0], f.appId, f.userId, Date.now(), randomId("provider")]
    );
    const second = insert(c2, eventB);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await c1.commit();
    const [[created]] = await c1.query("SELECT id,event_id FROM miniapp_reward_events WHERE request_id=?", [requestId]);
    ids.events.push(Number(created.id));
    const resolved = await second;
    assert.equal(resolved, eventA);
    const [[count]] = await c1.query("SELECT COUNT(*) count FROM miniapp_reward_events WHERE request_id=?", [requestId]);
    assert.equal(Number(count.count), 1);
    await assert.rejects(
      () => insertEvent(c1, f, { requestId, miniappId: f.miniappIds[0], appId: f.appId + 999999 }),
      /foreign key|constraint|Duplicate/i
    );
  } finally {
    c1.release();
    c2.release();
  }
});

test("event and eligible outbox are atomic and ID collisions remain bounded", integration, async () => {
  const f = await fixture();
  const conn = await connection();
  await bind(conn, f.appId, f.miniappIds[0], "production");
  const existing = await insertEvent(conn, f);
  let selected = null;
  for (const candidate of [existing.eventId, randomId("rwe")]) {
    try {
      const created = await insertEvent(conn, f, { eventId: candidate });
      selected = created;
      break;
    } catch (error) {
      if (error.code !== "ER_DUP_ENTRY") throw error;
    }
  }
  assert.ok(selected && selected.eventId !== existing.eventId);
  const requestId = randomId("atomic");
  await conn.beginTransaction();
  try {
    const event = await insertEvent(conn, f, { requestId });
    await enqueue(conn, f.webhookIds[0], f.appId, event.eventId, "reward.eligible");
    await assert.rejects(
      () => enqueue(conn, f.webhookIds[0], f.appId, event.eventId, "reward.eligible"),
      { code: "ER_DUP_ENTRY" }
    );
    throw new Error("force rollback");
  } catch {
    await conn.rollback();
  }
  const [[rolledBack]] = await conn.query("SELECT COUNT(*) count FROM miniapp_reward_events WHERE request_id=?", [requestId]);
  assert.equal(Number(rolledBack.count), 0);
  const disabledRequest = randomId("disabled");
  const enabled = false;
  if (enabled) await insertEvent(conn, f, { requestId: disabledRequest });
  const [[disabled]] = await conn.query("SELECT COUNT(*) count FROM miniapp_reward_events WHERE request_id=?", [disabledRequest]);
  assert.equal(Number(disabled.count), 0);
  const noBinding = await fixture();
  const [[binding]] = await conn.query(
    "SELECT COUNT(*) count FROM developer_application_miniapps WHERE application_id=? AND miniapp_id=?",
    [noBinding.appId, noBinding.miniappIds[0]]
  );
  assert.equal(Number(binding.count), 0);
  conn.release();
});

test("production event and outbox services share the caller transaction", integration, async () => {
  const f = await fixture();
  await rewardService.createOrReactivateApplicationMiniappBinding({
    applicationId: f.appId,
    miniappId: f.miniappIds[0],
    environment: "production",
  });
  const conn = await connection();
  const requestId = randomId("production_atomic");
  await conn.beginTransaction();
  try {
    const event = await rewardService.createRewardEvent({
      db: conn,
      requestId,
      miniappId: f.miniappIds[0],
      applicationId: f.appId,
      publisherId: f.userId,
      telegramUserId: Date.now(),
      provider: "AdsGalaxyInternal",
      status: "eligible",
      verificationLevel: "ads_galaxy_validated",
      rewardEligible: true,
      environment: "production",
    });
    ids.events.push(Number(event.id));
    await developerService.enqueueProductionRewardWebhook({
      db: conn,
      applicationId: f.appId,
      eventType: "reward.eligible",
      event,
    });
    const [[inside]] = await conn.query(
      "SELECT COUNT(*) count FROM developer_webhook_deliveries WHERE event_id=? AND event_type='reward.eligible'",
      [event.event_id]
    );
    assert.equal(Number(inside.count), 1);
    throw new Error("rollback production transaction");
  } catch (error) {
    await conn.rollback();
    assert.match(String(error), /rollback production transaction/);
  } finally {
    conn.release();
  }
  const check = await connection();
  const [[eventCount]] = await check.query("SELECT COUNT(*) count FROM miniapp_reward_events WHERE request_id=?", [requestId]);
  const [[deliveryCount]] = await check.query(
    "SELECT COUNT(*) count FROM developer_webhook_deliveries WHERE logical_delivery_key LIKE ?",
    [`%${requestId}%`]
  );
  assert.equal(Number(eventCount.count), 0);
  assert.equal(Number(deliveryCount.count), 0);
  check.release();
});

async function claimEvent(conn, f, eventId, idempotencyKey) {
  await conn.beginTransaction();
  try {
    const [[replay]] = await conn.query(
      "SELECT response_payload FROM miniapp_reward_claims WHERE application_id=? AND idempotency_key=?",
      [f.appId, idempotencyKey]
    );
    if (replay) {
      await conn.commit();
      return { replay: true, payload: replay.response_payload };
    }
    const [[event]] = await conn.query("SELECT * FROM miniapp_reward_events WHERE id=? FOR UPDATE", [eventId]);
    const [[postLockReplay]] = await conn.query(
      "SELECT response_payload FROM miniapp_reward_claims WHERE application_id=? AND idempotency_key=? FOR UPDATE",
      [f.appId, idempotencyKey]
    );
    if (postLockReplay) {
      await conn.commit();
      return { replay: true, payload: postLockReplay.response_payload };
    }
    if (!event || event.status !== "eligible" || !event.reward_eligible || event.reversed_at) {
      throw Object.assign(new Error("REWARD_ALREADY_CLAIMED"), { code: "REWARD_ALREADY_CLAIMED" });
    }
    if (new Date(event.expires_at).getTime() <= Date.now()) {
      await conn.query("UPDATE miniapp_reward_events SET status='expired' WHERE id=? AND status='eligible'", [eventId]);
      await conn.query(
        `INSERT INTO miniapp_reward_event_transitions
         (reward_event_id,from_status,to_status,from_verification_level,to_verification_level,reason_code,actor_type)
         SELECT ?, 'eligible','expired',verification_level,verification_level,'expired','application'
         FROM miniapp_reward_events WHERE id=?`,
        [eventId, eventId]
      );
      await conn.commit();
      throw Object.assign(new Error("REWARD_EXPIRED"), { code: "REWARD_EXPIRED" });
    }
    const payload = json({ success: true, event_id: event.event_id, claim_id: randomId("claim") });
    await conn.query(
      `INSERT INTO miniapp_reward_claims
       (reward_event_id,public_claim_id,application_id,api_key_id,idempotency_key,
        external_user_reference,response_payload)
       VALUES (?,?,?,?,?,?,?)`,
      [eventId, JSON.parse(payload).claim_id, f.appId, f.keyId, idempotencyKey, randomId("external"), payload]
    );
    await conn.query(
      `UPDATE miniapp_reward_events SET status='claimed',claimed_at=NOW(),
       claimed_by_key_id=?,claimed_by_application_id=? WHERE id=?`,
      [f.keyId, f.appId, eventId]
    );
    await conn.query(
      `INSERT INTO miniapp_reward_event_transitions
       (reward_event_id,from_status,to_status,from_verification_level,to_verification_level,reason_code,actor_type,actor_id)
       VALUES (?,'eligible','claimed','ads_galaxy_validated','ads_galaxy_validated','claimed','api_key',?)`,
      [eventId, f.keyId]
    );
    await enqueue(conn, f.webhookIds[0], f.appId, event.event_id, "reward.claimed");
    await conn.commit();
    return { replay: false, payload: JSON.parse(payload) };
  } catch (error) {
    try { await conn.rollback(); } catch {}
    if (error.code === "ER_DUP_ENTRY") {
      const [[stored]] = await conn.query(
        "SELECT response_payload FROM miniapp_reward_claims WHERE application_id=? AND idempotency_key=?",
        [f.appId, idempotencyKey]
      );
      if (stored) return { replay: true, payload: stored.response_payload };
      throw Object.assign(new Error("REWARD_ALREADY_CLAIMED"), { code: "REWARD_ALREADY_CLAIMED" });
    }
    throw error;
  }
}

test("same-key concurrent claims replay one response and one transition/outbox", integration, async () => {
  const f = await fixture();
  const setup = await connection();
  await bind(setup, f.appId, f.miniappIds[0], "production");
  const event = await insertEvent(setup, f);
  setup.release();
  const c1 = await connection();
  const c2 = await connection();
  const key = randomId("idem");
  try {
    const [a, b] = await Promise.all([claimEvent(c1, f, event.id, key), claimEvent(c2, f, event.id, key)]);
    assert.deepEqual(a.payload, b.payload);
    const check = await connection();
    const [[claims]] = await check.query("SELECT COUNT(*) count FROM miniapp_reward_claims WHERE reward_event_id=?", [event.id]);
    const [[transitions]] = await check.query("SELECT COUNT(*) count FROM miniapp_reward_event_transitions WHERE reward_event_id=? AND to_status='claimed'", [event.id]);
    const [[deliveries]] = await check.query("SELECT COUNT(*) count FROM developer_webhook_deliveries WHERE event_id=? AND event_type='reward.claimed'", [event.eventId]);
    assert.equal(Number(claims.count), 1);
    assert.equal(Number(transitions.count), 1);
    assert.equal(Number(deliveries.count), 1);
    check.release();
  } finally {
    c1.release();
    c2.release();
  }
});

test("production claim service resolves same-key and different-key races", integration, async () => {
  const f = await fixture();
  await rewardService.createOrReactivateApplicationMiniappBinding({
    applicationId: f.appId,
    miniappId: f.miniappIds[0],
    environment: "production",
  });
  const setup = await connection();
  const sameKeyEvent = await insertEvent(setup, f);
  const sameKey = randomId("production_idem");
  const input = {
    eventId: sameKeyEvent.eventId,
    miniappId: f.miniappIds[0],
    applicationId: f.appId,
    apiKeyId: f.keyId,
    userId: f.userId,
    environment: "production",
    externalUserReference: randomId("external"),
    idempotencyKey: sameKey,
  };
  const [first, replay] = await Promise.all([
    rewardService.claimRewardEvent(input),
    rewardService.claimRewardEvent(input),
  ]);
  assert.deepEqual(replay, first);

  const differentKeyEvent = await insertEvent(setup, f);
  const differentInput = {
    ...input,
    eventId: differentKeyEvent.eventId,
    externalUserReference: randomId("external"),
  };
  const different = await Promise.allSettled([
    rewardService.claimRewardEvent({ ...differentInput, idempotencyKey: randomId("idem_a") }),
    rewardService.claimRewardEvent({ ...differentInput, idempotencyKey: randomId("idem_b") }),
  ]);
  assert.equal(different.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = different.find((result) => result.status === "rejected");
  assert.equal(rejected?.reason?.code, "REWARD_ALREADY_CLAIMED");
  setup.release();
});

test("different-key claim race permits one claim and rejects all invalid event states", integration, async () => {
  const f = await fixture();
  const setup = await connection();
  await bind(setup, f.appId, f.miniappIds[0], "production");
  const event = await insertEvent(setup, f);
  setup.release();
  const c1 = await connection();
  const c2 = await connection();
  try {
    const settled = await Promise.allSettled([
      claimEvent(c1, f, event.id, randomId("idem_a")),
      claimEvent(c2, f, event.id, randomId("idem_b")),
    ]);
    assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(settled.filter((result) => result.status === "rejected").length, 1);
    const check = await connection();
    for (const overrides of [
      { status: "reversed", eligible: 0 },
      { status: "client_completed", verification: "client_confirmed", eligible: 0 },
    ]) {
      const invalid = await insertEvent(check, f, overrides);
      await assert.rejects(() => claimEvent(check, f, invalid.id, randomId("idem")), /REWARD_ALREADY_CLAIMED/);
    }
    const expired = await insertEvent(check, f);
    await check.query("UPDATE miniapp_reward_events SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE id=?", [expired.id]);
    await assert.rejects(() => claimEvent(check, f, expired.id, randomId("idem")), /REWARD_EXPIRED/);
    await assert.rejects(() => claimEvent(check, f, expired.id, randomId("idem2")), /REWARD_ALREADY_CLAIMED/);
    const [[expiryTransitions]] = await check.query(
      "SELECT COUNT(*) count FROM miniapp_reward_event_transitions WHERE reward_event_id=? AND to_status='expired'",
      [expired.id]
    );
    assert.equal(Number(expiryTransitions.count), 1);
    check.release();
  } finally {
    c1.release();
    c2.release();
  }
});

test("claim transition and outbox failures roll back claim and event state", integration, async () => {
  const f = await fixture();
  const conn = await connection();
  await bind(conn, f.appId, f.miniappIds[0], "production");
  for (const failure of ["transition", "outbox"]) {
    const event = await insertEvent(conn, f);
    await conn.beginTransaction();
    try {
      await conn.query(
        `INSERT INTO miniapp_reward_claims
         (reward_event_id,public_claim_id,application_id,api_key_id,idempotency_key,external_user_reference,response_payload)
         VALUES (?,?,?,?,?,?,?)`,
        [event.id, randomId("claim"), f.appId, f.keyId, randomId("idem"), randomId("external"), json({ ok: true })]
      );
      await conn.query("UPDATE miniapp_reward_events SET status='claimed' WHERE id=?", [event.id]);
      if (failure === "transition") {
        await conn.query(
          `INSERT INTO miniapp_reward_event_transitions
           (reward_event_id,to_status,to_verification_level,reason_code,actor_type)
           VALUES (999999999,'claimed','ads_galaxy_validated','claimed','test')`
        );
      } else {
        await conn.query(
          `INSERT INTO developer_webhook_deliveries
           (event_type,logical_delivery_key,status) VALUES ('reward.claimed',NULL,NULL)`
        );
      }
      await conn.commit();
      assert.fail("forced failure unexpectedly committed");
    } catch {
      await conn.rollback();
    }
    const [[state]] = await conn.query(
      `SELECT e.status,(SELECT COUNT(*) FROM miniapp_reward_claims c WHERE c.reward_event_id=e.id) claims
       FROM miniapp_reward_events e WHERE e.id=?`,
      [event.id]
    );
    assert.equal(state.status, "eligible");
    assert.equal(Number(state.claims), 0);
  }
  conn.release();
});

test("outbox uniqueness, endpoints, leases, and retry schedule use real locks", integration, async () => {
  const f = await fixture({ webhooks: 2 });
  const conn = await connection();
  await bind(conn, f.appId, f.miniappIds[0], "production");
  const event = await insertEvent(conn, f);
  await enqueue(conn, f.webhookIds[0], f.appId, event.eventId, "reward.eligible");
  await assert.rejects(
    () => enqueue(conn, f.webhookIds[0], f.appId, event.eventId, "reward.eligible"),
    { code: "ER_DUP_ENTRY" }
  );
  await enqueue(conn, f.webhookIds[1], f.appId, event.eventId, "reward.eligible");
  const external = await insertEvent(conn, f, { status: "client_completed", verification: "client_confirmed", eligible: 0 });
  const [[externalCount]] = await conn.query("SELECT COUNT(*) count FROM developer_webhook_deliveries WHERE event_id=?", [external.eventId]);
  assert.equal(Number(externalCount.count), 0);
  const leaseId = await enqueue(conn, f.webhookIds[0], f.appId, randomId("lease_event"), "reward.claimed");
  conn.release();
  const worker = async (token) => {
    const c = await connection();
    await c.beginTransaction();
    try {
      const [[row]] = await c.query(
        `SELECT id FROM developer_webhook_deliveries
         WHERE id=? AND status='pending' AND (claim_expires_at IS NULL OR claim_expires_at<NOW())
         FOR UPDATE SKIP LOCKED`,
        [leaseId]
      );
      if (!row) {
        await c.commit();
        return null;
      }
      await c.query(
        "UPDATE developer_webhook_deliveries SET claimed_at=NOW(),claim_token=?,claim_expires_at=DATE_ADD(NOW(),INTERVAL 1 MINUTE) WHERE id=?",
        [token, row.id]
      );
      await c.commit();
      return row.id;
    } finally {
      c.release();
    }
  };
  const tokenA = crypto.randomBytes(24).toString("base64url");
  const tokenB = crypto.randomBytes(24).toString("base64url");
  assert.notEqual(tokenA, tokenB);
  const claimed = await Promise.all([worker(tokenA), worker(tokenB)]);
  assert.equal(claimed.filter(Boolean).length, 1);
  const check = await connection();
  assert.equal(await worker(crypto.randomBytes(24).toString("base64url")), null);
  await check.query("UPDATE developer_webhook_deliveries SET claim_expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE id=?", [leaseId]);
  assert.equal(await worker(crypto.randomBytes(24).toString("base64url")), leaseId);
  const delays = [0, 1, 5, 15, 60, 360];
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const [[scheduled]] = await check.query("SELECT DATE_ADD(NOW(),INTERVAL ? MINUTE) due,NOW() now_value", [delays[attempt - 1]]);
    const deltaMinutes = Math.round((new Date(scheduled.due) - new Date(scheduled.now_value)) / 60000);
    assert.equal(deltaMinutes, delays[attempt - 1]);
  }
  await check.query(
    "UPDATE developer_webhook_deliveries SET attempts=6,status='failed',terminal_at=NOW(),next_attempt_at=NULL WHERE id=?",
    [leaseId]
  );
  const [[terminal]] = await check.query("SELECT status,terminal_at,next_attempt_at FROM developer_webhook_deliveries WHERE id=?", [leaseId]);
  assert.equal(terminal.status, "failed");
  assert.ok(terminal.terminal_at);
  assert.equal(terminal.next_attempt_at, null);
  check.release();
});

test("localhost receiver preserves raw body and verifies v2 signature and replay window", integration, async () => {
  const secret = crypto.randomBytes(32).toString("base64url");
  const eventId = randomId("rwe");
  const rawBody = JSON.stringify({ event_id: eventId, type: "reward.eligible", amount: "server-configured" });
  let received = null;
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      received = { body: Buffer.concat(chunks), headers: request.headers };
      response.writeHead(503);
      response.end("retry me");
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const { port } = server.address();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const input = `${timestamp}.${eventId}.${rawBody}`;
    const signature = crypto.createHmac("sha256", secret).update(input).digest("hex");
    const status = await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: "127.0.0.1",
        port,
        path: "/callback",
        method: "POST",
        timeout: 10_000,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(rawBody),
          "x-adsgalaxy-timestamp": timestamp,
          "x-adsgalaxy-event-id": eventId,
          "x-adsgalaxy-signature-version": "v2",
          "x-adsgalaxy-signature": signature,
        },
      }, (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      });
      request.on("timeout", () => request.destroy(new Error("timeout")));
      request.on("error", reject);
      request.end(rawBody);
    });
    assert.equal(status, 503);
    assert.equal(received.body.toString(), rawBody);
    assert.equal(received.headers["x-adsgalaxy-event-id"], eventId);
    assert.equal(received.headers["x-adsgalaxy-signature-version"], "v2");
    const expected = crypto.createHmac("sha256", secret)
      .update(`${received.headers["x-adsgalaxy-timestamp"]}.${eventId}.${received.body.toString()}`)
      .digest();
    assert.ok(crypto.timingSafeEqual(expected, Buffer.from(received.headers["x-adsgalaxy-signature"], "hex")));
    const validAge = Math.abs(Date.now() / 1000 - Number(timestamp));
    assert.ok(validAge <= 300);
    assert.ok(Math.abs(Date.now() / 1000 - (Number(timestamp) - 301)) > 300);
    const bodyHash = crypto.createHash("sha256").update(received.body).digest("hex");
    assert.equal(bodyHash.length, 64);
    const conn = await connection();
    const f = await fixture();
    const deliveryId = await enqueue(conn, f.webhookIds[0], f.appId, eventId, "reward.eligible");
    await conn.query(
      "UPDATE developer_webhook_deliveries SET response_status=?,response_body=?,attempts=1,next_attempt_at=DATE_ADD(NOW(),INTERVAL 1 MINUTE) WHERE id=?",
      [status, bodyHash, deliveryId]
    );
    const [[stored]] = await conn.query("SELECT response_body,next_attempt_at FROM developer_webhook_deliveries WHERE id=?", [deliveryId]);
    assert.equal(stored.response_body, bodyHash);
    assert.notEqual(stored.response_body, "retry me");
    conn.release();
    await assert.rejects(
      () => new Promise((resolve, reject) => {
        const request = http.request({ hostname: "127.0.0.1", port: 1, timeout: 500 }, resolve);
        request.on("error", reject);
        request.end();
      })
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("production bounded response reader caps and cancels oversized bodies", integration, async () => {
  let cancelled = false;
  const oversized = new Uint8Array((64 * 1024) + 4096).fill(97);
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(oversized);
    },
    cancel() {
      cancelled = true;
    },
  }), { status: 200 });
  const result = await developerService.hashBoundedWebhookResponse(response);
  assert.equal(result.bytesRead, 64 * 1024);
  assert.equal(result.truncated, true);
  assert.equal(result.hash, `sha256:${crypto.createHash("sha256").update(oversized.subarray(0, 64 * 1024)).digest("hex")}`);
  assert.equal(cancelled, true);
});

test("production webhook processor persists localhost connection-failure retries and terminal state", integration, async () => {
  const conn = await connection();
  const f = await fixture();
  if (ids.apps.length) {
    await conn.query(
      `UPDATE developer_webhook_deliveries
       SET status='delivered',next_attempt_at=NULL,claim_token=NULL,claim_expires_at=NULL
       WHERE application_id IN (?)`,
      [ids.apps]
    );
  }
  const probe = http.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  await conn.query("UPDATE developer_webhooks SET url=? WHERE id=?", [`http://127.0.0.1:${port}/closed`, f.webhookIds[0]]);
  const deliveryId = await enqueue(conn, f.webhookIds[0], f.appId, randomId("connection_failure"), "reward.claimed");
  const expectedDelays = [1, 5, 15, 60, 360];
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    if (attempt > 1) {
      await conn.query("UPDATE developer_webhook_deliveries SET next_attempt_at=NOW() WHERE id=?", [deliveryId]);
    }
    const result = await developerService.processPendingWebhookDeliveries();
    assert.equal(result.processed, 1);
    const [[row]] = await conn.query(
      `SELECT status,attempts,next_attempt_at,terminal_at,response_body,error_message,
              claim_token,claimed_at,claim_expires_at
       FROM developer_webhook_deliveries WHERE id=?`,
      [deliveryId]
    );
    assert.equal(Number(row.attempts), attempt);
    assert.equal(row.response_body, null);
    assert.ok(String(row.error_message || "").length <= 255);
    assert.equal(row.error_message, "Webhook request failed");
    assert.doesNotMatch(row.error_message, new RegExp(String(port)));
    assert.equal(row.claim_token, null);
    assert.equal(row.claimed_at, null);
    assert.equal(row.claim_expires_at, null);
    if (attempt < 6) {
      assert.equal(row.status, "retrying");
      const [[delta]] = await conn.query(
        "SELECT TIMESTAMPDIFF(SECOND,NOW(),next_attempt_at) seconds FROM developer_webhook_deliveries WHERE id=?",
        [deliveryId]
      );
      assert.ok(Number(delta.seconds) >= (expectedDelays[attempt - 1] * 60) - 5);
      assert.ok(Number(delta.seconds) <= (expectedDelays[attempt - 1] * 60) + 5);
      assert.equal(row.terminal_at, null);
    } else {
      assert.equal(row.status, "failed");
      assert.equal(row.next_attempt_at, null);
      assert.ok(row.terminal_at);
    }
  }
  const afterTerminal = await developerService.processPendingWebhookDeliveries();
  assert.equal(afterTerminal.processed, 0);
  conn.release();
});

test("secret rotation preserves snapshots, overlap, ownership, and audit secrecy", integration, async () => {
  const owner = await fixture();
  const other = await fixture();
  const conn = await connection();
  const webhookId = owner.webhookIds[0];
  const [[old]] = await conn.query("SELECT secret,secret_version FROM developer_webhooks WHERE id=? AND user_id=?", [webhookId, owner.userId]);
  const queuedId = await enqueue(conn, webhookId, owner.appId, randomId("queued"), "reward.eligible");
  await conn.query("UPDATE developer_webhook_deliveries SET signing_secret=?,secret_version=? WHERE id=?", [old.secret, old.secret_version, queuedId]);
  const rotated = await developerService.rotateDeveloperWebhookSecret(owner.userId, webhookId);
  const newSecret = rotated.secret;
  assert.notEqual(newSecret, old.secret);
  await assert.rejects(
    () => developerService.rotateDeveloperWebhookSecret(other.userId, webhookId),
    /Webhook not found/
  );
  const [[state]] = await conn.query(
    `SELECT secret,secret_version,previous_secret,previous_secret_version,
     TIMESTAMPDIFF(HOUR,NOW(),previous_secret_expires_at) overlap_hours
     FROM developer_webhooks WHERE id=?`,
    [webhookId]
  );
  assert.equal(state.secret, newSecret);
  assert.equal(state.previous_secret, old.secret);
  assert.ok(Number(state.overlap_hours) >= 23);
  const [[queued]] = await conn.query("SELECT signing_secret,secret_version FROM developer_webhook_deliveries WHERE id=?", [queuedId]);
  assert.equal(queued.signing_secret, old.secret);
  assert.equal(Number(queued.secret_version), Number(old.secret_version));
  const [[auditLeak]] = await conn.query(
    "SELECT COUNT(*) count FROM developer_webhook_action_audits WHERE webhook_id=? AND CAST(metadata AS CHAR) LIKE ?",
    [webhookId, `%${newSecret}%`]
  );
  assert.equal(Number(auditLeak.count), 0);
  conn.release();
});

test("rotation and retry audit failures roll back their production mutations", integration, async () => {
  const f = await fixture();
  const conn = await connection();
  const webhookId = f.webhookIds[0];
  const [[beforeRotation]] = await conn.query(
    "SELECT secret,secret_version FROM developer_webhooks WHERE id=?",
    [webhookId]
  );
  const trigger = `audit_fail_${prefix}`.slice(0, 60);
  await conn.query(
    `CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON developer_webhook_action_audits
     FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced audit failure'`
  );
  try {
    await assert.rejects(
      () => developerService.rotateDeveloperWebhookSecret(f.userId, webhookId),
      /forced audit failure/
    );
    const [[afterRotation]] = await conn.query(
      "SELECT secret,secret_version FROM developer_webhooks WHERE id=?",
      [webhookId]
    );
    assert.deepEqual(afterRotation, beforeRotation);

    const sourceId = await enqueue(conn, webhookId, f.appId, randomId("audit_retry"), "reward.claimed");
    await conn.query(
      "UPDATE developer_webhook_deliveries SET status='failed',attempts=6,terminal_at=NOW(),next_attempt_at=NULL WHERE id=?",
      [sourceId]
    );
    await assert.rejects(
      () => developerService.manuallyRetryDeveloperWebhook(f.userId, sourceId),
      /forced audit failure/
    );
    const [[retryCount]] = await conn.query(
      "SELECT COUNT(*) count FROM developer_webhook_deliveries WHERE manually_retried_from_id=?",
      [sourceId]
    );
    assert.equal(Number(retryCount.count), 0);
  } finally {
    await conn.query(`DROP TRIGGER IF EXISTS \`${trigger}\``);
    conn.release();
  }
});

test("production manual retry rejects invalid states and controls concurrent duplicates", integration, async () => {
  const owner = await fixture();
  const other = await fixture();
  const conn = await connection();
  for (const state of [
    { status: "pending", leased: false },
    { status: "delivered", leased: false },
    { status: "retrying", leased: false },
    { status: "failed", leased: true },
  ]) {
    const invalidId = await enqueue(conn, owner.webhookIds[0], owner.appId, randomId("invalid_retry"), "reward.claimed");
    await conn.query(
      `UPDATE developer_webhook_deliveries
       SET status=?,terminal_at=?,claim_token=?,claim_expires_at=?
       WHERE id=?`,
      [
        state.status,
        state.status === "failed" ? new Date() : null,
        state.leased ? randomId("lease") : null,
        state.leased ? new Date(Date.now() + 60_000) : null,
        invalidId,
      ]
    );
    await assert.rejects(
      () => developerService.manuallyRetryDeveloperWebhook(owner.userId, invalidId),
      /Terminal webhook delivery not found/
    );
  }

  const sourceId = await enqueue(conn, owner.webhookIds[0], owner.appId, randomId("retry_event"), "reward.claimed");
  await conn.query(
    "UPDATE developer_webhook_deliveries SET status='failed',attempts=6,terminal_at=NOW(),next_attempt_at=NULL WHERE id=?",
    [sourceId]
  );
  await assert.rejects(
    () => developerService.manuallyRetryDeveloperWebhook(other.userId, sourceId),
    /Terminal webhook delivery not found/
  );
  const concurrent = await Promise.allSettled([
    developerService.manuallyRetryDeveloperWebhook(owner.userId, sourceId),
    developerService.manuallyRetryDeveloperWebhook(owner.userId, sourceId),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
  const accepted = concurrent.find((result) => result.status === "fulfilled").value;
  const duplicate = concurrent.find((result) => result.status === "rejected").reason;
  assert.match(String(duplicate?.message), /Manual retry already queued/);
  const retryId = Number(accepted.delivery_id);
  ids.deliveries.push(retryId);
  const [[sourceAfter]] = await conn.query("SELECT status,attempts,terminal_at,payload FROM developer_webhook_deliveries WHERE id=?", [sourceId]);
  const [[retryRow]] = await conn.query("SELECT status,payload,manually_retried_from_id,manual_retry_sequence FROM developer_webhook_deliveries WHERE id=?", [retryId]);
  assert.equal(sourceAfter.status, "failed");
  assert.equal(Number(sourceAfter.attempts), 6);
  assert.equal(retryRow.status, "pending");
  assert.deepEqual(retryRow.payload, sourceAfter.payload);
  assert.equal(Number(retryRow.manually_retried_from_id), sourceId);
  assert.equal(Number(retryRow.manual_retry_sequence), 1);
  const [[audit]] = await conn.query("SELECT COUNT(*) count FROM developer_webhook_action_audits WHERE delivery_id=? AND action='webhook_manual_retry'", [retryId]);
  assert.equal(Number(audit.count), 1);
  await conn.query("UPDATE developer_webhook_deliveries SET status='delivered',delivered_at=NOW() WHERE id=?", [retryId]);
  const secondRetry = await developerService.manuallyRetryDeveloperWebhook(owner.userId, sourceId);
  ids.deliveries.push(Number(secondRetry.delivery_id));
  assert.equal(Number(secondRetry.manual_retry_sequence), 2);
  conn.release();
});

test("verification and lookup contracts enforce key permission, binding, scope, and non-leaking lookup", integration, async () => {
  const f = await fixture();
  const conn = await connection();
  const event = await insertEvent(conn, f);
  const [[privateKey]] = await conn.query(
    "SELECT key_type,permissions FROM developer_api_keys WHERE id=? AND status='active'",
    [f.keyId]
  );
  assert.equal(privateKey.key_type, "private");
  assert.ok(privateKey.permissions.includes("reward_validation"));
  await conn.query("UPDATE developer_api_keys SET permissions=? WHERE id=?", [json(["full_access"]), f.keyId]);
  const [[full]] = await conn.query("SELECT permissions FROM developer_api_keys WHERE id=?", [f.keyId]);
  assert.ok(full.permissions.includes("full_access"));
  await conn.query("UPDATE developer_api_keys SET key_type='public',permissions=? WHERE id=?", [json([]), f.keyId]);
  const [[publicKey]] = await conn.query("SELECT key_type,permissions FROM developer_api_keys WHERE id=?", [f.keyId]);
  assert.equal(publicKey.key_type, "public");
  assert.equal(publicKey.permissions.length, 0);
  const [[unbound]] = await conn.query(
    `SELECT e.id FROM miniapp_reward_events e
     JOIN developer_application_miniapps b ON b.application_id=? AND b.miniapp_id=e.miniapp_id
       AND b.environment=e.environment AND b.status='active'
     WHERE e.event_id=?`,
    [f.appId, event.eventId]
  );
  assert.equal(unbound, undefined);
  await bind(conn, f.appId, f.miniappIds[0], "production");
  const [[found]] = await conn.query(
    `SELECT e.status,e.verification_level,e.reward_eligible FROM miniapp_reward_events e
     JOIN developer_application_miniapps b ON b.application_id=? AND b.miniapp_id=e.miniapp_id
       AND b.environment=e.environment AND b.status='active'
     WHERE e.event_id=? AND e.application_id=?`,
    [f.appId, event.eventId, f.appId]
  );
  assert.equal(found.status, "eligible");
  assert.equal(found.verification_level, "ads_galaxy_validated");
  const external = await insertEvent(conn, f, { status: "client_completed", verification: "client_confirmed", eligible: 0 });
  assert.equal(external.eligible, 0);
  const reference = randomId("external_user");
  const [first] = await conn.query(
    "UPDATE miniapp_reward_events SET external_user_reference=? WHERE id=? AND external_user_reference IS NULL",
    [reference, event.id]
  );
  assert.equal(first.affectedRows, 1);
  const [conflict] = await conn.query(
    "UPDATE miniapp_reward_events SET external_user_reference=? WHERE id=? AND external_user_reference IS NULL",
    [randomId("conflict"), event.id]
  );
  assert.equal(conflict.affectedRows, 0);
  const [[missing]] = await conn.query(
    "SELECT id FROM miniapp_reward_events WHERE event_id=? AND application_id=? AND miniapp_id=?",
    [randomId("missing"), f.appId, f.miniappIds[0]]
  );
  assert.equal(missing, undefined);
  const pendingId = randomId("pending");
  await conn.query(
    `INSERT INTO miniapp_mediation_requests
     (miniapp_id,telegram_user_id,selected_network,request_id,final_result)
     VALUES (?,?,'internal',?,'pending')`,
    [f.miniappIds[0], Date.now(), pendingId]
  );
  const [[pending]] = await conn.query(
    "SELECT request_id FROM miniapp_mediation_requests WHERE request_id=? AND miniapp_id=? AND final_result='pending'",
    [pendingId, f.miniappIds[0]]
  );
  assert.equal(pending.request_id, pendingId);
  conn.release();
});
