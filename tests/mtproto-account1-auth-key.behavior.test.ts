import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveMemberCountAcrossAccounts,
  type MtprotoAccountKey,
} from "../src/lib/telegramMtproto.ts";

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
