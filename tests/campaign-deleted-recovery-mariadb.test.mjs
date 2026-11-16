import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import mysql from 'mysql2/promise';

const supplied=process.env.ADSGALAXY_ACCEPTANCE_TEST_DATABASE_URL;
const skip=supplied?false:'isolated acceptance database is not configured';
let admin,db,schema,recoverDeletedAcceptedEngagement;
const billed=[];
before(async()=>{
  if(!supplied)return;
  const url=new URL(supplied);
  assert.equal(url.hostname,'127.0.0.1');
  assert.equal(url.port,'53307');
  assert.equal(url.pathname,'/adsgalaxy_acceptance_test');
  const cfg={host:url.hostname,port:Number(url.port),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password)};
  admin=await mysql.createConnection(cfg);
  schema=`test_recovery_${randomUUID().replaceAll('-','')}`;
  await admin.query(`CREATE DATABASE \`${schema}\``);
  db=mysql.createPool({...cfg,database:schema,connectionLimit:5});
  await db.query(`CREATE TABLE campaigns(id INT PRIMARY KEY,type VARCHAR(20),status VARCHAR(30),pause_reason VARCHAR(40),approved_creative_revision_id INT) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE campaign_posts(id INT PRIMARY KEY,campaign_id INT,channel_id INT,views INT,settled_views INT,settled_clicks INT,delivery_confirmed_at DATETIME(6),delivery_failed_at DATETIME(6),deleted_at DATETIME(6),billing_cutoff_at DATETIME(6),view_accepted_at DATETIME(6)) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE campaign_clicks(id INT PRIMARY KEY,post_id INT,campaign_id INT,is_bot TINYINT,accepted_at DATETIME(6)) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE channel_view_waivers(post_id INT,waived_views INT) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE channel_advertiser_debits(source_key VARCHAR(255) PRIMARY KEY) ENGINE=InnoDB`);
  await db.query("INSERT INTO campaigns VALUES(1,'clicks','paused','moderation_cleanup',7),(2,'views','paused','moderation_cleanup',7)");
  await db.query(`INSERT INTO campaign_posts VALUES
    (11,1,1,0,0,0,DATE_SUB(NOW(6),INTERVAL 1 HOUR),NULL,NOW(6),NOW(6),NULL),
    (12,2,1,100,50,0,DATE_SUB(NOW(6),INTERVAL 1 HOUR),NULL,NOW(6),NOW(6),DATE_SUB(NOW(6),INTERVAL 1 SECOND)),
    (13,2,1,100,50,0,DATE_SUB(NOW(6),INTERVAL 1 HOUR),NULL,NOW(6),NOW(6),DATE_ADD(NOW(6),INTERVAL 1 SECOND)),
    (14,1,1,0,0,0,DATE_SUB(NOW(6),INTERVAL 1 HOUR),NULL,NOW(6),NOW(6),NULL)`);
  await db.query(`INSERT INTO campaign_clicks VALUES
    (101,11,1,0,DATE_SUB(NOW(6),INTERVAL 1 SECOND)),
    (102,11,1,0,DATE_ADD(NOW(6),INTERVAL 1 SECOND)),
    (103,14,1,0,NULL)`);
  const source=readFileSync(new URL('../src/lib/channelSettlement.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};
  const paid=(kind,id,event)=>{billed.push({kind,id,event});return {debited:true,advertiserDebit:'1.00000000',publisherCredit:'0.60000000',platformRevenue:'0.30000000',reserveAmount:'0.10000000'};};
  vm.runInNewContext(compiled,{module:mod,exports:mod.exports,process,console,require:(name)=>{
    if(name==='@/lib/db')return {default:db};
    if(name==='@/lib/channelFastBilling')return {debitChannelClick:async(id,event)=>paid('click',id,event),debitConfirmedChannelViews:async(id,views)=>paid('view',id,views)};
    if(name==='@/lib/channelUnifiedSettlement')return {isUnifiedSchemaReady:async()=>false};
    if(name==='@/lib/channelViewWaivers')return {outstandingViewsSql:alias=>`GREATEST(COALESCE(${alias}.views,0)-COALESCE(${alias}.settled_views,0)-COALESCE((SELECT SUM(waived_views) FROM channel_view_waivers WHERE post_id=${alias}.id),0),0)`,waivedViewsForPostSql:()=> '0'};
    return {};
  }},{filename:'channelSettlement.js'});
  ({recoverDeletedAcceptedEngagement}=mod.exports);
});
after(async()=>{if(db)await db.end();if(admin){if(schema)await admin.query(`DROP DATABASE \`${schema}\``);await admin.end();}});

test('deleted recovery selects only accepted pre-cutoff CPC and CPM evidence', {skip},async()=>{
  const result=await recoverDeletedAcceptedEngagement({});
  assert.equal(result.candidates,2);
  assert.equal(result.settledPosts,2);
  assert.equal(result.failedDetails.length,0);
  assert.equal(billed.length,2);
  assert.ok(billed.some(item=>item.kind==='click'&&item.id===11&&item.event===101));
  assert.ok(billed.some(item=>item.kind==='view'&&item.id===12&&item.event===100));
  assert.ok(!billed.some(item=>item.event===102||item.id===13||item.id===14));
});
