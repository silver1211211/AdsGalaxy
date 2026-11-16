import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const source=fs.readFileSync("src/lib/historicalFinancialEvidence.ts","utf8");
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
new Function("require","module","exports",output)((name)=>name==="node:crypto"?requireCrypto():{
  decimalUnits:(v)=>BigInt(String(v).replace(".","").padEnd(9,"0")),
  unitsDecimal:(v)=>String(v)
},module,module.exports);
function requireCrypto(){return {createHash:()=>({update(){return this},digest(){return "a".repeat(64)}})}}
const {classifyHistoricalChannelRow,previewHistoricalChannelCandidates,stageHistoricalChannelCandidates}=module.exports;
const row={id:42,publisher_id:7,publisher_reward:"2.00000000",status:"unlocked",fraud_adjusted_at:null,created_at:"2026-01-01 00:00:00"};
test("historical source is only an unverified candidate",()=>{
 const c=classifyHistoricalChannelRow("click",row);
 assert.equal(c.sourceEventKey,"legacy:channel:click:42");
 assert.equal(c.reviewStatus,"candidate");
 assert.equal(c.verificationConfidence,"unverified");
 assert.match(c.missingEvidence,/balance continuity/);
});
test("bounded preview uses only source rows and never mutates balances",async()=>{
 let sql="";
 const rows=await previewHistoricalChannelCandidates({query:async(q,p)=>{sql=q;assert.deepEqual(p,[0,100]);return [[row]]}},"click");
 assert.equal(rows.length,1);
 assert.match(sql,/ORDER BY id LIMIT/);
 await assert.rejects(previewHistoricalChannelCandidates({query:()=>{} },"click",0,501),/invalid_historical_batch/);
});
test("staging requires reviewed pilot and is idempotent metadata only",async()=>{
 const candidate=classifyHistoricalChannelRow("click",row);
 let calls=[];
 const db={beginTransaction:async()=>calls.push("begin"),commit:async()=>calls.push("commit"),rollback:async()=>calls.push("rollback"),query:async(sql)=>{
   calls.push(sql);
   if (sql.startsWith("SELECT")) return [[{user_id:7,source_table:"ad_settlements",source_record_id:42,source_row_sha256:candidate.sourceRowSha256}]];
   return [{affectedRows:calls.filter(x=>String(x).startsWith("INSERT")).length===1?1:0}];
 }};
 await assert.rejects(stageHistoricalChannelCandidates(db,[candidate]),/reviewed_pilot/);
 assert.deepEqual(calls,[]);
 assert.deepEqual(await stageHistoricalChannelCandidates(db,[candidate],true),{inserted:1,existing:0});
 assert.deepEqual(await stageHistoricalChannelCandidates(db,[candidate],true),{inserted:0,existing:1});
 assert.ok(calls.filter(x=>String(x).startsWith("INSERT")).every(x=>!x.includes("UPDATE users")));
});
