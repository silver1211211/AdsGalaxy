import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
const require=createRequire(import.meta.url), ts=require('typescript');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');

// Execute the actual route and onboarding helpers. All I/O is in-memory;
// this suite must never connect to MariaDB or Telegram.
function fixture(options={}) {
  const state={channels:options.channels||[],claims:options.claims||[],queries:[],calls:[],logs:[],after:[],commits:0,rollbacks:0,insertCount:0,identity:41};
  let snapshot;
  async function query(sql,args=[]) {
    state.queries.push({sql,args});
    if(sql.startsWith('SELECT id,telegram_id,status FROM users'))return[[{id:41,telegram_id:'99123',status:options.banned?'banned':'active'}]];
    if(sql.includes('INFORMATION_SCHEMA'))return[[{ok:1}]];
    if(sql.startsWith('SELECT id, user_id'))return[state.channels.filter(c=>String(c.chat_id)===String(args[0]))];
    if(sql.startsWith('SELECT id,user_id'))return[state.channels.filter(c=>c.id===args[0])];
    if(sql.startsWith('SELECT channel_id,telegram_chat_id'))return[state.claims.filter(c=>c.channel_id===args[0]||c.telegram_chat_id===args[1])];
    if(sql.includes('SELECT c.id,c.user_id'))return[state.channels.filter(c=>state.claims.some(i=>i.channel_id===c.id&&i.telegram_chat_id===args[0]))];
    if(sql.startsWith('INSERT INTO channels')){
      state.insertCount++;
      const columns=sql.match(/\(([^)]+)\)/)[1].split(',').map(s=>s.trim());
      const row={id:77,is_deleted:0,...Object.fromEntries(columns.map((key,i)=>[key,args[i]]))};
      state.channels.push(row);return[{insertId:77}];
    }
    if(sql.includes('INSERT INTO channel_telegram_identities')){
      if(options.identityFailure)throw Object.assign(new Error('sensitive SQL secret'),{code:'ER_DUP_ENTRY'});
      state.claims.push({channel_id:args[0],telegram_chat_id:args[1]});return[{affectedRows:1}];
    }
    if(sql.startsWith('UPDATE channels')){const row=state.channels.find(c=>c.id===args.at(-1));row.is_deleted=0;row.status='pending';return[{affectedRows:1}];}
    return[[]];
  }
  const connection={query,beginTransaction:async()=>{snapshot=structuredClone({channels:state.channels,claims:state.claims});},commit:async()=>{state.commits++;},rollback:async()=>{state.rollbacks++;Object.assign(state,snapshot);},release(){}};
  const pool={query,getConnection:async()=>connection};
  const fakeProcess={env:{BOT_TOKEN:'test-only',PRIVATE_CHANNEL_VERIFICATION_SECRET:'test-only-signing-secret'}};
  const mocks={
    'next/server':{NextResponse:Response,after:fn=>{if(options.afterThrows)throw new Error('scheduler unavailable');state.after.push(fn);}},
    '@/lib/db':{default:pool},
    '@/lib/auth':{getAuthenticatedUserStatus:async()=>{if(options.authFailure)throw new Error('Unauthorized: invalid signature');return{id:state.identity};},getAuthErrorStatus:e=>String(e.message).startsWith('Unauthorized:')?401:500},
    '@/lib/productionSafety':{requireUserWritesAllowed:async()=>null},
    '@/lib/channelPrivacy':{inferChannelType:({channelType})=>channelType,getChannelPrivacySchema:async()=>({hasChannelType:true,hasInviteLinkHash:true,hasPrivateInviteLinkEncrypted:true,hasViewTrackingStatus:true}),hashInviteLink:()=> 'hashed',normalizePrivateInviteLink:v=>load('src/lib/telegramChannelInput.ts').normalizePrivateInviteLink(v),normalizePublicChannelUsername:v=>load('src/lib/telegramChannelInput.ts').normalizePublicChannelUsername(v)},
    '@/lib/telegramMtproto':{resolvePrivateInviteLink:async()=>options.privateFailure?{ok:false,code:options.privateFailure}:{ok:true,chatId:'-100123',title:'Private Channel',participantsCount:300}},
    '@/lib/privateInviteLinkVault':{encryptPrivateInviteLink:()=> 'encrypted'},
    '@/lib/privateChannelVerificationToken':{inspectPrivateChannelVerificationToken:()=>({valid:false}),createPrivateChannelVerificationToken:()=> 'test-signed-token'},
    '@/lib/privateChannelDiagnostics':{logPrivateChannelDiagnostic:()=>{}},
    '@/lib/publisherNotifications':{notifyChannelSubmitted:async()=>{if(options.followupFailure)throw new Error('secret notification');}},
    '@/lib/channelWelcomePost':{sendChannelWelcomePostIfNeeded:async()=>{}},
    '@/lib/supportMessages':{safeQueuePublisherWelcome:async()=>{}},
    '@/lib/policyRegistry':{MINIMUM_PUBLISHER_CHANNEL_SUBSCRIBERS:100},
    '@/lib/channelRefreshPolicy':{sanitizePublisherChannel:v=>v},
    '@/lib/dbResilience':{queryWithRetry:query,isTransientDatabaseError:e=>e.code==='ECONNRESET'},
    '@/lib/teaser':{validateTeaserDailyLimit:v=>v},
    '@/lib/telegramChannelAccess':{verifyTelegramChannelAccess:async()=>{if(options.followupFailure)throw new Error('secret health SQL');return{ok:true,state:'accessible'};}},
  };
  const cache=new Map();
  async function fetch(url,init){
    const method=url.split('/').at(-1), body=JSON.parse(init.body);state.calls.push({method,body,signal:init.signal});
    if(options.failureMethod===method){
      if(options.timeout)throw new DOMException('secret private invite','TimeoutError');
      return Response.json({ok:false,error_code:options.httpFailure,parameters:{retry_after:17}},{status:options.httpFailure});
    }
    let result;
    if(method==='getChat')result={id:options.chatId??-100123,type:options.chatType||'channel',title:options.title||'Human Readable Title',...(options.private?{}:{username:options.canonicalUsername||'testchannel'})};
    if(method==='getMe')result={id:555};
    if(method==='getChatMember')result=String(body.user_id)==='555'?(options.bot||{status:'administrator',can_post_messages:true,can_delete_messages:true,can_invite_users:true,can_edit_messages:true}):{status:options.publisherRole||'creator'};
    if(method==='getChatMemberCount')result=options.count??300;
    return Response.json({ok:true,result});
  }
  function load(path){
    if(cache.has(path))return cache.get(path);
    const loadedModule={exports:{}};cache.set(path,loadedModule.exports);
    const output=ts.transpileModule(readFileSync(resolve(root,path),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
    const localRequire=id=>{
      if(mocks[id])return {__esModule:true,...mocks[id]};
      if(id.startsWith('@/'))return load(`src/${id.slice(2)}.ts`);
      if(id.startsWith('.'))return load(resolve(dirname(path),id)+'.ts');
      return require(id);
    };
    vm.runInNewContext(output,{module:loadedModule,exports:loadedModule.exports,require:localRequire,process:fakeProcess,fetch,Response,Request,Headers,AbortSignal,URL,Set,Date,console:{info:v=>state.logs.push(v),warn(){},error(){}},Buffer,setTimeout,clearTimeout});
    cache.set(path,loadedModule.exports);return loadedModule.exports;
  }
  const payload={channel_type:options.private?'private':'public',username:options.private?null:'https://t.me/testchannel',chat_id:'-999999',title:'Valid Title',audience_continents:['africa'],categories:['tech'],posts_per_day:1,...(options.private?{invite_link:'https://t.me/+privateSECRET'}:{})};
  async function invoke(patch={},headers={}){
    const response=await load('src/app/api/publisher/channels/route.ts').POST(new Request('https://adsgalaxy.online/api/publisher/channels',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({...payload,...patch})}));
    return{response,status:response.status,json:await response.json()};
  }
  return{state,load,invoke};
}
const existing=(user=41,deleted=0)=>({id:9,user_id:user,chat_id:'-100123',is_deleted:deleted,status:'active'});
test('A/F/K/Q: actual public registration persists canonical identity atomically',async()=>{
  const f=fixture(),r=await f.invoke();assert.equal(r.status,200);assert.equal(r.json.success,true);assert.equal(f.state.commits,1);assert.equal(f.state.channels[0].chat_id,'-100123');assert.equal(f.state.channels[0].status,'pending');assert.equal(f.state.claims[0].telegram_chat_id,'-100123');assert.equal(f.state.calls[0].body.chat_id,'@testchannel');
});
test('B/T: private flow works without public username; no invite logged',async()=>{const f=fixture({private:true}),r=await f.invoke();assert.equal(r.status,200);assert.equal(f.state.channels[0].username,null);assert.equal(f.state.channels[0].channel_type,'private');assert.equal(f.state.logs.join('').includes('privateSECRET'),false);});
for(const role of ['creator','administrator'])test(`C: publisher ${role} accepted using DB Telegram identity`,async()=>{const f=fixture({publisherRole:role});assert.equal((await f.invoke()).status,200);assert.ok(f.state.calls.some(c=>c.method==='getChatMember'&&c.body.user_id==='99123'));});
for(const role of ['member','left','restricted'])test(`D/U: publisher ${role} cannot attach channel`,async()=>{const f=fixture({publisherRole:role});assert.equal((await f.invoke()).status,403);assert.equal(f.state.insertCount,0);});
for(const bot of [{status:'left'},{status:'administrator',can_post_messages:true},{status:'administrator',can_delete_messages:true}])test(`E: bot rights rejected ${JSON.stringify(bot)}`,async()=>{const f=fixture({bot}),r=await f.invoke();assert.equal(r.status,400);assert.equal(r.json.code,'PERMISSION_REQUIRED');assert.equal(f.state.insertCount,0);});
test('private bot must have invite permission',async()=>{const f=fixture({private:true,bot:{status:'administrator',can_post_messages:true,can_delete_messages:true}});assert.equal((await f.invoke()).status,400);});
test('G/M: same publisher retry returns same channel, no duplicate',async()=>{const f=fixture();const first=await f.invoke();const next=await f.invoke();assert.equal(first.json.id,next.json.id);assert.equal(next.json.already_registered,true);assert.equal(f.state.insertCount,1);});
test('H: another publisher cannot claim stable chat ID',async()=>{const f=fixture({channels:[existing(72)]}),r=await f.invoke();assert.equal(r.status,409);assert.equal(r.json.code,'CHANNEL_OWNED_BY_ANOTHER_PUBLISHER');assert.equal(f.state.insertCount,0);});
test('legacy duplicate identities fail closed instead of selecting arbitrary owner',async()=>{const f=fixture({channels:[existing(),existing(72)]});assert.equal((await f.invoke()).status,409);});
test('I/J: @username and t.me variants resolve using normalized name',async()=>{for(const username of ['@testchannel','https://t.me/testchannel','testchannel']){const f=fixture();assert.equal((await f.invoke({username})).status,200);assert.equal(f.state.calls[0].body.chat_id,'@testchannel');}});
test('K: changed public username keeps stable channel identity',async()=>{const f=fixture({channels:[existing()],canonicalUsername:'renamedchannel'});const r=await f.invoke({username:'renamedchannel'});assert.equal(r.json.id,9);assert.equal(f.state.insertCount,0);});
test('L/N: Telegram timeout returns retryable 503 with zero persistence',async()=>{const f=fixture({failureMethod:'getChat',timeout:true}),r=await f.invoke();assert.equal(r.status,503);assert.equal(r.json.retryable,true);assert.equal(f.state.insertCount,0);assert.equal(JSON.stringify(r.json).includes('secret'),false);assert.ok(f.state.calls[0].signal);});
test('O: Telegram 429 preserves retry-after; no insert',async()=>{const f=fixture({failureMethod:'getChatMember',httpFailure:429}),r=await f.invoke();assert.equal(r.status,429);assert.equal(r.response.headers.get('retry-after'),'17');assert.equal(f.state.insertCount,0);});
test('private timeout/rate limit are retryable, not permanent invalid-channel rejection',async()=>{for(const code of ['verification_timeout','network_error','rate_limited']){const f=fixture({private:true,privateFailure:code}),r=await f.invoke();assert.equal(r.status,code==='rate_limited'?429:503);assert.equal(f.state.insertCount,0);}});
test('P: signed-session identity remains internal users.id, not Telegram ID',async()=>{const f=fixture();await f.invoke({user_id:72,telegram_id:999});assert.deepEqual(Array.from(f.state.queries.find(q=>q.sql.startsWith('SELECT id,telegram_id')).args),[41]);assert.equal(f.state.channels[0].user_id,41);});
test('P/U: invalid authentication, banned accounts and cross-site writes rejected',async()=>{for(const opts of [{authFailure:true},{banned:true},{}]){const f=fixture(opts);const r=await f.invoke({},Object.keys(opts).length?{}:{origin:'https://evil.example'});assert.ok([401,403].includes(r.status));assert.equal(f.state.insertCount,0);}});
test('Q: identity claim failure rolls back channel insert',async()=>{const f=fixture({identityFailure:true}),r=await f.invoke();assert.equal(r.status,500);assert.equal(f.state.rollbacks,1);assert.equal(f.state.channels.length,0);});
test('R: postcommit health/notification failures cannot change successful response',async()=>{const f=fixture({followupFailure:true}),r=await f.invoke();assert.equal(r.status,200);for(const task of f.state.after)await task();assert.equal(f.state.channels.length,1);assert.equal(f.state.rollbacks,0);});
test('R: after scheduling failure cannot turn committed write into error',async()=>{const f=fixture({afterThrows:true});assert.equal((await f.invoke()).status,200);});
test('V: deleted same-owner channel reactivated with atomic identity claim',async()=>{const f=fixture({channels:[existing(41,1)]}),r=await f.invoke();assert.equal(r.status,200);assert.equal(r.json.id,9);assert.equal(f.state.channels[0].is_deleted,0);assert.equal(f.state.channels[0].status,'pending');assert.equal(f.state.commits,1);assert.equal(f.state.claims[0].channel_id,9);});
test('V: identity collision rolls back reactivation',async()=>{const f=fixture({channels:[existing(41,1)],claims:[{channel_id:88,telegram_chat_id:'-100123'}]});assert.equal((await f.invoke()).status,409);assert.equal(f.state.channels[0].is_deleted,1);});
test('untrusted subscriber count cannot bypass minimum or unavailable Telegram count',async()=>{for(const options of [{count:1},{failureMethod:'getChatMemberCount',httpFailure:503}]){const f=fixture(options);const r=await f.invoke({subscriber_count:999999});assert.ok([400,503].includes(r.status));assert.equal(f.state.insertCount,0);}});
test('malformed Telegram identity and non-channel rejected',async()=>{for(const options of [{chatId:'garbage'},{chatType:'supergroup'}]){const f=fixture(options);assert.ok((await f.invoke()).status>=400);assert.equal(f.state.insertCount,0);}});
test('preview requires ownership for public and private channels',async()=>{for(const privateChannel of [false,true]){const f=fixture({private:privateChannel,publisherRole:'member'}),route=f.load('src/app/api/telegram/chat-info/route.ts');const req=new Request('https://adsgalaxy.online/api/telegram/chat-info?username=testchannel',{method:privateChannel?'POST':'GET',...(privateChannel?{body:JSON.stringify({invite_link:'https://t.me/+privateSECRET'})}:{})});assert.equal((await route[privateChannel?'POST':'GET'](req)).status,403);}});
test('preview public/private success returns frontend contract',async()=>{for(const privateChannel of [false,true]){const f=fixture({private:privateChannel}),route=f.load('src/app/api/telegram/chat-info/route.ts');const req=new Request('https://adsgalaxy.online/api/telegram/chat-info?username=testchannel',{method:privateChannel?'POST':'GET',...(privateChannel?{body:JSON.stringify({invite_link:'https://t.me/+privateSECRET'})}:{})});const r=await route[privateChannel?'POST':'GET'](req),body=await r.json();assert.equal(r.status,200);assert.equal(body.id,-100123);assert.equal(body.permissions.is_admin,true);if(privateChannel)assert.ok(body.verification_token);}});
test('S: all three UI submit paths accept HTTP success and protect repeat clicks',()=>{for(const path of ['src/app/publisher/monetize/page.tsx','src/components/publisher/AddChannelScreen.tsx','src/components/publisher/AddChannelForm.tsx']){const source=readFileSync(resolve(root,path),'utf8');assert.match(source,/if \(!res.ok\)/);assert.match(source,/onSuccess\(\)/);assert.match(source,/if \(isLoading/);assert.match(source,/timeoutMs: 60000/);}});
