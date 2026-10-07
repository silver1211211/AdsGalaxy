import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync('src/lib/channelResumeEligibility.ts','utf8');
async function run(change={}, {spent=0, destination=true}={}) {
  const row={id:1,status:'budget_exhausted',unit_price:.05,budget:10,ad_balance:10,daily_budget_limit:1,...change};
  let writes=0;
  const conn={query:async sql=>{
    if(sql.includes('SELECT c.*')) {
      assert.match(sql,/FOR UPDATE/);assert.match(sql,/c.start_at<=UTC_TIMESTAMP/);
      assert.match(sql,/growth_tracking_status='ready'/);assert.match(sql,/advertiser_paused/);
      const automatic=['budget_exhausted','daily_cap_reached'].includes(row.status)||
        (row.status==='paused'&&row.pause_reason==='insufficient_balance');
      return automatic ? [[row]] : [[]];
    }
    if(sql.includes('SELECT ch.*'))return [destination?[{id:7}]:[]];
    if(sql.startsWith('UPDATE campaigns')){writes++;return [{affectedRows:1}];}
    throw Error(sql);
  }};
  const mocks={
    '@/lib/channelBilling':{channelUnitPriceSql:()=>'.05'},
    '@/lib/channelDailySpend':{getChannelDailySpend:async()=>spent},
    '@/lib/channelAudience':{channelCampaignMatchesInventory:()=>true},
    '@/lib/campaignInventoryExclusions':{loadCampaignExclusions:async()=>new Map(),campaignExcludesChannel:()=>false},
    '@/lib/silverCampaignControl':{silverCampaignDeliverySql:()=> '1=1',silverChannelEligibilitySql:()=> '1=1'},
  };
  const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:n=>mocks[n]});
  const resumed=await exports.resumeAutomaticallyPausedChannel(conn,1);return {resumed,writes};
}
test('funded automatic Channel pause can resume without changing wallet or budget',async()=>{
  assert.deepEqual(await run(),{resumed:true,writes:1});
  assert.doesNotMatch(source,/UPDATE users|SET budget=|SET total_budget=/);
});
test('manual and terminal statuses never auto-resume',async()=>{
  for(const status of ['paused','cancelled','completed','deleted'])assert.equal((await run({status})).resumed,false);
});
test('CPC next unit requires both funds and allowance',async()=>{
  for(const change of [{budget:.04},{ad_balance:.04},{unit_price:0}])assert.equal((await run(change)).resumed,false);
  assert.equal((await run({budget:.05,ad_balance:.05})).resumed,true);
});
test('current UTC cap and eligible destination required',async()=>{
  assert.equal((await run({}, {spent:.951})).resumed,false);
  assert.equal((await run({}, {destination:false})).resumed,false);
});
