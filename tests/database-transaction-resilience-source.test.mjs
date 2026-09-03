import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const resilience = fs.readFileSync("src/lib/dbResilience.ts", "utf8");
const request = fs.readFileSync("src/app/api/sdk/miniapp/request/route.ts", "utf8");
const fallback = fs.readFileSync("src/app/api/sdk/miniapp/fallback/route.ts", "utf8");

test("transaction retries release every connection and bound lock waits", () => {
  assert.match(resilience, /withTransactionRetry/);
  assert.match(resilience, /innodb_lock_wait_timeout = 5/);
  assert.match(resilience, /max_statement_time = 6/);
  assert.match(resilience, /await connection\.rollback\(\)/);
  assert.match(resilience, /connection\.release\(\)/);
  assert.match(resilience, /innodb_lock_wait_timeout = DEFAULT/);
  assert.match(resilience, /max_statement_time = DEFAULT/);
  assert.match(resilience, /connection\.destroy\(\)/);
  assert.match(resilience, /ER_LOCK_DEADLOCK/);
});

test("Mini App request and fallback use the same Mini App-first lock order", () => {
  for (const source of [request, fallback]) {
    assert.match(source, /withTransactionRetry/);
    assert.match(source, /SELECT id FROM miniapps WHERE id = \? FOR UPDATE/);
  }
  assert.ok(request.indexOf("SELECT id FROM miniapps") < request.indexOf("await recordMiniappAdOpportunity"));
  assert.ok(fallback.indexOf("SELECT id FROM miniapps") < fallback.indexOf("await getMediationRequestForFallback"));
});
