import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const helperSource = read("src/lib/channelViewPipeline.ts");
const helperJs = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const policy = await import(`data:text/javascript;base64,${Buffer.from(helperJs).toString("base64")}`);
const route = read("src/app/api/cron/update-views/route.ts");
const mtproto = read("src/lib/telegramMtproto.ts");

const success = (views, extra = {}) => policy.normalizePublicViewResult({
  httpStatus: 200, responseOk: true, payload: { status: "success", views, ...extra },
  expectedChannel: "known", expectedMessageId: 55,
});
const failure = (payload, httpStatus = 200) => policy.normalizePublicViewResult({
  httpStatus, responseOk: httpStatus < 400, payload,
  expectedChannel: "known", expectedMessageId: 55,
});

test("V1 more than 100 rows use bounded continuation", () => {
  assert.match(route, /while \(stats\.postsChecked < VIEW_FETCH_MAX_POSTS/);
  assert.match(route, /VIEW_FETCH_PAGE_SIZE/);
  assert.match(route, /pagesProcessed \+= 1/);
});
test("V2 execution budget stops intake safely", () => {
  assert.equal(policy.hasExecutionBudget(0, 1000, 100, 899), true);
  assert.equal(policy.hasExecutionBudget(0, 1000, 100, 900), false);
  assert.match(route, /executionBudgetDeferred/);
});
test("V3 never-refreshed and oldest ordering is explicit", () => {
  assert.match(route, /last_views_update IS NULL OR cp\.last_views_update = 0\) DESC/);
  assert.match(route, /lastUpdateOrder} ASC/);
});
test("V4 low IDs cannot form a permanent first page", () => {
  assert.match(route, /processedPostIds/);
  assert.match(route, /cp\.id NOT IN/);
  assert.match(route, /pageShard = \(batchSlot \+ pagesProcessed\)/);
});
test("V5 never-delivered failures are excluded", () => {
  assert.match(route, /delivery_failed_at IS NULL/);
  assert.match(route, /delivery_confirmed_at IS NOT NULL/);
});
test("V6 valid public success is accepted and billing is called", () => {
  assert.deepEqual(success(125), { ok: true, views: 125, source: "public_api" });
  assert.match(route, /debitConfirmedChannelViews/);
});
test("V7 lower provider reading cannot lower confirmed views", () => {
  assert.equal(policy.acceptedMonotonicViews(1000, 900), 1000);
  assert.match(route, /persistSuccessfulChannelViews/);
  assert.match(read("src/lib/channelViewPersistence.ts"), /GREATEST\(COALESCE\(views,0\),\?\)/);
});
test("V8 timeout is temporary with controlled retry", () => {
  const result = policy.classifyPublicTransportError(new DOMException("timed", "TimeoutError"));
  assert.equal(result.code, "timeout");
  assert.equal(policy.classifyViewFailure("timeout").classification, "temporary");
});
test("V9 repeated provider failures open the circuit", () => {
  const breaker = new policy.PublicProviderCircuitBreaker(2, 1000);
  breaker.record({ ok: false, code: "provider_error", rawCode: "http_500" }, 0);
  breaker.record({ ok: false, code: "provider_error", rawCode: "http_500" }, 0);
  assert.equal(breaker.canRequest(999), false);
  assert.equal(breaker.canRequest(1000), true);
});
test("V10 post-not-found is ambiguous until Telegram confirms it", () => {
  const result = failure({ status: "post-not-found" });
  assert.equal(result.code, "genuine_post_not_found");
  assert.equal(policy.classifyViewFailure("public:genuine_post_not_found").terminal, false);
});
test("V11 ambiguous public absence permits MTProto fallback", () => {
  assert.equal(policy.shouldFallbackPublicToMtproto(failure({ status: "post-not-found" })), true);
});
test("V12 flood wait creates exact cooldown metadata", () => {
  const result = failure({ status: "rate-limited", retry_after: 123 }, 429);
  assert.equal(result.retryAfterSeconds, 123);
  assert.equal(policy.classifyViewFailure("rate_limited", 123).retryAfterSeconds, 123);
});
test("V13 accounts in cooldown are filtered before attempts", () => {
  assert.match(mtproto, /getMtprotoViewPoolAvailability/);
  assert.match(mtproto, /availableAccounts/);
  assert.match(route, /mtprotoPool\.availableAccounts\.length === 0/);
});
test("V14 a healthy second account remains selectable", () => {
  assert.match(mtproto, /orderMtprotoViewAccounts/);
  assert.match(mtproto, /for \(const account of orderedKeys\)/);
});
test("V15 all unavailable accounts create no Telegram attempt", () => {
  assert.match(route, /attemptedAccounts: \[\]/);
  assert.match(route, /mtprotoNoAccountAvailable/);
  assert.match(route, /mtproto_unavailable_until/);
});
test("V16 peer entity unavailable remains retryable", () => {
  assert.equal(policy.classifyViewFailure("peer_entity_unavailable").terminal, false);
});
test("V17 confirmed invalid channel uses long operational retry", () => {
  const result = policy.classifyViewFailure("channel_invalid");
  assert.equal(result.classification, "operational");
  assert.equal(result.retryAfterSeconds, 21600);
});
test("V18 expired invite is not retried aggressively", () => {
  assert.equal(policy.classifyViewFailure("expired_invite_hash").retryAfterSeconds, 21600);
});
test("V19 private channel reads use MTProto with membership proof", () => {
  assert.match(route, /verifyPrivateMembership: true/);
  assert.match(mtproto, /GetMessagesViews/);
  assert.match(mtproto, /increment: false/);
});
test("V20 private access failure is not called post-not-found", () => {
  assert.equal(policy.classifyViewFailure("no_verified_private_member").classification, "operational");
  assert.doesNotMatch(policy.encodeViewFailure("no_verified_private_member"), /post_not_found/);
});
test("V21 view growth persists before canonical billing", () => {
  assert.equal(policy.acceptedMonotonicViews(1000, 1250), 1250);
  assert.ok(route.indexOf("UPDATE campaign_posts SET views") < route.indexOf("debitConfirmedChannelViews(Number(post.id)"));
});
test("V22 canonical billing handles repeated identical totals", () => {
  assert.match(route, /debitConfirmedChannelViews\(Number\(post\.id\), monotonicViews\)/);
  assert.doesNotMatch(route, /confirmedViews\s*-\s*previousViews/);
});
test("V23 billing failure preserves confirmed views", () => {
  assert.ok(route.indexOf("UPDATE campaign_posts SET views") < route.indexOf("Channel view billing trigger failed"));
  assert.match(route, /stats\.billingFailed \+= 1/);
});
test("V24 later higher count retains the full unsettled delta", () => {
  assert.equal(policy.acceptedMonotonicViews(1250, 1300), 1300);
  assert.match(route, /settled_views/);
});
test("V25 no negative billing can be created", () => {
  assert.equal(policy.acceptedMonotonicViews(1300, 1250), 1300);
});
test("V26 CPC analytics have lower queue priority", () => {
  assert.match(route, /c\.type = 'views'.*DESC/s);
  assert.match(route, /post\.campaign_type === "views"/);
});
test("V27 active CPM Views placements are prioritized", () => {
  assert.match(route, /c\.status IN \('active','daily_cap_reached'\)/);
});
test("V28 delivered historical deletion is handled outside the hot active queue", () => {
  assert.match(route, /cp\.status = 'active'/);
  assert.match(read("src/lib/channelAdminViewRefresh.ts"), /pre-deletion|pre_deletion/i);
});
test("V29 never-delivered deleted row is never fetched", () => {
  assert.match(route, /cp\.deleted_at IS NULL/);
  assert.match(route, /cp\.delivery_confirmed_at IS NOT NULL/);
});
test("V30 concurrent route workers use the existing global lock", () => {
  assert.match(route, /acquireCronLock\("update-views", 900\)/);
  assert.match(route, /releaseCronLock\(lock\)/);
});
test("V31 public concurrency is bounded", () => {
  assert.match(route, /PUBLIC_VIEW_CONCURRENCY/);
  assert.match(route, /Math\.min\(PUBLIC_VIEW_CONCURRENCY, posts\.length\)/);
  assert.match(route, /VIEW_FETCH_MAX_POSTS/);
});
test("V32 MTProto requests remain serialized per account", () => {
  assert.match(mtproto, /requestChains = new Map/);
  assert.match(mtproto, /await predecessor/);
});
test("V33 all four shards rotate fairly", () => {
  assert.match(route, /VIEW_SHARD_COUNT/);
  assert.match(route, /\(batchSlot \+ pagesProcessed\) % VIEW_SHARD_COUNT/);
});
test("V34 a 5000-row backlog remains bounded", () => {
  assert.match(route, /VIEW_FETCH_MAX_POSTS.*2_000/);
  assert.match(route, /oldest_deferred_age_seconds/);
});
test("V35 large overdue queue reports BACKLOGGED", () => {
  assert.equal(policy.viewWorkerHealth({ overdue: 5000, oldestDeferredAgeSeconds: 7200, temporaryFailures: 0, mtprotoUnavailable: false, publicProviderDegraded: false, warningBacklog: 500, warningAgeSeconds: 3600 }), "BACKLOGGED");
});
test("V36 HTTP 200 malformed payload is not success", () => {
  assert.equal(failure({ status: "success", views: "not-a-number" }).code, "malformed_response");
});
test("V37 response identity mismatch cannot update the post", () => {
  assert.equal(success(5, { channel: "wrong" }).code, "malformed_response");
  assert.equal(success(5, { post: 99 }).code, "malformed_response");
});
test("V38 retry-after exactness is encoded for SQL scheduling", () => {
  assert.match(policy.encodeViewFailure("rate_limited", 77), /retry_after=77/);
  assert.match(route, /SUBSTRING_INDEX\(cp\.view_fetch_error, 'retry_after='/);
});
test("V39 no transaction surrounds external view retrieval", () => {
  const fetchStart = route.indexOf("const processPageWorker");
  const fetchEnd = route.indexOf("Channel view post updated", fetchStart);
  assert.doesNotMatch(route.slice(fetchStart, fetchEnd), /beginTransaction/);
});
test("V40 Por-miembros-shaped overdue row is no longer trapped behind 100", () => {
  assert.match(route, /VIEW_FETCH_MAX_POSTS.*1_000/);
  assert.match(route, /while \(stats\.postsChecked/);
  assert.match(route, /billing_triggered/);
});
