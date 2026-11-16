import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source=fs.readFileSync("src/lib/privateChannelTrackingOnboarding.ts","utf8");
async function run({existing=false, confirm={ok:true}, invite={ok:true,result:{invite_link:"https://t.me/+example"}}, join={ok:false,code:"join_request_required"}, lock=true, concurrent=false}={}) {
  let confirms=0, updates=[], joins=0, invites=0;
  let held=false;
  const conn={query:async sql=>{if(sql.includes("GET_LOCK")){if(!lock||held)return [[{acquired:0}]];held=true;return [[{acquired:1}]]}if(sql.includes("RELEASE_LOCK"))held=false;return [[]]},release(){}};
  const pool={getConnection:async()=>conn,query:async(sql,params)=>{
    if(sql.includes("SELECT tracking_account, tracking_account_status"))return [[{tracking_account:existing?1:null,tracking_account_status:existing?"active":"",tracking_account_member_status:existing?"member":""}]];
    if(sql.includes("active_count"))return [[]];
    updates.push({sql,params});return [{affectedRows:1}];
  }};
  const api={getConfiguredMtprotoAccountNumbers:()=>[1], getMtprotoAccountAvailability:()=>({available:true}),getTrackingAccountUsernames:()=>[],confirmPrivateChannelMembership:async()=>{confirms++;if(concurrent)await new Promise(resolve=>setTimeout(resolve,30));return confirm},joinPrivateInviteWithAccount:async()=>{joins++;return join}};
  const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,{exports,require:n=>n==="@/lib/db"?{__esModule:true,default:pool}:n==="@/lib/telegramMtproto"?api:{},process:{env:{BOT_TOKEN:"test-token"}},console,AbortSignal,fetch:async url=>({json:async()=>{if(url.endsWith("createChatInviteLink")){invites++;return invite}return {ok:true}}})});
  const schema={hasTrackingAccountStatus:true,hasTrackingAccount:true,hasTrackingAccountMemberStatus:true,hasTrackingAccountAssignedAt:true,hasTrackingAccountLastSuccessAt:true,hasTrackingAccountLastFailureAt:true,hasTrackingAccountFailureReason:true};
  const input={channelId:4,chatId:"-100123",channelType:"private",schema};
  const result=concurrent?await Promise.all([exports.onboardPrivateChannelTracking(input),exports.onboardPrivateChannelTracking(input)]):await exports.onboardPrivateChannelTracking(input);
  return {result,confirms,updates,joins,invites};
}
test("stored membership is rechecked before approval",async()=>{const x=await run({existing:true});assert.equal(x.result.status,"active");assert.equal(x.confirms,1)});
test("stored membership rate limit remains pending",async()=>{const x=await run({existing:true,confirm:{ok:false,code:"rate_limited"}});assert.equal(x.result.status,"pending_manual");assert.equal(x.result.reason,"rate_limited")});
test("already-member confirmation avoids an invite",async()=>{const x=await run();assert.equal(x.result.status,"active");assert.equal(x.result.member_status,"already_member")});

test("pending join request does not activate membership",async()=>{const x=await run({confirm:{ok:false,code:"not_channel_member"}});assert.equal(x.result.status,"pending_manual");assert.match(x.result.reason,/join_request_required/);assert.equal(x.joins,1)});
test("invite rate limit blocks joining",async()=>{const x=await run({confirm:{ok:false,code:"not_channel_member"},invite:{ok:false,error_code:429}});assert.equal(x.result.reason,"rate_limited");assert.equal(x.joins,0)});
test("insufficient invite rights remain a failure",async()=>{const x=await run({confirm:{ok:false,code:"not_channel_member"},invite:{ok:false,error_code:403,description:"not enough rights"}});assert.equal(x.result.status,"pending_manual");assert.equal(x.result.reason,"chat_admin_required");assert.equal(x.joins,0)});
test("join rate limits remain pending",async()=>{const x=await run({confirm:{ok:false,code:"not_channel_member"},join:{ok:false,code:"rate_limited"}});assert.equal(x.result.reason,"rate_limited")});
test("authorization failures do not trigger invite",async()=>{const x=await run({confirm:{ok:false,code:"session_unauthorized"}});assert.equal(x.result.reason,"session_unauthorized");assert.equal(x.invites,0)});
test("stale stored membership initiates a new join but is not trusted",async()=>{const x=await run({existing:true,confirm:{ok:false,code:"not_channel_member"}});assert.equal(x.result.status,"pending_manual");assert.equal(x.invites,1);assert.equal(x.joins,1);assert.equal(x.confirms,1)});
test("lock contention cannot initiate a duplicate operation",async()=>{const x=await run({lock:false});assert.equal(x.result.reason,"tracking_assignment_busy");assert.equal(x.invites,0)});

test("simultaneous approvals do not duplicate membership work",async()=>{const x=await run({concurrent:true});assert.deepEqual(x.result.map(r=>r.status).sort(),["active","pending_manual"]);assert.equal(x.confirms,1);assert.equal(x.invites,0)});

test("successful join must carry a confirmed member state",async()=>{const x=await run({confirm:{ok:false,code:"not_channel_member"},join:{ok:true,memberStatus:"member"}});assert.equal(x.result.status,"active");assert.equal(x.result.member_status,"member")});
test("unexpected pending success payload cannot activate tracking",async()=>{const x=await run({confirm:{ok:false,code:"not_channel_member"},join:{ok:true,memberStatus:"pending"}});assert.equal(x.result.status,"pending_manual");assert.equal(x.result.reason,"membership_unconfirmed")});
test("invite cooldown is passed back to admin",async()=>{const x=await run({confirm:{ok:false,code:"not_channel_member"},invite:{ok:false,error_code:429,parameters:{retry_after:172800}}});assert.equal(x.result.status,"pending_manual");assert.equal(x.result.retryAfterSeconds,172800);assert.equal(x.joins,0)});
for(const code of ["join_request_pending","invite_hash_expired","session_unauthorized","channel_private","network_error"])test(`join failure ${code} stops without approval`,async()=>{const x=await run({confirm:{ok:false,code:"not_channel_member"},join:{ok:false,code}});assert.equal(x.result.status,"pending_manual");assert.equal(x.result.reason,code);assert.equal(x.joins,1)});

test("inaccessible nonmember may be invited but is never assumed to have joined",async()=>{const x=await run({confirm:{ok:false,code:"channel_private"}});assert.equal(x.result.status,"pending_manual");assert.equal(x.invites,1);assert.equal(x.joins,1)});
test("a stale account is restored only after confirmed join",async()=>{const x=await run({existing:true,confirm:{ok:false,code:"not_channel_member"},join:{ok:true,memberStatus:"member"}});assert.equal(x.result.status,"active");assert.equal(x.confirms,1);assert.equal(x.joins,1)});

test("admin error messages identify rights, pending requests, rate limits and authorization",()=>{const a=source.indexOf("export function privateTrackingFailureMessage("),b=source.indexOf("\nfunction classifyInviteFailure",a);assert.ok(a>=0&&b>a);const out={};vm.runInNewContext(ts.transpileModule(source.slice(a,b),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:out});assert.match(out.privateTrackingFailureMessage("chat_admin_required"),/administrator permission/i);assert.match(out.privateTrackingFailureMessage("join_request_pending"),/join request/i);assert.match(out.privateTrackingFailureMessage("rate_limited"),/rate-limited/i);assert.match(out.privateTrackingFailureMessage("session_unauthorized"),/not authorized/i)});

test("Telegram reports bot is not an administrator as insufficient rights",async()=>{const x=await run({confirm:{ok:false,code:"not_channel_member"},invite:{ok:false,error_code:403,description:"Forbidden: bot is not an administrator of the channel chat"}});assert.equal(x.result.reason,"chat_admin_required");assert.equal(x.joins,0)});
test("bot authentication failure is distinct from MTProto session failure",async()=>{const x=await run({confirm:{ok:false,code:"not_channel_member"},invite:{ok:false,error_code:401,description:"Unauthorized"}});assert.equal(x.result.reason,"bot_auth_failed");assert.equal(x.joins,0)});
