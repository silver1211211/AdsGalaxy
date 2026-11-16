import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
const teaser=fs.readFileSync("src/lib/teaser.ts","utf8");
const placement=fs.readFileSync("src/lib/teaserPlacement.ts","utf8");
const cron=fs.readFileSync("src/app/api/cron/teaser/route.ts","utf8");
test("terminal edit categories separate snapshot, permission, and content failures",()=>{
  for(const category of ["MESSAGE_TERMINAL","CHANNEL_PERMISSION","CONTENT_TERMINAL","RATE_LIMITED","RETRYABLE_NETWORK"])assert.match(teaser,new RegExp(category));
  assert.match(placement,/edit\.category==="CHANNEL_PERMISSION"/);
  assert.match(placement,/edit\.category==="CONTENT_TERMINAL"\?"POST_TOO_LONG"/);
  assert.match(placement,/SNAPSHOT_NOT_EDITABLE/);
});
test("missing views terminalize without manufacturing zero views or altering settlement",()=>{
  assert.match(cron,/missingTelegramMessage/);
  assert.match(cron,/status='already_absent'/);
  assert.doesNotMatch(cron,/baseline_views=0/);
  assert.doesNotMatch(cron,/settled_impressions=0/);
});
test("removal missing messages are idempotently terminal",()=>{
  assert.match(cron,/result\.category==="MESSAGE_TERMINAL"&&result\.code==="SNAPSHOT_MESSAGE_ABSENT"/);
  assert.match(teaser,/message to edit not found/);
});
test("uneditable Telegram message remains unresolved without a deletion cutoff",async()=>{
  const start=cron.indexOf('async function reconcileRemoval(');
  const end=cron.indexOf('\nasync function deferViewRetry',start);
  assert.ok(start>0&&end>start);
  const compiled=ts.transpileModule(`${cron.slice(start,end)}\nexports.reconcileRemoval=reconcileRemoval;`,
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const run=async(result)=>{
    const writes=[];
    const module={exports:{}};
    vm.runInNewContext(compiled,{module,exports:module.exports,Date,
      claimRemoval:async()=>true,
      pool:{query:async(sql)=>{if(sql.startsWith('SELECT'))return [[]];writes.push(sql);return [{affectedRows:1}];}},
      entities:()=>[],stripExactTeaserSuffix:text=>text,editTelegramTeaser:async()=>result});
    const outcome=await module.exports.reconcileRemoval({id:5,channel_id:1,
      telegram_message_id:10,telegram_chat_id:20,message_type:'text',organic_text:'post',
      organic_entities:null,rendered_suffix:'',baseline_views:null});
    return {outcome,writes};
  };
  const uneditable=await run({ok:false,category:'MESSAGE_TERMINAL',code:'SNAPSHOT_NOT_EDITABLE'});
  assert.equal(uneditable.outcome,'removal_manual_review');
  assert.match(uneditable.writes.at(-1),/status='failed'/);
  assert.doesNotMatch(uneditable.writes.at(-1),/removed_at|billing_cutoff_at/);
  const absent=await run({ok:false,category:'MESSAGE_TERMINAL',code:'SNAPSHOT_MESSAGE_ABSENT'});
  assert.equal(absent.outcome,'absent');
  assert.match(absent.writes.at(-1),/billing_cutoff_at/);
});
