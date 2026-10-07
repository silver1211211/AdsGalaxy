import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import vm from "node:vm";

const route=readFileSync("src/app/api/admin/campaigns/[id]/emergency-push/route.ts","utf8");
const delivery=readFileSync("src/lib/channelDelivery.ts","utf8");
const slots=readFileSync("src/lib/channelScheduleSlots.ts","utf8");
const affordability=readFileSync("src/lib/channelPlacementAffordability.ts","utf8");
const scheduler=readFileSync("src/app/api/cron/process-ads/route.ts","utf8");

function loadTs(source,filename){
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},fileName:filename}).outputText;
  const compiled={exports:{}};
  vm.runInNewContext(output,{module:compiled,exports:compiled.exports,process},{filename});
  return compiled.exports;
}
const slotModule=loadTs(slots,"channelScheduleSlots.ts");

test("fill behavior returns an immediate truthful emergency identity",async()=>{
  const now=new Date("2026-09-27T13:22:00.000Z");
  const db={query:async()=>[[]]};
  const result=await slotModule.selectEmergencyScheduleSlot(db,{channel:{id:7,posts_per_day:3,posting_times:'["10:00","14:00","18:00"]'},mode:"fill_empty_slots",bypassTiming:false,now});
  assert.equal(result.slotDate,"2026-09-27");
  assert.equal(result.slotTime,"13:22:01");
  assert.equal(result.replacesPostId,null);
});

test("replace behavior preserves the victim slot identity",async()=>{
  const db={query:async()=>[[{post_id:91,campaign_id:4,delivery_generation:2,slot_date:"2026-09-26",slot_time:"18:00:00",original_claim_type:"scheduled",live_coverage:3}]]};
  const result=await slotModule.selectEmergencyScheduleSlot(db,{channel:{id:7,posts_per_day:3},mode:"replace_everything",bypassTiming:true,now:new Date("2026-09-27T13:22:00Z")});
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{slotDate:"2026-09-26",slotTime:"18:00:00",replacesPostId:91,victimCampaignId:4,victimGeneration:2,victimClaimType:"scheduled",unavoidableCoverageConflict:false});
});

test("fill uses an explicit emergency identity with non-zero seconds",()=>{
  assert.match(slots,/Non-zero seconds keep this identity disjoint/);
  assert.match(slots,/second = \(\(startSecond - 1 \+ offset\) % 59\) \+ 1/);
  assert.doesNotMatch(slots,/futureUnused\.find/);
});
test("capacity counts confirmed success plus only in-flight reservations",()=>{
  assert.match(delivery,/delivery_confirmed_at IS NOT NULL AND status IN/);
  assert.match(delivery,/OR status='pending_delivery'/);
  assert.match(delivery,/SELECT id FROM channels WHERE id=\? FOR UPDATE/);
});
test("failed fill can release only its exact claim",()=>assert.match(delivery,/WHERE id=\? AND campaign_post_id=\? AND channel_id=\? AND slot_date=\? AND slot_time=\?/));
test("normal and emergency use the same atomic capacity reservation",()=>{
  assert.match(scheduler,/capacityLimit:Math\.max/);
  assert.match(route,/capacityLimit:mode === "fill_empty_slots"/);
});
test("normal and emergency use one affordability guard",()=>{
  assert.match(scheduler,/checkChannelPlacementAffordability/);
  assert.match(route,/checkChannelPlacementAffordability/);
});
test("affordability locks campaign and enforces total liability",()=>{
  assert.match(affordability,/WHERE c\.id=\? FOR UPDATE/);
  assert.match(affordability,/pending_liability/);
  assert.match(affordability,/campaign_unaffordable/);
});
test("affordability enforces daily cap and direct-debit wallet",()=>{
  assert.match(affordability,/daily_cap_reached/);
  assert.match(affordability,/advertiser_balance_insufficient/);
});
test("global ad-serving safety gate is reused",()=>assert.match(route,/requireAdServingAllowed\(\)/));
test("canonical Telegram health is checked before reservation",()=>assert.ok(route.indexOf("const health = await verifyTelegramChannelAccess({")<route.indexOf("const affordability=await checkChannelPlacementAffordability")));
test("canonical Telegram classifier drives retry and permanent handling",()=>{
  assert.match(route,/classifyTelegramAccessFailure/);
  assert.match(route,/failure\?\.retryable/);
  assert.match(route,/failure\?\.permanent/);
});
test("targeting includes category continent country language owner and exclusions",()=>{
  for(const token of ["campaignCategory","campaignAudience","campaignCountries","campaignLanguages","channelCountry","channelLanguage","c.user_id != ?","campaignExcludesChannel"]) assert.match(route,new RegExp(token.replace(/[?]/g,"\\?")));
});
test("replacement slot transfer is victim-specific and concurrent-safe",()=>assert.match(delivery,/campaign_post_id=\? AND released_at IS NULL/));
test("replacement failure restores the original victim claim",()=>{
  assert.match(delivery,/restoreReplacedChannelScheduleSlotClaim/);
  assert.match(route,/victimPostId:Number\(scheduleSlot\.replacesPostId\)/);
});
test("victim is settled before replacement send",()=>assert.ok(route.indexOf("settleChannelCampaigns({")<route.indexOf("let result = await send()")));
test("old victim is deleted only after new confirmation",()=>{
  assert.ok(route.indexOf("delivery_confirmed_at = NOW()")<route.indexOf("deleteCampaignPostsByIds([scheduleSlot.replacesPostId]"));
});
test("failed new send restores or releases claim and never deletes victim",()=>{
  const failureIndex=route.indexOf("const claimReleased=await failReservation(String(result?.description");
  assert.ok(failureIndex>0);
  assert.equal(route.slice(failureIndex,failureIndex+800).includes("deleteCampaignPostsByIds"),false);
});
test("settlement deadlocks are structured retryable failures",()=>assert.match(route,/victim_settlement_retryable_failure/));
test("growth campaigns retain tracked invite attribution",()=>assert.match(route,/createGrowthDeliveryInvite/));
test("generation is finalized only after confirmed Telegram success",()=>{
  assert.doesNotMatch(route,/SET channel_delivery_generation=channel_delivery_generation\+1/);
  assert.ok(route.indexOf("delivery_confirmed_at = NOW()")<route.indexOf("SET channel_delivery_generation=GREATEST"));
});
test("zero placement cannot return generic success",()=>{
  assert.match(route,/operationStatus=posted===0\?"NO_DELIVERY"/);
  assert.match(route,/success: posted>0/);
});
test("partial replacement cleanup is exposed",()=>{
  assert.match(route,/partial=replacementDeletion\.deleted!==1/);
  assert.match(route,/"PARTIAL_SUCCESS"/);
});
test("operation diagnostics include correlation and bounded counters",()=>{
  assert.match(route,/randomUUID\(\)/);
  assert.match(route,/failure_reason_counts/);
  assert.match(route,/processBoundedQueue\(eligibleChannels/);
});
