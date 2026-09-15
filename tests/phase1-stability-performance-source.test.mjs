import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Mini App shell is not gated by balance, stats, language, or an infinite loader", () => {
  const layout = read("src/components/layout/DashboardLayout.tsx");
  const telegram = read("src/lib/telegramWebApp.ts");
  assert.match(layout, /useState<BootState>\("ready"\)/);
  assert.doesNotMatch(layout, /return <AppBootState/);
  assert.doesNotMatch(layout, /for \(let attempt/);
  assert.match(layout, /initializeLocale\("en"\)/);
  assert.match(telegram, /INIT_DATA_RETRIES = 30/);
});

test("available Telegram identity avoids parallel session bootstrap failures", () => {
  const api = read("src/lib/api.ts");
  const telegram = read("src/lib/telegramWebApp.ts");
  assert.match(telegram, /export function getAvailableTelegramInitData/);
  assert.match(api, /sessionFirstGet[\s\S]*getAvailableTelegramInitData\(\)/);
});

test("campaign feed limits rows before loading metrics", () => {
  const feed = read("src/app/api/advertiser/campaign-feed/route.ts");
  assert.match(feed, /const PAGE_SIZE = 5/);
  assert.match(feed, /rows\.slice\(0, PAGE_SIZE\)/);
  assert.match(feed, /getRegularCampaignMetricsByIds\(regularRows\.map/);
  assert.doesNotMatch(feed, /SELECT COUNT\(\*\) FROM campaign_clicks cc WHERE cc\.campaign_id=c\.id/);
});

test("advertiser dashboard reuses bounded Mini App metric aggregation", () => {
  const stats = read("src/app/api/advertiser/stats/route.ts");
  assert.match(stats, /getMiniAppCampaignMetricsByAdvertiser\(userId\)/);
  assert.doesNotMatch(stats, /SELECT COUNT\(\*\) FROM miniapp_internal_ad_impressions i JOIN miniapp_rewarded_campaigns/);
});

test("Publisher and advertiser shells hydrate account summary independently", () => {
  const publisher = read("src/app/publisher/page.tsx");
  const advertiser = read("src/app/advertiser/page.tsx");
  for (const source of [publisher, advertiser]) {
    assert.match(source, /readDashboardSnapshot/);
    assert.match(source, /writeDashboardSnapshot/);
    assert.match(source, /apiFetch\("\/api\/(publisher|advertiser)\/stats"/);
    assert.match(source, /window\.setTimeout/);
    assert.doesNotMatch(source, /<AppBootState/);
  }
  assert.match(advertiser, /balanceError/);
  assert.match(advertiser, /Analytics are temporarily unavailable/);
});

test("Authenticated status reads preserve verification without onboarding writes", () => {
  const auth = read("src/lib/auth.ts");
  const statusBody = auth.slice(auth.indexOf("export async function getAuthenticatedUserStatus"));
  assert.match(statusBody, /validateInitData\([\s\S]*?initData![\s\S]*?botToken/);
  assert.doesNotMatch(statusBody, /UPDATE users SET last_active_at/);
  assert.doesNotMatch(statusBody, /updateUserReferralSecuritySignals/);
});

test("Campaign list is bounded and campaign funding keeps guarded transaction semantics", () => {
  const list = read("src/app/api/advertiser/campaigns/route.ts");
  const detail = read("src/app/api/advertiser/campaigns/[id]/route.ts");
  const directDebit = read("src/lib/advertiserDirectDebit.ts");
  assert.match(list, /Math\.min\(100/);
  assert.match(list, /ORDER BY c\.created_at DESC LIMIT \?/);
  assert.match(detail, /beginTransaction\(\)/);
  assert.match(detail, /FOR UPDATE/);
  assert.match(detail, /await conn\.commit\(\)/);
  assert.match(directDebit, /UPDATE users SET ad_balance=ad_balance-\? WHERE id=\? AND ad_balance>=\?/);
  assert.match(directDebit, /INSERT INTO advertiser_transactions/);
  assert.match(directDebit, /INSERT IGNORE INTO advertiser_direct_debits/);
});

test("Broadcast creation only queues durable work and worker owns discovery and delivery", () => {
  const create = read("src/app/api/admin/platform-broadcasts/route.ts");
  const worker = read("src/app/api/cron/platform-broadcasts/route.ts");
  const library = read("src/lib/platformBroadcast.ts");
  const postBody = create.slice(create.indexOf("export async function POST"));
  assert.match(postBody, /'queued'/);
  assert.doesNotMatch(postBody, /await discoverRecipients/);
  assert.doesNotMatch(postBody, /sendTelegramMessage/);
  assert.match(worker, /FOR UPDATE SKIP LOCKED/);
  assert.match(worker, /lease_expires_at/);
  assert.match(worker, /Promise\.all/);
  assert.match(worker, /classifyTelegramFailure/);
  assert.match(library, /maxBatches = 5/);
});

test("Admin shell uses progressive metric skeletons and localization remains available", () => {
  const admin = read("src/app/admin/page.tsx");
  const english = read("src/i18n/en.ts");
  const russian = read("src/i18n/ru.ts");
  assert.match(admin, /\/api\/admin\/dashboard\/summary/);
  assert.match(admin, /Refreshing detailed metrics/);
  assert.doesNotMatch(admin, /if \(loading\) \{\s*return \(/);
  assert.doesNotMatch(admin, /flex h-64 items-center justify-center/);
  assert.ok(english.length > 1_000);
  assert.ok(russian.length > 1_000);
});
