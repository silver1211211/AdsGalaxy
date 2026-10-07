import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const read = p => fs.readFileSync(p,'utf8');
function load(file,mocks={}) {
  const exports={};
  vm.runInNewContext(ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,
    {exports,require:n=>mocks[n]||{},console:{...console,error(){}},Date,Map,Set,URLSearchParams});
  return exports;
}
const math=load('src/lib/campaignStatisticMath.ts');
const reporting=load('src/lib/channelReporting.ts',{'@/lib/campaignStatisticMath':math});
const cap=load('src/lib/channelDailySpend.ts',{'@/lib/channelBilling':load('src/lib/channelBilling.ts')});
test('A/B/K: observed CPM impressions differ from financial units and CTR uses observed views',()=>{
  const r=reporting.channelMetricPayload({views:66285,billable_views:10167,clicks:10,spend:63.0354},false);
  assert.equal(r.impressions,66285);assert.equal(r.billable_views,10167);assert.equal(r.spend,63.0354);
  assert.equal(r.ctr,math.campaignCtr(10,66285));
});
test('C/E/F/I: CPC presentation gate preserves money and reveals existing/new events',()=>{
  const row={views:0,clicks:14,spend:0.7};
  assert.equal(reporting.channelMetricPayload(row,false).clicks,0);
  assert.equal(reporting.channelMetricPayload(row,false).spend,0.7);
  row.views=8;assert.equal(reporting.channelMetricPayload(row,false).clicks,14);
  row.clicks++;assert.equal(reporting.channelMetricPayload(row,false).clicks,15);
});
test('D/G/H/J/L/M: CPS gate does not mutate conversions; zero denominators are safe',()=>{
  const row={views:0,clicks:14,subscribers:2,spend:1.12};
  let m=reporting.channelMetricPayload(row,true);assert.equal(m.subscribers,0);assert.equal(m.conversion_rate,0);assert.equal(m.ctr,0);
  assert.equal(row.subscribers,2);row.views=8;m=reporting.channelMetricPayload(row,true);
  assert.equal(m.subscribers,2);assert.equal(m.effective_cps,0.56);assert.equal(m.conversion_rate,math.campaignCtr(2,14));
  row.subscribers++;assert.equal(reporting.channelMetricPayload(row,true).subscribers,3);
  row.clicks=0;assert.equal(reporting.channelMetricPayload(row,true).conversion_rate,0);
});
test('authoritative reporting query uses both ledgers, fraud exclusions and confirmed posts, never settled counters',async()=>{
  const db={query:async sql=>{assert.match(sql,/channel_advertiser_debits/);assert.match(sql,/channel_settlement_ledger/);
    assert.match(sql,/NOT EXISTS.*channel_fraud_billing_adjustments/);assert.match(sql,/g.status='billed' AND g.fraud_status='clear'/);
    assert.match(sql,/delivery_confirmed_at IS NOT NULL AND cp.delivery_failed_at IS NULL/);assert.doesNotMatch(sql,/settled_views|settled_clicks/);
    return [[{id:1,views:66285,clicks:10,billable_views:10167,spend:'63.03540000'}]];}};
  assert.equal((await reporting.getChannelReportingMetrics(db,[1])).get(1).spend,63.0354);
});
test('N/O/P: live-day overlay replaces rollup, historical views stable, financial detail equals lifetime',async()=>{
  const historical={date:'2026-09-27',views:100,clicks:2,spend:63.0292,billable_views:10166,subscribers:0};
  let liveClicks=10, liveSubscribers=2;
  const db={query:async sql=>{
    if(sql.includes('DATE_FORMAT(UTC_DATE()'))return [[{today:'2026-09-28'}]];
    if(sql.includes('SELECT c.id,'))return [[{id:1,views:108,clicks:liveClicks,subscribers:liveSubscribers,spend:63.0354,billable_views:10167}]];
    if(sql.includes('SELECT date,SUM(views)'))return [[{...historical},{date:'2026-09-28',views:3,clicks:liveClicks-2,subscribers:liveSubscribers,spend:0.0062,billable_views:1}]];
    throw Error(sql);
  }};
  const service=load('src/lib/advertiserCampaignStatistics.ts',{'@/lib/db':db,'@/lib/channelReporting':reporting,
    '@/lib/channelGrowthStatistics':{getGrowthTodayImpressions:async()=>8},'@/lib/statFormulas':{metricNumber:v=>Number(v||0)},'@/lib/campaignStatisticMath':math});
  const campaign={id:1,type:'views',campaign_kind:'channel',teaser_mode:'none'};
  const first=await service.buildAdvertiserCampaignStatistics(campaign,{key:'all'});
  assert.equal(first.totals.views,108);assert.equal(first.daily_rows[1].views,8);assert.equal(first.daily_rows[0].views,100);
  assert.ok(Math.abs(first.daily_rows.reduce((s,r)=>s+r.spend,0)-first.totals.spend)<1e-8);
  liveClicks++;liveSubscribers++;const next=await service.buildAdvertiserCampaignStatistics({...campaign,campaign_kind:'channel_growth'},{key:'all'});
  assert.equal(next.totals.clicks,11);assert.equal(next.totals.subscribers,3);assert.equal(historical.views,100);
});
for(const [model,unit] of [['CPM',6.2/1000],['CPC',0.065],['CPS',0.56]])test(`Q/R/S/T: ${model} stale-cap resume requires allowance and funds, never manual pause`,()=>{
  const input={status:'daily_cap_reached',unitPrice:unit,budget:1,balance:1,requiresBalance:true,cap:25,spent:0.076};
  assert.equal(cap.canResumeChannelDailyCap(input),true);
  for(const change of [{status:'paused'},{status:'budget_exhausted'},{budget:0},{balance:0},{spent:25}]) assert.equal(cap.canResumeChannelDailyCap({...input,...change}),false);
});
test('U/V: long source diagnostic failure cannot undo successful monotonic count',async()=>{
  const persist=load('src/lib/channelViewPersistence.ts');let views=10;let updates=0;
  const db={query:async(sql,p)=>{updates++;if(sql.includes('SET views=')){assert.match(sql,/GREATEST/);views=Math.max(views,p[0]);return [{}];}
    assert.equal(p[0],'pre_deletion_mtproto_public_fallback');throw Object.assign(Error('too long'),{code:'ER_DATA_TOO_LONG'});}};
  await persist.persistSuccessfulChannelViews(db,1,20,'pre_deletion_mtproto_public_fallback');assert.equal(views,20);assert.equal(updates,2);
  const labels=[...read('src/lib/channelAdminViewRefresh.ts').matchAll(/source = "([^"]+)"/g)].map(m=>m[1]);
  assert.ok(labels.every(s=>s.length<=128));assert.match(read('db/migrations/20260928_0155_channel_view_fetch_source_width.sql'),/VARCHAR\(128\)/);
});
test('Z: Teaser, Bot and Mini App never enter the new Channel presentation gate',()=>{
  for(const row of [{type:'views',teaser_mode:'teaser_only'},{type:'views',teaser_mode:'standard_plus_teaser'},{type:'broadcast'},{type:'views',source:'miniapp'}]) assert.equal(reporting.isStandardChannelReport(row),false);
});
test('pricing and public/admin integration use billing-model guards',()=>{
  const admin=read('src/app/admin/campaigns/[id]/page.tsx');assert.match(admin,/editData.cost_per_subscriber !== undefined/);assert.match(admin,/editData.cpc !== undefined/);
  assert.match(admin,/Billable Impressions/);
  for(const file of ['src/app/api/admin/campaigns/[id]/route.ts','src/app/api/advertiser/campaigns/[id]/route.ts','src/app/api/advertiser/campaign-feed/route.ts','src/app/api/admin/campaigns/route.ts'])assert.match(read(file),/channelMetricPayload/);
});

test('stale same-day CPC is resumed through the existing transactional lifecycle',async()=>{
  let updated=0;
  const conn={query:async(sql)=>{
    if(sql.includes('SELECT c.id')){assert.match(sql,/daily_cap_billing_date<UTC_DATE\(\) OR COALESCE\(c.teaser_mode,'none'\)='none'/);
      assert.match(sql,/pause_reason='daily_budget_limit'/);return [[{id:1,status:'daily_cap_reached',unit_price:0.065,budget:10,ad_balance:10,daily_budget_limit:25,today_spend:0.076,funding_model:'direct_debit',campaign_kind:'channel'}]];}
    assert.match(sql,/channel_delivery_generation=channel_delivery_generation\+1/);updated++;return [{affectedRows:1}];}};
  const lifecycle=load('src/lib/channelDailyCap.ts',{'@/lib/channelDailySpend':cap,'@/lib/dbResilience':{withFinancialTransactionRetry:fn=>fn(conn)}});
  assert.deepEqual(Array.from(await lifecycle.reactivateChannelCampaignsForNewBillingDay()),[1]);assert.equal(updated,1);
});
test('historical aggregation never replaces closed-day views with current cumulative counters',async()=>{
  const sqls=[];const conn={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},query:async(sql)=>{sqls.push(sql);return [{affectedRows:1}];}};
  const aggregate=load('src/lib/channelStatistics.ts',{'@/lib/db':{query:async()=>[[{today:'2026-09-28'}]],getConnection:async()=>conn},
    '@/lib/schemaGuards':{ensureClassicSettlementColumns:async()=>{}},'@/lib/channelReporting':reporting});
  await aggregate.aggregateChannelStatistics('2026-09-27');
  const snapshot=sqls.find(sql=>sql.includes('INSERT INTO channel_post_daily_stats'));
  assert.match(snapshot,/AND \(\?=\? OR COALESCE\(campaign_scope.teaser_mode,'none'\)<>'none'\)/);
  assert.ok(sqls.some(sql=>sql.includes('channel_advertiser_debits')));
  assert.ok(sqls.every(sql=>!sql.includes('UPDATE campaigns SET')&&!sql.includes('UPDATE users SET')));
});
test('optional financial-rollup repair defaults to read-only and repeated apply derives same values',async()=>{
  const repair=load('src/lib/channelFinancialRollupRepair.ts',{'@/lib/channelReporting':reporting});
  let updates=0;const statements=[];const db={query:async(sql)=>{statements.push(sql);if(sql.startsWith('SELECT'))return [[]];updates++;return [{affectedRows:1}];}};
  await repair.reconcileChannelFinancialRollups(db,'2026-09-01','2026-09-27');assert.equal(updates,0);
  await repair.reconcileChannelFinancialRollups(db,'2026-09-01','2026-09-27',true);
  const first=statements.filter(s=>s.startsWith('UPDATE')).join('\n');
  statements.length=0;await repair.reconcileChannelFinancialRollups(db,'2026-09-01','2026-09-27',true);
  assert.equal(statements.filter(s=>s.startsWith('UPDATE')).join('\n'),first);
  assert.doesNotMatch(first,/UPDATE (campaigns|users)|SET.*settled_views|SET.*total_views/);
});
