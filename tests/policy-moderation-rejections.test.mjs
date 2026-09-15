import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const registry = read("src/lib/policyRegistry.ts");
const policyPage = read("src/app/policy/[[...slug]]/page.tsx");
const policyUi = read("src/components/policy/PolicyCenter.tsx");
const policyLayout = read("src/app/policy/layout.tsx");
const policyNav = read("src/components/policy/PolicyNav.tsx");
const policyMobileMenu = read("src/components/policy/PolicyMobileMenu.tsx");
const service = read("src/lib/moderationRejections.ts");
const adminRoute = read("src/app/api/admin/moderation-rejections/route.ts");
const ownerRoute = read("src/app/api/moderation-rejections/route.ts");
const migration = read("db/migrations/20260911_0141_policy_moderation_rejections.sql");
const deploy = read("deploy-vps.sh");
const campaignAdmin = read("src/app/admin/campaigns/page.tsx");
const rewardedAdmin = read("src/app/admin/miniapp-rewarded/page.tsx");
const apiErrors = read("src/lib/apiErrorMessage.ts");
const activeRegistry = registry.slice(registry.indexOf("export const POLICY_DEFINITIONS"), registry.indexOf("const HISTORICAL_RULE_ROWS"));

const routes = ["/policy", "/policy/publisher", "/policy/publisher/channel", "/policy/publisher/bot", "/policy/publisher/mini-app", "/policy/advertiser", "/policy/advertiser/channel", "/policy/advertiser/channel-growth", "/policy/advertiser/teaser", "/policy/advertiser/mini-app", "/policy/advertiser/bot"];
for (const route of routes) test(`public policy route is registered: ${route}`, () => assert.match(route === "/policy" ? policyPage : registry, new RegExp(route.replaceAll("/", "\\/"))));

const rules = [
  "publisher.general.general-review","publisher.channel.general-review","publisher.channel.verification-issue","publisher.channel.fraud","publisher.channel.restricted-content","publisher.channel.inactive-channel","publisher.channel.inaccessible","publisher.channel.missing-permissions","publisher.channel.artificial-engagement","publisher.channel.content-quality","publisher.channel.low-subscribers",
  "publisher.bot.general-review","publisher.bot.non-functional","publisher.bot.fraud","publisher.bot.restricted-content","publisher.bot.invalid-integration","publisher.bot.spam","publisher.bot.misleading-rewards","publisher.bot.unsafe-redirect","publisher.bot.placement-issue",
  "publisher.mini-app.general-review","publisher.mini-app.non-functional","publisher.mini-app.fraud","publisher.mini-app.restricted-content","publisher.mini-app.placement-issue","publisher.mini-app.forced-interaction","publisher.mini-app.misleading-rewards","publisher.mini-app.invalid-integration","publisher.mini-app.unsafe-redirect",
  "advertiser.general.general-review","advertiser.general.restricted-content","advertiser.general.fraud","advertiser.general.unsafe-link","advertiser.general.content-mismatch","advertiser.general.broken-destination","advertiser.general.unrealistic-claims","advertiser.general.rights-violation","advertiser.general.spam-clickbait","advertiser.general.questionable-activity","advertiser.general.unsafe-content","advertiser.general.harmful-software","advertiser.general.regulated-goods","advertiser.general.format-violation","advertiser.general.low-quality-destination","advertiser.general.circumvention",
  "advertiser.channel.general-review","advertiser.channel.invalid-destination","advertiser.channel.invalid-creative","advertiser.channel.invalid-pricing","advertiser.channel.invalid-targeting",
  "advertiser.channel-growth.general-review","advertiser.channel-growth.invalid-channel","advertiser.channel-growth.bot-permission","advertiser.channel-growth.invalid-cps","advertiser.channel-growth.unsupported-destination","advertiser.channel-growth.growth-format",
  "advertiser.teaser.general-review","advertiser.teaser.invalid-copy","advertiser.teaser.invalid-cta","advertiser.teaser.invalid-cpm","advertiser.teaser.invalid-format","advertiser.teaser.invalid-destination",
  "advertiser.mini-app.general-review","advertiser.mini-app.invalid-creative","advertiser.mini-app.invalid-destination","advertiser.mini-app.unsupported-format","advertiser.mini-app.invalid-pricing",
  "advertiser.bot.general-review","advertiser.bot.invalid-creative","advertiser.bot.invalid-destination","advertiser.bot.unsupported-format","advertiser.bot.invalid-pricing",
];
for (const key of rules) test(`stable policy key exists: ${key}`, () => assert.ok(registry.includes(`"${key.split(".").slice(-1)[0]}"`) && registry.includes(key.split(".").slice(0, -1).join("."))));

test("policy pages do not require Telegram authentication", () => { assert.doesNotMatch(policyPage + policyUi, /getAuthenticatedUser|initData|x-telegram-init-data/); });
test("policy reuses the Docs layout structure", () => {
  assert.match(policyLayout, /lg:grid-cols-\[260px_minmax\(0,1fr\)\]/);
  assert.match(policyLayout, /max-h-\[calc\(100dvh-7rem\)\].*overflow-y-auto/);
  assert.match(policyLayout, /PolicyMobileMenu/);
  assert.match(policyUi, /rounded-3xl border border-slate-200 bg-white/);
});
test("policy mobile navigation is overlayed, scrollable, and closes on navigation", () => {
  assert.match(policyMobileMenu, /fixed inset-0 z-50 lg:hidden/);
  assert.match(policyMobileMenu, /overflow-y-auto/);
  assert.match(policyMobileMenu, /onNavigate=\{\(\) => setOpen\(false\)\}/);
  assert.match(policyMobileMenu, /document\.body\.style\.overflow = "hidden"/);
});
test("policy navigation exposes every public policy route with active state", () => {
  for (const route of routes.slice(1)) assert.match(policyNav, new RegExp(route.replaceAll("/", "\\/")));
  assert.match(policyNav, /aria-current=\{active \? "page"/);
});
test("policy metadata includes canonical title and description", () => { assert.match(policyPage, /generateMetadata/); assert.match(policyPage, /alternates: \{ canonical/); });
test("deep-link anchors are stable and highlighted", () => { assert.match(policyUi, /id=\{`rule-\$\{rule\.public_number\}`\}/); assert.match(policyUi, /target:bg-sky-50/); });
test("policy rules render as one continuous numbered write-up", () => {
  assert.match(policyUi, /\{rule\.public_number\}\. \{rule\.public_title\}/);
  assert.doesNotMatch(policyUi, /Rule \{rule\.public_number\}|What it means|How to resolve it|Version \{POLICY_VERSION\}/);
});
test("active policy has exactly one shared Rule 0 per audience", () => {
  assert.equal((activeRegistry.match(/\[0, "general-review", "General Review"/g) || []).length, 2);
});
test("publisher channel active reasons match the simplified contract", () => {
  for (const label of ["Verification Issue", "Fraud / Artificial Engagement", "Restricted Content", "Inaccessible Channel", "Missing Permissions", "Poor Content Quality"]) assert.match(activeRegistry, new RegExp(label.replace("/", "\\/")));
  assert.match(activeRegistry, /\[2, "fraud-artificial-engagement", "Fraud \/ Artificial Engagement"/);
  assert.doesNotMatch(activeRegistry, /Low Subscribers|Inactive Channel|\[7, "artificial-engagement"|\[8, "content-quality"/);
});
test("advertiser active reasons use the requested consolidated labels", () => {
  for (const label of ["Invalid Destination", "Misleading Claims", "Spam / Clickbait", "Creative / Format Issue", "Invalid Channel", "Misleading Promotion", "Campaign Quality Issue", "Misleading Copy", "Teaser Format Issue", "Unsafe Redirect", "Spam / Format Issue"]) assert.match(activeRegistry, new RegExp(label.replace("/", "\\/")));
  assert.doesNotMatch(activeRegistry, /Invalid CPM|Invalid Pricing|Invalid Targeting|Unsupported Format/);
});
test("retired reasons remain lookup-compatible but outside active definitions", () => {
  assert.match(registry, /HISTORICAL_RULE_ROWS/);
  assert.match(registry, /"low-subscribers","Low Subscribers"/);
  assert.match(registry, /status: "retired"/);
  assert.match(registry, /new Map\(\[\.\.\.RETIRED_POLICY_RULES, \.\.\.POLICY_DEFINITIONS/);
});
test("subscriber minimum has one shared authority", () => { assert.match(registry, /MINIMUM_PUBLISHER_CHANNEL_SUBSCRIBERS = 100/); assert.match(read("src/app/api/publisher/channels/route.ts"), /MINIMUM_PUBLISHER_CHANNEL_SUBSCRIBERS/); });
test("public policy pages prepend the shared Rule 0 and show active rules only", () => {
  assert.match(policyUi, /policyRulesForScope\(policy\.scope\)/);
  assert.match(registry, /scope\.startsWith\("publisher\."\) \? "publisher\.general" : "advertiser\.general"/);
});
test("structured rejection requires a rule", () => assert.match(service, /MODERATION_REASON_REQUIRED/));
test("invalid rules fail safely", () => assert.match(service, /MODERATION_REASON_INVALID/));
test("wrong scopes fail safely", () => assert.match(service, /MODERATION_REASON_WRONG_SCOPE/));
test("campaign scopes cover every advertiser campaign format", () => {
  assert.match(registry, /kind === "channel_growth".*advertiser\.channel-growth/);
  assert.match(registry, /type === "broadcast".*advertiser\.bot/);
  assert.match(registry, /teaserMode === "teaser_only".*advertiser\.teaser/);
  assert.match(registry, /teaserMode === "standard_plus_teaser"/);
  assert.match(registry, /advertiser\.channel", "advertiser\.teaser/);
  assert.match(registry, /entityType === "miniapp_rewarded_campaign".*advertiser\.mini-app/);
});
test("campaign rejection locks every field required for policy scope classification", () => assert.match(service, /e\.campaign_kind,e\.type,e\.teaser_mode,e\.teaser_enabled/));
test("Admin campaign rows preserve source kind and Teaser identity", () => {
  const route = read("src/app/api/admin/campaigns/route.ts");
  assert.match(route, /c\.campaign_kind AS source_campaign_kind/);
  assert.match(route, /c\.teaser_mode/);
  assert.match(campaignAdmin, /campaignPolicyScopes\(row \|\| \{\}\)/);
});
test("publisher entity scopes remain format specific", () => {
  assert.match(registry, /entityType === "channel".*publisher\.general", "publisher\.channel/);
  assert.match(registry, /entityType === "bot".*publisher\.general", "publisher\.bot/);
  assert.match(registry, /entityType === "miniapp".*publisher\.general", "publisher\.mini-app/);
});
test("entities are locked before rejection", () => assert.match(service, /FOR UPDATE/));
test("entity update and ledger insertion share a transaction", () => { assert.match(service, /beginTransaction/); assert.match(service, /INSERT INTO moderation_rejections/); assert.match(service, /commit/); });
test("rejected entities cannot be rejected twice", () => assert.match(service, /"deleted", "completed", "rejected"/));
test("public rule number is not authority", () => { assert.match(service, /getPolicyRule\(ruleKey\)/); assert.match(service, /publicRuleNumber.*rule\.public_number/); });
test("internal notes are capped", () => assert.match(service, /note\.length > 300/));
test("owner endpoint validates ownership", () => assert.match(ownerRoute, /AND \$\{cfg\.owner\}=\?/));
test("owner endpoint returns only latest current rejection", () => { assert.match(service, /currentStatus.*rejected/); assert.match(service, /LIMIT 1/); });
test("historical owner rejection preserves its stored number and avoids stale anchors", () => {
  assert.match(service, /public_rule_number: row\.public_rule_number/);
  assert.match(service, /rule\.status === "active" && rule\.public_number === row\.public_rule_number/);
  assert.match(service, /: rule\.policy_path/);
});
test("internal notes are absent from owner presentation", () => assert.doesNotMatch(service.match(/return \{ public_rule_number:[^\n]+/s)?.[0] || "", /internal_note/));
test("admin history is bounded", () => assert.match(service, /Math\.min\(50/));
test("history is newest first", () => assert.match(service, /ORDER BY rejected_at DESC,id DESC/));
test("Telegram notification uses canonical hidden policy link", () => { assert.match(service, /<a href=/); assert.match(service, /publicPolicyUrl\(rule\)/); });
test("server returns stable structured errors", () => assert.match(adminRoute, /code: error\.code/));
test("campaign rejection uses the moderation endpoint with POST", () => assert.match(campaignAdmin, /method: action === "reject" \? "POST" : "PATCH"/));
test("rewarded campaign rejection uses the moderation endpoint with POST", () => assert.match(rewardedAdmin, /method: action === "reject" \? "POST" : "PATCH"/));
test("moderation endpoint accepts stale PATCH clients safely", () => assert.match(adminRoute, /export async function PATCH\(request: Request\).*return POST\(request\)/s));
test("moderation failures have safe actionable Admin messages", () => {
  for (const code of ["MODERATION_REASON_REQUIRED", "MODERATION_REASON_INVALID", "MODERATION_REASON_WRONG_SCOPE", "ENTITY_NOT_REJECTABLE", "ENTITY_NOT_FOUND", "FORBIDDEN"]) assert.match(apiErrors, new RegExp(code));
});
test("migration is additive and does not backfill legacy data", () => { assert.match(migration, /CREATE TABLE IF NOT EXISTS/); assert.doesNotMatch(migration, /UPDATE |DELETE FROM|INSERT INTO/); });
test("migration indexes entity owner scope time and admin", () => { for (const index of ["idx_moderation_entity","idx_moderation_owner","idx_moderation_scope","idx_moderation_admin","idx_moderation_rejected_at"]) assert.match(migration, new RegExp(index)); });
test("deployment runner includes 0141 after 0140", () => assert.ok(deploy.indexOf("20260911_0141_policy_moderation_rejections.sql") > deploy.indexOf("20260911_0140_admin_fast_v2_indexes.sql")));
test("admin dropdown is a flat active list from the authoritative registry", () => {
  const fields = read("src/components/admin/ModerationRejectFields.tsx");
  assert.match(fields, /activePolicyRulesForScopes\(scopes\)/);
  assert.match(fields, /rule\.admin_label/);
  assert.doesNotMatch(fields, /optgroup|POLICY_DEFINITIONS\.find/);
});
test("legacy records have a safe owner message", () => assert.match(read("src/components/shared/ModerationRejectionNotice.tsx"), /Rejected under previous moderation system/));
test("approved items hide obsolete warnings", () => assert.match(read("src/components/shared/ModerationRejectionNotice.tsx"), /!== "rejected"\) return null/));
test("English and Russian rejection UI are catalogued", () => { assert.match(read("src/i18n/en.ts"), /moderation\.reason/); assert.match(read("src/i18n/ru.ts"), /Причина отклонения/); });
test("no arbitrary fraud thresholds were added", () => assert.doesNotMatch(registry, /fraud score|fraud threshold/i));
test("legacy bulk rejection cannot bypass structured reasons", () => { assert.doesNotMatch(read("src/app/admin/automation/page.tsx"), /option value="reject">Reject Many/); assert.match(read("src/app/api/admin/automation/route.ts"), /MODERATION_REASON_REQUIRED/); });
