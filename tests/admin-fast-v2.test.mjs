import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("Admin dashboard renders immediately and hydrates summary independently", () => {
  const page = read("src/app/admin/page.tsx");
  assert.match(page, /\/api\/admin\/dashboard\/summary/);
  assert.match(page, /\/api\/admin\/dashboard/);
  assert.doesNotMatch(page, /if \(loading\) \{\s*return \(/);
  assert.doesNotMatch(page, /if \(error\) \{\s*return \(/);
  assert.match(page, /Showing the available summary or last cached snapshot/);
});

test("large Admin list APIs use one centrally clamped pagination parser", () => {
  const routes = [
    "audits", "broadcast-audits", "campaigns", "channels", "deposits",
    "miniapp-rewarded-campaigns", "users", "withdrawals",
  ];
  for (const route of routes) {
    const source = read(`src/app/api/admin/${route}/route.ts`);
    assert.match(source, /parseAdminPagination\(searchParams/,
      `${route} must clamp page size server-side`);
  }
  const utility = read("src/lib/adminPagination.ts");
  assert.match(utility, /Math\.min\(requestedLimit, maxLimit\)/);
  assert.match(utility, /maxLimit = options\.maxLimit \?\? 100/);
});

test("Admin list requests cancel superseded fetches", () => {
  const pages = ["audits", "bots", "campaigns", "channels", "deposits", "miniapps", "system-logs", "users", "withdrawals", "miniapp-rewarded"];
  for (const page of pages) {
    assert.match(read(`src/app/admin/${page}/page.tsx`), /useAdminRequestGuard/,
      `${page} must use the shared abort guard`);
  }
  const hook = read("src/hooks/useAdminRequestGuard.ts");
  assert.match(hook, /activeController\.current\?\.abort\(\)/);
  assert.match(hook, /new AbortController\(\)/);
});

test("withdrawal list is bounded and defers expensive safety detail", () => {
  const route = read("src/app/api/admin/withdrawals/route.ts");
  assert.match(route, /preclearance_id/);
  assert.match(route, /referral_reward_ledger[\s\S]*user_id IN \(\?\)[\s\S]*GROUP BY user_id/);
  assert.doesNotMatch(route, /rows\.map\(async \(row\)[\s\S]*assessWithdrawalPreclearance/);
  assert.match(route, /assessWithdrawalPreclearance\(Number\(id\), conn\)/,
    "approval must retain its authoritative locked safety check");
});

test("Admin request handlers perform no runtime schema DDL", () => {
  for (const route of ["users", "withdrawals"]) {
    const source = read(`src/app/api/admin/${route}/route.ts`);
    assert.doesNotMatch(source, /ALTER TABLE|CREATE TABLE|ensureUserBanColumns|ensureWithdrawalActionColumns/);
  }
});

test("Admin user enrichment is batched for only the visible page", () => {
  const route = read("src/app/api/admin/users/route.ts");
  assert.match(route, /const userIds = rows\.map/);
  assert.match(route, /Promise\.all\(\[/);
  assert.match(route, /advertiser_rate_discounts WHERE user_id IN \(\?\)/);
  assert.doesNotMatch(route, /SELECT ard\.cpm_discount[\s\S]*WHERE ard\.user_id=users\.id/);
});

test("Admin campaign metrics are batched after the bounded visible page", () => {
  const route = read("src/app/api/admin/campaigns/route.ts");
  assert.match(route, /const standardIds = rows\.filter/);
  assert.match(route, /broadcast_deliveries WHERE status='sent' AND campaign_id IN \(\?\)/);
  assert.match(route, /campaign_posts WHERE campaign_id IN \(\?\)/);
  assert.match(route, /campaign_clicks WHERE campaign_id IN \(\?\)/);
  assert.doesNotMatch(route, /SELECT COUNT\(\*\) FROM campaigns ch WHERE ch\.user_id = c\.user_id/);
});

test("referral administration keeps all large datasets bounded and parallelizes independent reads", () => {
  const source = read("src/lib/referralSprint.ts");
  const start = source.indexOf("export async function getAdminReferralGrowthData");
  const end = source.indexOf("export async function backfillUserMilestones", start);
  const admin = source.slice(start, end);
  assert.match(admin, /Promise\.all\(\[/);
  for (const limit of ["LIMIT 20", "LIMIT 50", "LIMIT 100"]) assert.match(admin, new RegExp(limit));
});

test("new schema work is additive, ledger-driven, and never executed by this test", () => {
  const migrationName = "20260911_0140_admin_fast_v2_indexes.sql";
  const migration = read(`db/migrations/${migrationName}`);
  assert.match(migration, /ADD (?:COLUMN|KEY) IF NOT EXISTS/);
  assert.doesNotMatch(migration, /UPDATE |DELETE |DROP /);
  assert.match(read("deploy-vps.sh"), new RegExp(migrationName.replaceAll(".", "\\.")));
});

test("Audience Analytics remains immediately before Teaser Analytics in Admin navigation", () => {
  const layout = read("src/components/layout/AdminLayout.tsx");
  const audience = layout.indexOf('href: "/admin/audience-analytics"');
  const teaser = layout.indexOf('href: "/admin/teaser-analytics"');
  assert.ok(audience >= 0 && teaser > audience);
});

test("all discovered Admin routes remain present and reportable", () => {
  const routes = [
    "", "audience-analytics", "audits", "automation", "availability", "bots", "broadcasts",
    "campaigns", "campaigns/[id]", "channels", "deposits", "developer-platform", "enterprise",
    "faqs", "inventory-optimization", "login", "marketplace", "miniapp-rewarded", "miniapps",
    "placement-logic", "production-readiness", "promote-ads-galaxy", "referrals", "revenue-protection",
    "settings", "system-logs", "teaser-analytics", "traffic-quality", "traffic-quality/[type]/[id]",
    "users", "withdrawals",
  ];
  for (const route of routes) {
    assert.ok(existsSync(resolve(root, "src/app/admin", route, "page.tsx")), `missing /admin/${route}`);
  }
});

test("Admin shell navigation is static and does not fetch analytics", () => {
  const layout = read("src/components/layout/AdminLayout.tsx");
  assert.ok(layout.indexOf("const menuSections") < layout.indexOf("export default function AdminLayout"));
  assert.doesNotMatch(layout, /fetch\("\/api\/admin\/(?:dashboard|audience|teaser)/);
  assert.match(layout, /logout/i);
});

test("pre-existing large Admin APIs retain hard maximum limits", () => {
  for (const route of ["bots", "miniapps", "system-logs"]) {
    const source = read(`src/app/api/admin/${route}/route.ts`);
    assert.match(source, /Math\.min\(100/);
  }
});

test("Admin search debounce, cancellation, and page reset remain coupled", () => {
  for (const page of ["users", "channels", "campaigns", "bots", "miniapps", "deposits", "withdrawals"]) {
    const source = read(`src/app/admin/${page}/page.tsx`);
    assert.match(source, /setTimeout/);
    assert.match(source, /setPage\(1\)/);
    assert.match(source, /signal: controller\.signal/);
  }
});

test("Admin list queries use parameter binding and stable descending identifiers", () => {
  for (const route of ["users", "channels", "campaigns", "deposits", "withdrawals", "audits", "broadcast-audits"]) {
    const source = read(`src/app/api/admin/${route}/route.ts`);
    assert.match(source, /LIMIT \?/);
    assert.match(source, /ORDER BY [^\n]+ DESC/i);
  }
});

test("Audience Analytics remains separate and preserves Today, 7-day, and 30-day conditional aggregation", () => {
  assert.ok(existsSync(resolve(root, "src/app/admin/audience-analytics/page.tsx")));
  const api = read("src/app/api/admin/audience-analytics/route.ts");
  assert.match(api, /stat_date = CURDATE\(\)/);
  assert.match(api, /INTERVAL 6 DAY/);
  assert.match(api, /INTERVAL 29 DAY/);
  assert.match(api, /SUM\(CASE WHEN/);
});

test("Teaser Analytics remains a separate bounded aggregate page", () => {
  assert.ok(existsSync(resolve(root, "src/app/admin/teaser-analytics/page.tsx")));
  const api = read("src/app/api/admin/teaser-analytics/route.ts");
  assert.match(api, /Promise\.all/);
  assert.match(api, /LIMIT (?:10|20|\?)/);
  assert.match(api, /today|7d|30d/i);
});

test("all optimized Admin APIs retain Admin authentication", () => {
  for (const route of ["audits", "broadcast-audits", "campaigns", "channels", "dashboard", "deposits", "miniapp-rewarded-campaigns", "users", "withdrawals"]) {
    const source = read(`src/app/api/admin/${route}/route.ts`);
    assert.match(source, /checkAdminAuth|requireAdminPermission|getAuthenticatedAdmin/);
  }
});

test("financial mutations remain uncached and transaction guarded", () => {
  const withdrawals = read("src/app/api/admin/withdrawals/route.ts");
  assert.doesNotMatch(withdrawals, /cacheGetOrSet|cacheSet/);
  assert.match(withdrawals, /beginTransaction\(\)/);
  assert.match(withdrawals, /FOR UPDATE/);
  assert.match(withdrawals, /affectedRows !== 1/);
});

test("optional Redis remains fail-open with bounded command timing", () => {
  const redis = read("src/lib/redis.ts");
  assert.match(redis, /if \(!isRedisEnabled\(\)\) return null/);
  assert.match(redis, /Promise\.race/);
  assert.match(redis, /return null/);
});

test("settings mutations invalidate Admin summary caches", () => {
  const settings = read("src/app/api/admin/settings/route.ts");
  assert.match(settings, /invalidateSettingsCaches/);
  const cache = read("src/lib/redisCache.ts");
  assert.match(cache, /redisKeys\.adminDashboard\(\)/);
});

test("dashboard aggregates counts and avoids loading arbitrary row payloads", () => {
  const route = read("src/app/api/admin/dashboard/route.ts");
  assert.match(route, /COUNT\(\*\)|SUM\(/);
  assert.doesNotMatch(route, /SELECT \* FROM/);
  assert.match(route, /LIMIT 5/);
});

test("admin reload bypasses browser, process, and Redis dashboard caches", () => {
  const page = read("src/app/admin/page.tsx");
  const dashboard = read("src/app/api/admin/dashboard/route.ts");
  const summary = read("src/app/api/admin/dashboard/summary/route.ts");

  assert.match(page, /dashboard\/summary\?fresh=1[\s\S]*cache: "no-store"/);
  assert.match(page, /dashboard\?fresh=1[\s\S]*cache: "no-store"/);
  assert.match(page, /users: \{ \.\.\.current\.users, \.\.\.data\.users \}/);
  assert.match(dashboard, /!forceFresh && dashboardCache/);
  assert.match(dashboard, /\{ bypass: forceFresh \}/);
  assert.match(summary, /\{ bypass: forceFresh \}/);
  for (const route of [dashboard, summary]) {
    assert.match(route, /private, no-store, max-age=0/);
    assert.match(route, /X-AdsGalaxy-Cache": "REFRESH"/);
  }
});

test("Admin actions retain local duplicate-submit guards", () => {
  for (const page of ["campaigns", "channels", "bots", "miniapps", "withdrawals"]) {
    const source = read(`src/app/admin/${page}/page.tsx`);
    assert.match(source, /actionLoading/);
    assert.match(source, /disabled=/);
  }
});

test("Teaser Emergency Push remains a durable job rather than synchronous fan-out", () => {
  const route = read("src/app/api/admin/teaser/emergency-push/route.ts");
  assert.match(route, /teaser_emergency_jobs/);
  assert.match(route, /'queued'/);
  assert.doesNotMatch(route, /for \([^)]*channel[^)]*\)[\s\S]*sendTelegram/);
});

test("direct-debit, Publisher locked earnings, and Channel Growth authorities remain present", () => {
  assert.ok(existsSync(resolve(root, "src/lib/advertiserDirectDebit.ts")));
  const directDebit = read("src/lib/advertiserDirectDebit.ts");
  assert.match(directDebit, /conn: PoolConnection/);
  assert.match(directDebit, /INSERT IGNORE INTO advertiser_direct_debits/);
  assert.match(directDebit, /ad_balance=ad_balance-\?[^\n]+ad_balance>=\?/);
  assert.match(read("src/app/api/publisher/withdrawals/route.ts"), /balance_locked/);
  assert.ok(existsSync(resolve(root, "src/lib/channelGrowth.ts")));
  assert.ok(existsSync(resolve(root, "src/app/api/admin/settings/route.ts")));
});

test("list endpoints avoid shipping full detail histories for each row", () => {
  const withdrawals = read("src/app/api/admin/withdrawals/route.ts");
  const users = read("src/app/api/admin/users/route.ts");
  assert.doesNotMatch(withdrawals, /rows\.map\(async/);
  assert.doesNotMatch(users, /rows\.map\(async/);
  assert.match(withdrawals, /preclearance_id/);
  assert.match(read("src/app/api/admin/audits/route.ts"), /campaign_views_audit[\s\S]*LIMIT 500/);
});
