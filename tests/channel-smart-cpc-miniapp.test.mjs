import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const wizard=fs.readFileSync('src/app/advertiser/campaigns/new/[kind]/page.tsx','utf8');
const stats=fs.readFileSync('src/components/advertiser/CampaignStatisticsPanel.tsx','utf8');
const statsApi=fs.readFileSync('src/app/api/advertiser/campaigns/[id]/statistics/route.ts','utf8');

test('Smart CPC is the default only for eligible new campaign forms when enabled',()=>{
  assert.match(wizard,/smartReachAvailable && !isBotCampaign && !isGrowthCampaign \? "smart_reach" : "standard_cpc"/);
  assert.match(wizard,/setBillingMode\(data\.financial_billing_mode === "smart_reach"/);
  assert.match(wizard,/!isEditMode && smartReachAvailable && !isBotCampaign && !isGrowthCampaign && formData\.type==="clicks"/);
});

test('recommended maximum and actual starting CPM remain distinct in the CPC price step',()=>{
  assert.match(wizard,/useState\("0\.20"\)/);
  assert.match(wizard,/Smart CPC \(Recommended\)/);
  assert.match(wizard,/value==="0\.20"\?" — Recommended"/);
  assert.match(wizard,/Active CPM starts at <strong>\$0\.10<\/strong>/);
  assert.match(wizard,/Impression charges are up to the active CPM/);
  assert.ok(wizard.indexOf('Channel CPC billing mode')<wizard.indexOf('CPM Slider card'));
});

test('campaign statistics distinguish settled click and impression spend',()=>{
  assert.match(statsApi,/channel_unified_settlement_events/);
  assert.match(statsApi,/channel_smart_reach_impression_billings/);
  assert.match(stats,/label="Click spend"/);
  assert.match(stats,/label="Impression spend"/);
});
