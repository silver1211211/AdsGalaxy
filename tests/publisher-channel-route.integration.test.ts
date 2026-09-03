import assert from "node:assert/strict";
import { mock, test } from "node:test";

let queryMode="success",privateResult:any={ok:true,chatId:"-200",participantsCount:250};
const pool={query:async(sql:string)=>{if(queryMode==="unique"&&sql.startsWith("INSERT INTO channels")){const e:any=new Error("SQL private invite session API hash access hash +234 stack");e.code="ER_DUP_ENTRY";throw e}if(queryMode==="database"&&sql.startsWith("INSERT INTO channels"))throw new Error("SELECT secret FROM channels stack");if(sql.includes("INFORMATION_SCHEMA.COLUMNS"))return[[{ok:1}]];if(sql.includes("INFORMATION_SCHEMA.TABLES"))return[[]];if(sql.startsWith("SELECT value FROM settings"))return[[{value:"1"}]];if(sql.startsWith("SELECT id, user_id"))return[queryMode==="exists"?[{id:9,user_id:1,is_deleted:0}]:[]];if(sql.startsWith("INSERT INTO channels"))return[{insertId:77,affectedRows:1}];return[[]]}};
let POST:(request:Request)=>Promise<Response>;
test.before(async()=>{
await mock.module("@/lib/db",{defaultExport:pool});
await mock.module("@/lib/auth",{namedExports:{getAuthenticatedUser:async()=>({id:1,telegram_id:"1"}),getAuthErrorStatus:()=>500}});
await mock.module("@/lib/productionSafety",{namedExports:{requireUserWritesAllowed:async()=>null}});
await mock.module("@/lib/channelPrivacy",{namedExports:{inferChannelType:({channelType}:any)=>channelType==="private"?"private":channelType==="public"?"public":null,getChannelPrivacySchema:async()=>({hasChannelType:true,hasInviteLinkHash:true,hasPrivateInviteLinkEncrypted:true,hasViewTrackingStatus:true,hasTrackingAccountStatus:false,hasTrackingAccount:false,hasTrackingAccountMemberStatus:false,hasTrackingAccountAssignedAt:false,hasTrackingAccountLastSuccessAt:false,hasTrackingAccountLastFailureAt:false,hasTrackingAccountFailureReason:false}),hashInviteLink:()=>"hash",normalizePrivateInviteLink:(v:any)=>String(v||"").startsWith("https://t.me/+")?String(v):null,normalizePublicChannelUsername:(v:any)=>String(v||"").replace(/^@/,"")||null}});
await mock.module("@/lib/telegramMtproto",{namedExports:{resolvePrivateInviteLink:async()=>{if(privateResult instanceof Error)throw privateResult;return privateResult}}});
await mock.module("@/lib/privateInviteLinkVault",{namedExports:{encryptPrivateInviteLink:()=>"encrypted"}});
await mock.module("@/lib/privateChannelVerificationToken",{namedExports:{inspectPrivateChannelVerificationToken:()=>({valid:false,tokenReceived:false,tokenHasChatId:false,digestMatch:false,errorCode:"none"})}});
await mock.module("@/lib/privateChannelDiagnostics",{namedExports:{logPrivateChannelDiagnostic:()=>{}}});
await mock.module("@/lib/publisherNotifications",{namedExports:{notifyChannelSubmitted:async()=>{}}});
await mock.module("@/lib/channelWelcomePost",{namedExports:{sendChannelWelcomePostIfNeeded:async()=>{}}});
await mock.module("@/lib/supportMessages",{namedExports:{safeQueuePublisherWelcome:async()=>{}}});
POST=(await import("../src/app/api/publisher/channels/route")).POST;
});
const originalFetch=globalThis.fetch;process.env.BOT_TOKEN="safe-test-token";
const body=(patch:any={})=>({channel_type:"public",username:"safechannel",title:"Safe Channel",posts_per_day:1,audience_continents:[],categories:[],...patch});
async function invoke(payload:any,responses:any[]=[]){let i=0;globalThis.fetch=async()=>{const value=responses[i++]??{ok:true,result:{id:"-100",type:"channel",username:"safechannel"}};if(value instanceof Error)throw value;return new Response(JSON.stringify(value),{status:200})};const response=await POST(new Request("http://local/api/publisher/channels",{method:"POST",headers:{"content-type":"application/json","x-telegram-init-data":"safe"},body:JSON.stringify(payload)}));return{status:response.status,json:await response.json()}}
function safe(result:any,code:string,status:number){assert.equal(result.status,status);assert.equal(result.json.error.code,code);assert.equal(typeof result.json.error.message,"string");const text=JSON.stringify(result.json);for(const secret of["SELECT secret","session","API hash","access hash","+234","private invite","stack"])assert.equal(text.includes(secret),false)}

test("actual POST creates a public publisher channel",async()=>{queryMode="success";const result=await invoke(body(),[{ok:true,result:{id:"-100",type:"channel",username:"safechannel"}},{ok:true,result:250}]);assert.equal(result.status,200);assert.deepEqual(result.json,{success:true,id:77})});
test("actual POST returns stable safe responses for invalid and duplicate channels",async()=>{safe(await invoke(body({channel_type:"bad"})),"INVALID_CHANNEL",400);queryMode="exists";safe(await invoke(body(),[{ok:true,result:{id:"-100",type:"channel",username:"safechannel"}},{ok:true,result:250}]),"CHANNEL_ALREADY_EXISTS",409)});
test("actual POST handles public and private inaccessible channels",async()=>{queryMode="success";safe(await invoke(body(),[{ok:false,description:"private invite secret stack"}]),"CHANNEL_NOT_ACCESSIBLE",400);privateResult={ok:false,code:"channel_inaccessible"};safe(await invoke(body({channel_type:"private",invite_link:"https://t.me/+secret",username:null})),"CHANNEL_NOT_ACCESSIBLE",400)});
test("actual POST sanitizes Bot API timeout and MTProto auth/permission failures",async()=>{queryMode="success";safe(await invoke(body(),[new Error("timeout SQL session stack")]),"CHANNEL_NOT_ACCESSIBLE",400);privateResult=new Error("AUTH_KEY_UNREGISTERED API hash phone stack");safe(await invoke(body({channel_type:"private",invite_link:"https://t.me/+secret",username:null})),"CHANNEL_CREATE_FAILED",500);privateResult={ok:false,code:"join_request_required"};safe(await invoke(body({channel_type:"private",invite_link:"https://t.me/+secret",username:null})),"PERMISSION_REQUIRED",400)});
test("actual POST sanitizes unique-key, generic database, and hostile unexpected errors",async()=>{for(const mode of["unique","database"]){queryMode=mode;safe(await invoke(body(),[{ok:true,result:{id:"-100",type:"channel",username:"safechannel"}},{ok:true,result:250}]),"CHANNEL_CREATE_FAILED",500)}});
test.after(()=>{globalThis.fetch=originalFetch});
