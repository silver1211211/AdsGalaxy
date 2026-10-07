import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read=(path)=>fs.readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const moderation=read("src/lib/campaignModeration.ts");
const campaignEdit=read("src/app/api/advertiser/campaigns/[id]/route.ts");
const miniappEdit=read("src/app/api/advertiser/miniapp-rewarded-campaigns/[id]/route.ts");
const campaignCreate=read("src/app/api/advertiser/campaigns/route.ts");
const miniappCreate=read("src/app/api/advertiser/miniapp-rewarded-campaigns/route.ts");
const idempotency=read("src/lib/campaignCreateIdempotency.ts");
const referralSecurity=read("src/lib/referralSecurity.ts");
const referralSprint=read("src/lib/referralSprint.ts");
const channelCreate=read("src/app/api/publisher/channels/route.ts");
const migration=read("db/migrations/20260928_0153_campaign_referral_channel_integrity.sql");

test("canonical moderation fingerprint contains only user-visible sensitive creative fields",()=>{
  for(const field of ["destination_url","cta","title","text","image","variants"]){
    assert.match(moderation,new RegExp(field));
  }
  for(const economic of ["budget","cpm","cpc","category","countries","schedule"]){
    assert.doesNotMatch(moderation,new RegExp(`\\b${economic}\\b`));
  }
  assert.match(moderation,/kind === "teaser"[\s\S]*base\.variants/);
  assert.match(moderation,/else \{[\s\S]*base\.image/);
});

test("channel bot growth and Teaser edits use exact canonical remoderation and preserve omitted data",()=>{
  assert.match(campaignEdit,/didSensitiveCampaignContentChange/);
  assert.match(campaignEdit,/body\.continents === undefined/);
  assert.match(campaignEdit,/body\.teaser_variants===undefined\?previousTeaserVariants/);
  assert.match(campaignEdit,/baseSensitiveChanged\|\|teaserSensitiveChanged/);
  assert.match(campaignEdit,/body\.excluded_inventory!==undefined/);
  assert.match(campaignEdit,/updates\.push\("status = 'pending'"/);
});

test("Mini App title description CTA URL and images all trigger remoderation",()=>{
  assert.match(miniappEdit,/didSensitiveCampaignContentChange\("miniapp"/);
  for(const field of ["landing_url","cta_text","image_url","logo_url","title","description"]){
    assert.match(miniappEdit,new RegExp(field));
  }
  assert.match(miniappEdit,/creative_review_status = "pending"/);
  assert.match(miniappEdit,/requires_re_moderation = 1/);
});

test("campaign creation requires stable idempotency keys and completes with campaign transaction",()=>{
  assert.match(campaignCreate,/request\.headers\.get\("idempotency-key"\)/);
  assert.match(campaignCreate,/reserveCampaignCreate/);
  assert.match(campaignCreate,/completeCampaignCreate\(conn/);
  assert.match(miniappCreate,/request\.headers\.get\("idempotency-key"\)/);
  assert.match(miniappCreate,/completeCampaignCreate\(conn/);
  assert.match(migration,/UNIQUE KEY uq_campaign_create_request/);
});

test("idempotency supports exact replay conflict concurrent in-progress and stale crash recovery",()=>{
  assert.match(idempotency,/row\.request_fingerprint !== input\.fingerprint/);
  assert.match(idempotency,/outcome: "replay"/);
  assert.match(idempotency,/outcome: "in_progress"/);
  assert.match(idempotency,/FOR UPDATE/);
  assert.match(idempotency,/INTERVAL 10 MINUTE/);
  assert.match(idempotency,/state='failed'/);
});

test("referral request paths contain no runtime DDL",()=>{
  for(const source of [referralSecurity,referralSprint]){
    assert.doesNotMatch(source,/ALTER\s+TABLE/i);
    assert.doesNotMatch(source,/CREATE\s+TABLE/i);
    assert.doesNotMatch(source,/ADD\s+COLUMN/i);
  }
  assert.match(migration,/ALTER TABLE users/);
  assert.match(migration,/ALTER TABLE referrals/);
});

test("single IP UA or device match is evidence only and corroboration is required to block",()=>{
  assert.match(referralSecurity,/deviceHash: hash\(deviceId\)/);
  assert.doesNotMatch(referralSecurity,/deviceId \|\| userAgent/);
  assert.match(referralSecurity,/matchedSignals===1/);
  assert.match(referralSecurity,/blocked:false,reason:"weak_signal_recorded"/);
  assert.match(referralSecurity,/multiple corroborating identity signals matched/);
});

test("numeric Telegram identity claim is atomic and uniqueness-backed",()=>{
  assert.match(channelCreate,/writeConn\.beginTransaction\(\)/);
  assert.match(channelCreate,/INSERT INTO channel_telegram_identities/);
  assert.match(channelCreate,/writeConn\.commit\(\)/);
  assert.match(channelCreate,/ER_DUP_ENTRY/);
  assert.match(channelCreate,/CHANNEL_ALREADY_EXISTS/);
  assert.match(migration,/campaign_create_requests/);
});

test("Teaser explicitly remains image-free in moderation",()=>{
  const teaserBranch=moderation.slice(moderation.indexOf('if (kind === "teaser")'),moderation.indexOf("} else {"));
  assert.match(teaserBranch,/base\.variants/);
  assert.doesNotMatch(teaserBranch,/base\.image/);
});
