import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("fraud coverage prioritizes never-evaluated then oldest channels deterministically", () => {
  const source = read("src/lib/channelFraudDetection.ts");
  assert.match(source, /ORDER BY COALESCE\(fraud_last_evaluated_at,'1970-01-01 00:00:00'\) ASC,id ASC LIMIT/);
});

test("bounded repeated batches eventually reach channels beyond the first 200 without starvation", () => {
  const channels = Array.from({ length: 450 }, (_, index) => ({ id: index + 1, evaluatedAt: null }));
  let clock = 1;
  for (let run = 0; run < 3; run++) {
    const batch = [...channels].sort((a, b) => (a.evaluatedAt ?? 0) - (b.evaluatedAt ?? 0) || a.id - b.id).slice(0, 200);
    for (const channel of batch) channel.evaluatedAt = clock++;
  }
  assert.ok(channels.slice(200).every((channel) => channel.evaluatedAt !== null));
});

test("traffic event replay is idempotent and raw network data is not stored", () => {
  const migration = read("db/migrations/20260902_0123_channel_safety_foundation.sql");
  const telemetry = read("src/lib/channelTrafficTelemetry.ts");
  assert.match(migration, /UNIQUE KEY uq_channel_traffic_event_key\(event_key\)/);
  assert.match(telemetry, /INSERT IGNORE INTO channel_traffic_events/);
  assert.doesNotMatch(migration, /ip_address|user_agent/i);
  assert.match(telemetry, /createHmac\("sha256"/);
});

test("publisher aggregate risk persists explainable contributing signals", () => {
  const source = read("src/lib/channelSafety.ts");
  for (const reason of ["unscanned_channels", "stale_channel_evaluations", "mass_referral_creation", "shared_identity_referrals", "traffic_concentration", "low_publisher_trust"]) {
    assert.ok(source.includes(reason), `missing risk reason ${reason}`);
  }
  assert.match(source, /publisher_risk_assessments/);
});

test("withdrawal pre-clearance reviews incomplete coverage without rejecting", () => {
  const source = read("src/lib/channelSafety.ts");
  const route = read("src/app/api/admin/withdrawals/route.ts");
  assert.match(source, /incomplete_fraud_coverage/);
  assert.match(source, /manual_review_required/);
  assert.match(route, /requires manual review before approval/);
  assert.doesNotMatch(route, /UPDATE withdrawals SET status = 'rejected'.*preclearance/s);
});

test("legitimate withdrawals retain the cleared approval path", () => {
  const source = read("src/lib/channelSafety.ts");
  const route = read("src/app/api/admin/withdrawals/route.ts");
  assert.match(source, /reasons\.length \? "manual_review_required" : "cleared"/);
  assert.match(route, /UPDATE withdrawals SET status = 'success'/);
});

test("GEO conflicts stay explicit and unknown is not converted to Global", () => {
  const source = read("src/lib/channelGeoQuality.ts");
  assert.match(source, /conflict_detected: conflict/);
  assert.match(source, /"unknown"/);
  assert.doesNotMatch(source, /\|\|\s*"global"/i);
});

test("authorized exemptions are checked both before and inside the locked ban transaction", () => {
  const source = read("src/lib/publisherTrustEnforcement.ts");
  assert.ok((source.match(/hasActiveUserEnforcementExemption/g) || []).length >= 3);
  assert.match(source, /FROM users WHERE id=\? FOR UPDATE/);
});

test("non-exempt publishers retain the existing trust and 8.4 balance enforcement", () => {
  const source = read("src/lib/publisherTrustEnforcement.ts");
  assert.match(source, /PUBLISHER_TRUST_BAN_THRESHOLD = 20/);
  assert.match(source, /PUBLISHER_AVAILABLE_BALANCE_THRESHOLD = 8\.4/);
  assert.match(source, /availableBalance >= PUBLISHER_AVAILABLE_BALANCE_THRESHOLD/);
});

test("channel health monitoring remains diagnostic and never changes channel status", () => {
  const monitor = read("src/lib/channelHealthMonitor.ts");
  assert.match(monitor, /const autoPaused = false/);
  assert.match(monitor, /status_mutation_enabled: false/);
  assert.doesNotMatch(monitor, /status=CASE WHEN/);
  assert.doesNotMatch(monitor, /paused_reason=CASE WHEN/);
  assert.doesNotMatch(monitor, /auto_paused_at=IF/);
});

test("admin UI exposes review reasons, safety metrics, GEO confidence, and unban dispositions", () => {
  const withdrawals = read("src/app/admin/withdrawals/page.tsx");
  const dashboard = read("src/app/admin/page.tsx");
  const channels = read("src/app/admin/channels/page.tsx");
  const users = read("src/app/admin/users/page.tsx");
  assert.match(withdrawals, /Pre-clearance/);
  assert.match(dashboard, /Channel Trust & Safety/);
  assert.match(channels, /GEO Confidence/);
  assert.match(users, /Trust remediation/);
  assert.match(users, /No remediation/);
});

test("admin search and responsive list controls remain present", () => {
  for (const path of ["src/app/admin/users/page.tsx", "src/app/admin/channels/page.tsx", "src/app/admin/withdrawals/page.tsx"]) {
    const source = read(path);
    assert.match(source, /Search/);
    assert.match(source, /md:hidden|sm:|lg:/);
  }
});
