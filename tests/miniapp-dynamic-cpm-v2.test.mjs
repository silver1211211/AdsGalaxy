import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

const root=process.cwd();
const read=(file)=>fs.readFileSync(path.join(root,file),"utf8");
const nodeRequire=createRequire(import.meta.url);
function loadEngine(){const file=path.join(root,"src/lib/miniappPublisherCpmEngine.ts"),source=read("src/lib/miniappPublisherCpmEngine.ts");const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:file}).outputText;const testModule={exports:{}};new Function("require","module","exports",js)((name)=>name==="@/lib/db"?{default:{}}:nodeRequire(name),testModule,testModule.exports);return testModule.exports;}
const engine=loadEngine();
const settings={min_cpm:.5,recommended_cpm:1,max_cpm:32,max_publisher_share:.5,absolute_publisher_cpm_cap:11,reserve_share:.1,required_platform_margin_share:.1,geo_unknown_factor:.45,geo_factor_min:.25,geo_factor_max:1,geo_multipliers:{US:1,IN:.68},frequency_decay_rate:.16,frequency_zero_after:120,quality_factor_min:0,quality_factor_max:1,trust_factor_min:.1,trust_factor_max:1,fraud_factor_min:0,fraud_factor_max:1,formula_version:"miniapp_publisher_cpm_v2"};
const economics=(overrides={})=>engine.calculateDynamicPublisherEconomics({economicValue:.02,country:"US",demandYieldFactor:1,uniquenessFactor:1,frequencyFactor:1,qualityFactor:1,trustFactor:1,fraudFactor:1,...overrides},settings);

test("1 USA and India use distinct configurable GEO factors",()=>assert.notEqual(economics({country:"US"}).publisher_cpm,economics({country:"IN"}).publisher_cpm));
test("2 GEO alone does not determine final CPM",()=>assert.ok(economics({country:"US",qualityFactor:.05,frequencyFactor:.05}).publisher_cpm<economics({country:"IN",qualityFactor:1,frequencyFactor:1}).publisher_cpm));
test("3 repeated impressions progressively decay",()=>{const f=[1,3,10,30].map(n=>engine.rollingFrequencyFactor({recent10m:n,hour:n,day:n,sevenDays:n},settings));assert.ok(f.every((v,i)=>i===0||v<f[i-1]));});
test("4 extreme repetition reaches zero",()=>assert.equal(engine.rollingFrequencyFactor({recent10m:120,hour:120,day:120,sevenDays:120},settings),0));
test("5 unique quality traffic earns more",()=>assert.ok(economics({uniquenessFactor:1,qualityFactor:1}).publisher_payout>economics({uniquenessFactor:.1,qualityFactor:.1,frequencyFactor:.1}).publisher_payout));
test("6 publisher payout never exceeds default 50 percent envelope",()=>assert.ok(economics().publisher_payout<=.01));
test("7 publisher CPM never exceeds eleven dollars",()=>{assert.ok(economics({economicValue:1}).publisher_cpm<=11);const batch=economics({economicValue:1000,impressionCount:10000});assert.ok(batch.publisher_cpm<=11);assert.equal(batch.publisher_cap,110);});
test("8 publisher CPM can be zero",()=>assert.equal(economics({qualityFactor:0}).publisher_cpm,0));
test("9 advertiser debit remains authoritative when publisher payout is zero",()=>{const source=read("src/lib/miniappInternalAds.ts"),directDebit=read("src/lib/advertiserDirectDebit.ts");assert.match(source,/claimAdvertiserDirectDebit/);assert.match(directDebit,/UPDATE users SET ad_balance=ad_balance-\? WHERE id=\? AND ad_balance>=\?/);assert.match(source,/advertiser_debit/);assert.equal(economics({fraudFactor:0}).publisher_payout,0);});
test("10 platform margin never becomes negative",()=>assert.ok(economics({economicValue:.001}).platform_retained>=0));
test("11 reserve accounting remains exact",()=>assert.equal(economics().reserve,.002));
test("12 fixed mode remains inside economic and risk safeguards",()=>{const value=economics({cpmMode:"fixed",fixedPublisherCpm:100,frequencyFactor:.1,fraudFactor:.2});assert.ok(value.publisher_payout<value.publisher_cap&&value.publisher_cpm<=11);});
test("13 external zero revenue produces zero payout",()=>assert.equal(economics({economicValue:0}).publisher_payout,0));
test("14 external low yield produces proportionally low payout",()=>assert.ok(economics({economicValue:.0001}).publisher_payout<economics({economicValue:.01}).publisher_payout));
test("15 unknown GEO stays unknown and language is not country",()=>{assert.equal(engine.geoValueFactor(null,settings),.45);assert.doesNotMatch(read("src/app/sdk.js/route.ts"),/language_code\|\|/);assert.match(read("src/lib/miniappEconomicTelemetry.ts"),/source:"unknown"/);});
test("16 frequency is not double-penalized in quality",()=>{const source=read("src/lib/miniappPublisherCpmEngine.ts");assert.doesNotMatch(source,/quality=.*frequency/);assert.match(source,/frequencyFactor:frequency,qualityFactor:quality/);});
test("17 trust and fraud factors reduce payout",()=>{assert.ok(economics({trustFactor:.2}).publisher_payout<economics({trustFactor:1}).publisher_payout);assert.equal(economics({fraudFactor:0}).publisher_payout,0);});
test("18 reporting uses true internal gross publisher reserve and retained semantics",()=>{const reporting=read("src/lib/miniappRevenueEngine.ts"),ui=read("src/app/admin/miniapps/page.tsx");assert.match(reporting,/internal_gross_revenue/);assert.match(reporting,/internal_publisher_revenue/);assert.match(reporting,/internal_platform_revenue/);assert.match(ui,/Internal Advertiser Gross/);assert.doesNotMatch(ui,/Internal Ad Revenue/);});
test("19 impression click and CTR sources remain intact",()=>{const reports=read("src/lib/miniappReports.ts");assert.match(reports,/SUM\(.*impressions/);assert.match(reports,/ad_click_attribution/);assert.match(reports,/ctr\(totalClicks, totalImpressions\)/);});
test("20 migration and source do not recalculate historical settlements",()=>{const migration=read("db/migrations/20260902_0124_miniapp_dynamic_cpm_v2.sql"),source=read("src/lib/miniappPublisherCpmEngine.ts");assert.doesNotMatch(migration,/UPDATE miniapp_internal_ad_impressions|UPDATE miniapp_earnings_settlements/);assert.match(source,/miniapp_publisher_cpm_v2/);});
