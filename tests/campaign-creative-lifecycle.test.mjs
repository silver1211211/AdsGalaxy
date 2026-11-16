import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {isBillablePublishedPlacement,captureCampaignCreative,parseCampaignCreative} from '../src/lib/campaignCreativeRevision.ts';
const base = {campaignStatus:'active',pauseReason:null,priorStatus:null,
  approvedRevisionId:1,pendingRevisionId:null,placementStatus:'active',deliveryConfirmed:true,deleted:false};
const allowed = patch => isBillablePublishedPlacement({...base,...patch});

test('approved active placement bills and an unconfirmed or deleted placement never bills',()=>{
  assert.equal(allowed({}),true);
  assert.equal(allowed({deliveryConfirmed:false}),false);
  assert.equal(allowed({deleted:true}),false);
  assert.equal(allowed({placementStatus:'deleted'}),false);
});
test('pending edited campaign keeps only old approved published placements billable',()=>{
  const pending={campaignStatus:'pending',priorStatus:'active',pendingRevisionId:2};
  assert.equal(allowed(pending),true);
  assert.equal(allowed({...pending,approvedRevisionId:null}),false);
  assert.equal(allowed({...pending,priorStatus:'paused'}),false);
  assert.equal(allowed({...pending,placementStatus:'pending_delivery'}),false);
});
test('rejected edit bills each physically live cleanup placement until deletion',()=>{
  const rejected={campaignStatus:'paused',pauseReason:'moderation_cleanup'};
  for(const status of ['active','cleanup_pending','delete_failed']) assert.equal(allowed({...rejected,placementStatus:status}),true);
  assert.equal(allowed({...rejected,placementStatus:'deleted'}),false);
  assert.equal(allowed({...rejected,placementStatus:'cleanup_pending',deleted:true}),false);
  assert.equal(allowed({...rejected,approvedRevisionId:null}),false);
});
test('ordinary advertiser and security pauses do not acquire moderation billing rights',()=>{
  assert.equal(allowed({campaignStatus:'paused',pauseReason:'user_paused'}),false);
  assert.equal(allowed({campaignStatus:'paused',pauseReason:'fraud'}),false);
  assert.equal(allowed({campaignStatus:'rejected',pauseReason:null}),false);
});
test('creative snapshot preserves URL and visible content exactly',()=>{
  const approved=captureCampaignCreative({campaign_title:'Approved',message_text:'Old body',image_url:'https://old/image.png',link:'https://old.example/x',button_text:'Open',teaser_mode:'none'});
  const staged=captureCampaignCreative({...approved,link:'https://new.example/x',message_text:'New body'});
  assert.equal(parseCampaignCreative(JSON.stringify(approved)).link,'https://old.example/x');
  assert.equal(staged.link,'https://new.example/x');
  assert.equal(approved.message_text,'Old body');
});
test('redirects never fall back to the current campaign URL after versioning',()=>{
  const channel=readFileSync('src/app/api/clicks/[id]/[postId]/route.ts','utf8');
  const teaser=readFileSync('src/app/api/teaser/click/[token]/route.ts','utf8');
  assert.match(channel,/approved_destination_url/);
  assert.match(channel,/!campaignPost\.approved_creative_revision_id/);
  assert.match(channel,/cp\.deleted_at IS NULL/);
  assert.match(teaser,/tp\.approved_destination_url/);
  assert.match(teaser,/c\.approved_creative_revision_id IS NULL/);
  assert.match(teaser,/tp\.removed_at IS NULL/);
});
test('first edit freezes the last approved legacy destination before replacing creative',()=>{
  const source=readFileSync('src/lib/campaignCreativeRevision.ts','utf8');
  const first=source.indexOf('UPDATE campaign_posts SET approved_destination_url=?');
  const second=source.indexOf('UPDATE teaser_placements SET approved_destination_url=?');
  const staged=source.indexOf('const pendingId = await insertRevision');
  assert.ok(first>0 && second>first && staged>second);
  assert.match(source,/approved_destination_source='legacy_approved_at_edit'/);
});
test('Bot retries use the original send snapshot and uncertain sends are not requeued',()=>{
  const bot=readFileSync('src/app/api/cron/process-broadcast/route.ts','utf8');
  assert.match(bot,/creative_snapshot_json/);
  assert.match(bot,/payout_snapshot_json/);
  assert.match(bot,/ambiguous_telegram_send/);
  assert.doesNotMatch(bot,/UPDATE broadcast_deliveries SET status='retry_wait',sending_at=NULL/);
});
