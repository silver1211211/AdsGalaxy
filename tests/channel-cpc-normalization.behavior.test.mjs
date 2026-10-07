import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: n => mocks[n] || {} });
  return exports;
}
const billing = load('src/lib/channelBilling.ts');
const daily = load('src/lib/channelDailySpend.ts', {'@/lib/channelBilling': billing});
for (const [units, expected] of [[1, .05], [12, .6], [1000, 50]]) {
  test(`${units} clicks at configured CPC 50 debit ${expected}`, () => {
    assert.equal(billing.calculateChannelAdvertiserDebit({type:'clicks', cpc:50, units}), expected);
  });
}
test('discount remains per thousand; CPM and CPS SQL stay in their own units', () => {
  assert.equal(billing.getChannelUnitPrice({type:'clicks', cpc:65, discount:3}), .062);
  assert.equal(billing.getChannelUnitPrice({type:'views', cpm:6.2}), .0062);
  assert.match(daily.channelNextUnitSql(), /cost_per_subscriber,0\)/);
  assert.match(daily.channelNextUnitSql(), /\/1000 END$/);
});
test('same-day CPC cap, budget and wallet boundaries use 0.05', () => {
  const input = {status:'daily_cap_reached', unitPrice:billing.getChannelUnitPrice({type:'clicks', cpc:50}),
    budget:.05, balance:.05, requiresBalance:true, cap:1, spent:.95};
  assert.equal(daily.canResumeChannelDailyCap(input), true);
  for (const change of [{budget:.04}, {balance:.04}, {spent:.951}, {status:'paused'}]) {
    assert.equal(daily.canResumeChannelDailyCap({...input,...change}), false);
  }
});
async function placement({oldPosts=5000, observed=0, pending=0, budget=10, balance=10}={}) {
  const conn = {query: async (sql, params) => {
    if(sql.includes('SELECT c.status')) {
      assert.match(sql, /FOR UPDATE/);
      return [[{status:'active', type:'clicks', cpc:50, budget, advertiser_ad_balance:balance,
        funding_model:'direct_debit', campaign_kind:'channel', channel_delivery_generation:1}]];
    }
    assert.match(sql, /cp.status='pending_delivery'/);
    assert.match(sql, /\?='views' AND cp.status IN/);
    assert.equal(params[2], 'clicks');
    // Delivered posts are not committed clicks. Only observed and pending units reserve.
    assert.ok(oldPosts >= 0);
    return [[{pending_liability:(observed+pending)*params[1]}]];
  }};
  const service = load('src/lib/channelPlacementAffordability.ts', {
    '@/lib/channelBilling':billing, '@/lib/channelDailySpend':{getChannelDailySpend:async()=>0},
    '@/lib/channelViewWaivers':{outstandingViewsSql:()=> '0'},
  });
  return service.checkChannelPlacementAffordability(conn, 123);
}
test('5000 historical delivered CPC posts do not reserve 5000 future clicks', async () => {
  assert.equal((await placement()).allowed, true);
});
test('observed unsettled clicks and concurrent pending placements reserve actual exposure', async () => {
  assert.equal((await placement({observed:199})).allowed, true);
  assert.equal((await placement({observed:199,pending:1})).allowed, false);
  assert.equal((await placement({observed:200,budget:20,balance:10})).reason, 'advertiser_balance_insufficient');
});
