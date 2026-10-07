import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyMtprotoError,
  createMtprotoAccountScheduler,
  orderMtprotoViewAccounts,
  resolveMemberCountAcrossAccounts,
  runMtprotoViewAttempts,
  safeMtprotoErrorCode,
  type MtprotoAccountKey,
} from "../src/lib/telegramMtproto.ts";

test("deterministic account ordering balances public and both-member private channels", () => {
  const both = ["account_1", "account_2"] as MtprotoAccountKey[];
  assert.deepEqual(orderMtprotoViewAccounts(both, 2, 1), ["account_1", "account_2"]);
  assert.deepEqual(orderMtprotoViewAccounts(both, 3, 1), ["account_1", "account_2"]);
  assert.deepEqual(orderMtprotoViewAccounts(["account_1"], 9, 2), ["account_1"]);
  assert.deepEqual(orderMtprotoViewAccounts(["account_2"], 9, 1), ["account_2"]);
  assert.deepEqual(orderMtprotoViewAccounts([], 9, 1), []);
});

test("FloodWait-shaped errors retain a safe retry duration", () => {
  const error = Object.assign(new Error("A wait of 120 seconds is required"), { seconds: 120 });
  assert.deepEqual(classifyMtprotoError(error), { code: "rate_limited", retryAfterSeconds: 120 });
});

test("both accounts on view cooldown return rate_limited without a Telegram attempt", async () => {
  let attempts = 0;
  const result = await runMtprotoViewAttempts({
    accountKeys: ["account_1", "account_2"],
    availability: (account) => ({
      available: false,
      code: "rate_limited",
      retryAfterSeconds: account === "account_1" ? 120 : 90,
    }),
    attempt: async () => { attempts += 1; return 10; },
  });

  assert.equal(attempts, 0);
  assert.deepEqual(result, {
    ok: false,
    code: "rate_limited",
    verifiedAccounts: [],
    attemptedAccounts: [],
    cooldownAccounts: [1, 2],
    requestsAttempted: 0,
    actualFailures: 0,
    retryAfterSeconds: 90,
  });
});

test("one account on view cooldown fails over to the available account", async () => {
  const attempted: MtprotoAccountKey[] = [];
  const result = await runMtprotoViewAttempts({
    accountKeys: ["account_1", "account_2"],
    preferredAccount: 1,
    availability: (account) => account === "account_1"
      ? { available: false, code: "rate_limited", retryAfterSeconds: 30 }
      : { available: true },
    attempt: async (account) => { attempted.push(account); return 42; },
  });

  assert.deepEqual(attempted, ["account_2"]);
  assert.deepEqual(result, {
    ok: true,
    views: 42,
    account: "account_2",
    verifiedAccounts: [],
    attemptedAccounts: [2],
    cooldownAccounts: [1],
    requestsAttempted: 1,
    actualFailures: 0,
    retryAfterSeconds: 30,
  });
});

test("membership cooldown does not block an available view-read operation", async () => {
  const membershipAvailability = { available: false, code: "rate_limited", retryAfterSeconds: 60 } as const;
  let attempts = 0;
  const result = await runMtprotoViewAttempts({
    accountKeys: ["account_1"],
    availability: () => ({ available: true }),
    attempt: async () => { attempts += 1; return 7; },
  });

  assert.equal(membershipAvailability.available, false);
  assert.equal(attempts, 1);
  assert.equal(result.ok, true);
});

test("private read proves access directly without a membership preflight", async () => {
  let attempts = 0;
  const result = await runMtprotoViewAttempts({
    accountKeys: ["account_1", "account_2"],
    privateChannel: true,
    preferredAccount: 1,
    availability: () => ({ available: true }),
    attempt: async (account) => {
      attempts += 1;
      assert.equal(account, "account_1");
      return 101;
    },
  });

  assert.equal(attempts, 1);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.verifiedAccounts, [1]);
});

test("private access failure on account 1 falls back to account 2", async () => {
  const attempted: MtprotoAccountKey[] = [];
  const result = await runMtprotoViewAttempts({
    accountKeys: ["account_1", "account_2"],
    privateChannel: true,
    preferredAccount: 1,
    availability: () => ({ available: true }),
    attempt: async (account) => {
      attempted.push(account);
      if (account === "account_1") throw new Error("USER_NOT_PARTICIPANT");
      return 55;
    },
  });

  assert.deepEqual(attempted, ["account_1", "account_2"]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.account, "account_2");
    assert.equal(result.actualFailures, 1);
  }
});

test("two private access failures return no_verified_private_member", async () => {
  const result = await runMtprotoViewAttempts({
    accountKeys: ["account_1", "account_2"],
    privateChannel: true,
    availability: () => ({ available: true }),
    attempt: async (account) => {
      throw new Error(account === "account_1" ? "USER_NOT_PARTICIPANT" : "CHANNEL_PRIVATE");
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "no_verified_private_member");
    assert.equal(result.requestsAttempted, 2);
    assert.equal(result.actualFailures, 2);
  }
});

test("FloodWait thrown by both attempted accounts returns rate_limited with the shortest retry", async () => {
  const result = await runMtprotoViewAttempts({
    accountKeys: ["account_1", "account_2"],
    availability: () => ({ available: true }),
    attempt: async (account) => {
      throw Object.assign(new Error("FLOOD_WAIT"), { seconds: account === "account_1" ? 120 : 90 });
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "rate_limited");
    assert.equal(result.retryAfterSeconds, 90);
    assert.equal(result.requestsAttempted, 2);
    assert.equal(result.actualFailures, 2);
  }
});

test("safe MTProto errors distinguish auth, membership, peer cache, and network failures", () => {
  assert.equal(safeMtprotoErrorCode(new Error("AUTH_KEY_UNREGISTERED")), "session_unauthorized");
  assert.equal(safeMtprotoErrorCode(new Error("USER_DEACTIVATED")), "account_deactivated");
  assert.equal(safeMtprotoErrorCode(new Error("USER_NOT_PARTICIPANT")), "not_channel_member");
  assert.equal(safeMtprotoErrorCode(new Error("Could not find the input entity for PeerChannel")), "peer_entity_unavailable");
  assert.equal(safeMtprotoErrorCode(new Error("getaddrinfo ENOTFOUND telegram.org")), "network_error");
  assert.equal(safeMtprotoErrorCode(new Error("RPC_CALL_FAIL")), "telegram_rpc_error");
});

test("duplicated Account 1 auth key requires reauthentication and is quarantined", async () => {
  const unhealthy = new Set<MtprotoAccountKey>();
  const health: Array<[MtprotoAccountKey, "healthy" | "unhealthy", string | undefined]> = [];

  const result = await resolveMemberCountAcrossAccounts(
    [{ key: "account_1" as const }],
    unhealthy,
    async () => { throw new Error("AUTH_KEY_DUPLICATED"); },
    async (account, status, code) => { health.push([account, status, code]); }
  );

  assert.deepEqual(result, {
    ok: false,
    code: "auth_key_duplicated",
    account: "account_1",
    retryAfterSeconds: undefined,
  });
  assert.equal(unhealthy.has("account_1"), true);
  assert.deepEqual(health, [["account_1", "unhealthy", "auth_key_duplicated"]]);

  let repeatedAttempts = 0;
  await resolveMemberCountAcrossAccounts(
    [{ key: "account_1" as const }],
    unhealthy,
    async () => { repeatedAttempts += 1; return 1; }
  );
  assert.equal(repeatedAttempts, 0);
});

test('the same account serializes requests while separate accounts remain independent', async () => {
  const events: string[] = [];
  let releaseFirst: () => void = () => undefined;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const scheduler = createMtprotoAccountScheduler({
    availability: () => ({ available: true }),
    minGapMs: 0,
  });

  const first = scheduler.run('account_1', 'membership', async () => {
    events.push('a1-first-start');
    await firstGate;
    events.push('a1-first-end');
    return 1;
  });
  const second = scheduler.run('account_1', 'view_read', async () => {
    events.push('a1-second');
    return 2;
  });
  const independent = scheduler.run('account_2', 'view_read', async () => {
    events.push('a2');
    return 3;
  });

  await independent;
  assert.deepEqual(events, ['a1-first-start', 'a2']);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(events, ['a1-first-start', 'a2', 'a1-first-end', 'a1-second']);
});

test('a rejected request does not break its account queue', async () => {
  const scheduler = createMtprotoAccountScheduler({ availability: () => ({ available: true }), minGapMs: 0 });
  await assert.rejects(scheduler.run('account_1', 'membership', async () => { throw new Error('temporary'); }));
  assert.equal(await scheduler.run('account_1', 'membership', async () => 9), 9);
});

test('dispatch-time cooldown prevents queued requests from touching Telegram', async () => {
  let coolingDown = false;
  let attempts = 0;
  let releaseFirst: () => void = () => undefined;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const scheduler = createMtprotoAccountScheduler({
    availability: () => coolingDown
      ? { available: false, code: 'rate_limited', retryAfterSeconds: 45 }
      : { available: true },
    minGapMs: 0,
  });
  const first = scheduler.run('account_1', 'view_read', async () => {
    attempts += 1;
    await firstGate;
    coolingDown = true;
    throw Object.assign(new Error('FLOOD_WAIT'), { seconds: 45 });
  });
  const queued = scheduler.run('account_1', 'membership', async () => { attempts += 1; return 2; });
  releaseFirst();

  await assert.rejects(first, /FLOOD_WAIT/);
  await assert.rejects(queued, (error: unknown) => {
    const structured = error as { code?: string; retryAfterSeconds?: number };
    return structured.code === 'rate_limited' && structured.retryAfterSeconds === 45;
  });
  assert.equal(attempts, 1);
});
