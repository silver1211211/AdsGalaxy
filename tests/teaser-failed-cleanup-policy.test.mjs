import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const policySource=readFileSync('src/lib/teaserCleanupPolicy.ts','utf8');
const policyJs=ts.transpileModule(policySource,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {classifyFailedTeaserPlacement}=await import(`data:text/javascript;base64,${Buffer.from(policyJs).toString('base64')}`);
const now=new Date('2026-11-06T12:00:00Z');
const live={campaignStatus:'active',campaignTeaserEnabled:true,channelTeaserEnabled:true,
  channelTeaserStatus:'active',approvedRevisionId:7,pendingRevisionId:null,priorCampaignStatus:null,
  removalReason:null,insertedAt:new Date('2026-11-06T09:00:00Z'),expiresAt:new Date('2026-11-07T09:00:00Z')};
test('live failed placement may recover after a verified view fetch',()=>{
  assert.equal(classifyFailedTeaserPlacement(live,now).action,'recover');
});
test('expired failed placement enters removal even while campaign remains active',()=>{
  assert.deepEqual(classifyFailedTeaserPlacement({...live,expiresAt:new Date('2026-11-06T10:00:00Z')},now),
    {action:'remove',reason:'expired'});
});
test('missing expiry uses the original insertion plus 24 hours',()=>{
  assert.equal(classifyFailedTeaserPlacement({...live,expiresAt:null,insertedAt:new Date('2026-11-05T11:00:00Z')},now).reason,'expired');
});
test('approved old creative remains eligible while a new edit awaits review',()=>{
  const pending={...live,campaignStatus:'pending',pendingRevisionId:8,priorCampaignStatus:'active'};
  assert.equal(classifyFailedTeaserPlacement(pending,now).action,'recover');
  assert.equal(classifyFailedTeaserPlacement({...pending,approvedRevisionId:null},now).action,'remove');
});
test('rejected, paused, and explicitly requested placements enter removal',()=>{
  assert.equal(classifyFailedTeaserPlacement({...live,campaignStatus:'paused'},now).action,'remove');
  assert.equal(classifyFailedTeaserPlacement({...live,campaignTeaserEnabled:false},now).action,'remove');
  assert.equal(classifyFailedTeaserPlacement({...live,removalReason:'permission_lost'},now).reason,'permission_lost');
});
