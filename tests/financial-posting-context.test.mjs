import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const source=fs.readFileSync("src/lib/financialPostingContext.ts","utf8");
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
new Function("module","exports",output)(module,module.exports);
const {withFinancialPostingContext}=module.exports;
const context={sourceKey:"channel:1",sourceSystem:"channel",sourceRecordId:"1",policyVersion:"v1"};
test("posting source is set and cleared on success",async()=>{
 const queries=[];const db={query:async(sql,args)=>{queries.push([sql,args]);return []}};
 assert.equal(await withFinancialPostingContext(db,context,async()=>42),42);
 assert.equal(queries.length,2);
 assert.match(queries[0][0],/source_key=\?/);
 assert.match(queries[1][0],/source_key=NULL/);
});
test("posting source clears even when financial write throws",async()=>{
 const queries=[];const db={query:async(sql)=>{queries.push(sql);return []}};
 await assert.rejects(withFinancialPostingContext(db,context,async()=>{throw Error("write_failed")}),/write_failed/);
 assert.equal(queries.length,2);
 assert.match(queries[1],/source_key=NULL/);
});
test("invalid or oversized attribution is rejected before writing",async()=>{
 const queries=[];const db={query:async(sql)=>{queries.push(sql);return []}};
 await assert.rejects(withFinancialPostingContext(db,{...context,sourceKey:"x".repeat(192)},async()=>{}),/invalid_financial_source_key/);
 await assert.rejects(withFinancialPostingContext(db,{...context,sourceSystem:"bad\nvalue"},async()=>{}),/invalid_financial_source_system/);
 assert.deepEqual(queries,[]);
});
