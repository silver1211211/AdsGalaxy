import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const source=fs.readFileSync("src/lib/earnings.ts","utf8");
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
new Function("require","module","exports",output)((name)=>name==="./financialPostingContext"?{
  withFinancialPostingContext:async(_db,_context,action)=>action()
}:{},module,module.exports);
const {creditSettledPublisherBalance,isZeroOrdinaryLockEnabled}=module.exports;
function db(){
 const sql=[];
 return {sql,release(){},async query(q){sql.push(q);return [{affectedRows:1}]}};
}
test("settled ordinary earnings are immediately available without a feature flag",async()=>{
  const before=process.env.ORDINARY_EARNINGS_ZERO_LOCK_ENABLED;
  try{
    for(const value of [undefined,"false","true"]){
      if(value===undefined)delete process.env.ORDINARY_EARNINGS_ZERO_LOCK_ENABLED;
      else process.env.ORDINARY_EARNINGS_ZERO_LOCK_ENABLED=value;
      assert.equal(isZeroOrdinaryLockEnabled(),true);
      const connection=db();
      assert.equal(await creditSettledPublisherBalance(connection,7,"2.00000000",{sourceKey:"x",sourceSystem:"test",sourceRecordId:"1",policyVersion:"v1"}),true);
      assert.equal(connection.sql.length,1);
      assert.match(connection.sql[0],/balance_available = balance_available \+ \?/);
      assert.doesNotMatch(connection.sql[0],/balance_locked/);
    }
  }finally{if(before===undefined)delete process.env.ORDINARY_EARNINGS_ZERO_LOCK_ENABLED;else process.env.ORDINARY_EARNINGS_ZERO_LOCK_ENABLED=before}
});
test("legacy unlock jobs retire under immediate availability",()=>{
 const channel=fs.readFileSync("src/app/api/cron/unlock-balances/route.ts","utf8");
 const miniapp=fs.readFileSync("src/app/api/cron/unlock-miniapp/route.ts","utf8");
 assert.match(channel,/isZeroOrdinaryLockEnabled\(\)/);
 assert.match(miniapp,/isZeroOrdinaryLockEnabled\(\)/);
 for(const file of ["src/lib/channelFastBilling.ts","src/lib/channelSettlement.ts","src/app/api/cron/settle-miniapp/route.ts"]){
  assert.match(fs.readFileSync(file,"utf8"),/isZeroOrdinaryLockEnabled\(\) \? "unlocked" : "locked"/);
 }
});
