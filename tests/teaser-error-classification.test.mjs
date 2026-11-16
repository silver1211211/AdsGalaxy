import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source=readFileSync(new URL('../src/lib/teaser.ts',import.meta.url),'utf8');
const start=source.indexOf('export function classifyTeaserTelegramError(');
const end=source.indexOf('\nexport type TelegramEditResult=',start);
assert.ok(start>0&&end>start);
const compiled=ts.transpileModule(source.slice(start,end),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
vm.runInNewContext(compiled,{module,exports:module.exports});
const classify=module.exports.classifyTeaserTelegramError;

test('Telegram 429 preserves retry-after and network timeout remains retryable',()=>{
  const rate=classify({status:429,description:'Too Many Requests',retryAfter:42});
  assert.equal(rate.category,'RATE_LIMITED');
  assert.equal(rate.retryAfter,42);
  assert.equal(classify({network:true,description:'TimeoutError'}).category,'RETRYABLE_NETWORK');
});
test('Telegram 403 permission and authentication errors require review',()=>{
  assert.equal(classify({status:403,description:'Not enough rights to edit messages'}).category,'CHANNEL_PERMISSION');
  assert.equal(classify({status:403,description:'Forbidden'}).category,'AUTH_FAILURE');
});
test('missing message and uneditable existing message remain distinct',()=>{
  assert.equal(classify({status:400,description:'message to edit not found'}).code,'SNAPSHOT_MESSAGE_ABSENT');
  assert.equal(classify({status:400,description:"message can't be edited"}).code,'SNAPSHOT_NOT_EDITABLE');
});
