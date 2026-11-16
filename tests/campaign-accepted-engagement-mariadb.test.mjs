import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import mysql from 'mysql2/promise';
import { isBillablePublishedPlacement } from '../src/lib/campaignCreativeRevision.ts';

const supplied = process.env.ADSGALAXY_ACCEPTANCE_TEST_DATABASE_URL;
const skip = supplied ? false : 'isolated acceptance database is not configured';
let admin, db, schema, acceptChannelCampaignClick, hasAcceptedPreCutoffClick;

before(async () => {
  if (!supplied) return;
  const url = new URL(supplied);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '53307');
  assert.equal(url.pathname, '/adsgalaxy_acceptance_test');
  const connection = {host:url.hostname,port:Number(url.port),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password)};
  admin = await mysql.createConnection(connection);
  schema = `test_accept_${randomUUID().replaceAll('-','')}`;
  await admin.query(`CREATE DATABASE \`${schema}\``);
  db = mysql.createPool({...connection,database:schema,connectionLimit:8});
  await db.query(`CREATE TABLE campaigns (
    id BIGINT PRIMARY KEY,status VARCHAR(40),pause_reason VARCHAR(40),status_before_creative_review VARCHAR(40),
    approved_creative_revision_id BIGINT,pending_creative_revision_id BIGINT,campaign_kind VARCHAR(40),link TEXT
  ) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE campaign_posts (
    id BIGINT PRIMARY KEY,campaign_id BIGINT,status VARCHAR(40),delivery_confirmed_at DATETIME(6),
    delivery_failed_at DATETIME(6),deleted_at DATETIME(6),billing_cutoff_at DATETIME(6),approved_destination_url TEXT
  ) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE campaign_clicks (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,campaign_id BIGINT,post_id BIGINT,ip_address VARCHAR(64),
    user_agent VARCHAR(255),fingerprint CHAR(32),is_bot TINYINT,accepted_at DATETIME(6),
    created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),KEY ix_accept(post_id,accepted_at,id)
  ) ENGINE=InnoDB`);
  await db.query(`INSERT INTO campaigns VALUES (1,'pending',NULL,'active',7,8,'standard','https://unapproved.example')`);
  await db.query(`INSERT INTO campaign_posts VALUES (11,1,'active',NOW(6),NULL,NULL,NULL,'https://approved.example')`);
  const source = readFileSync(new URL('../src/lib/channelAcceptedEngagement.ts',import.meta.url),'utf8');
  const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module = {exports:{}};
  vm.runInNewContext(compiled,{module,exports:module.exports,require:(name)=>{
    if(name==='@/lib/campaignCreativeRevision')return {isBillablePublishedPlacement};
    throw new Error(`unexpected import ${name}`);
  }}, {filename:'channelAcceptedEngagement.js'});
  ({acceptChannelCampaignClick,hasAcceptedPreCutoffClick}=module.exports);
});

after(async () => {
  if(db) await db.end();
  if(admin){if(schema) await admin.query(`DROP DATABASE \`${schema}\``);await admin.end();}
});

const input = (fingerprint,postId=11) => ({campaignId:1,postId,ip:'127.0.0.1',userAgent:'test-browser',fingerprint,isBot:false});
async function confirmDeletedPost(postId){
  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    await conn.query('SELECT id FROM campaigns WHERE id=1 FOR UPDATE');
    await conn.query('SELECT id FROM campaign_posts WHERE id=? FOR UPDATE',[postId]);
    await conn.query("UPDATE campaign_posts SET status='deleted',deleted_at=NOW(6),billing_cutoff_at=NOW(6) WHERE id=?",[postId]);
    await conn.commit();
  }catch(error){await conn.rollback();throw error;}
  finally{conn.release();}
}

test('pending edit accepts only the old approved live placement and records server time', {skip}, async()=>{
  const accepted = await acceptChannelCampaignClick(db,input('a'.repeat(32)));
  assert.ok(accepted?.isNew);
  const [[row]]=await db.query('SELECT accepted_at FROM campaign_clicks WHERE id=?',[accepted.id]);
  assert.ok(row.accepted_at instanceof Date);
  const duplicate=await acceptChannelCampaignClick(db,input('a'.repeat(32)));
  assert.equal(duplicate?.id,accepted.id);
  assert.equal(duplicate?.isNew,false);
  const [[count]]=await db.query('SELECT COUNT(*) n FROM campaign_clicks');
  assert.equal(count.n,1);
});

test('click committed before deletion survives cutoff; new click after deletion is rejected', {skip}, async()=>{
  const accepted=await acceptChannelCampaignClick(db,input('b'.repeat(32)));
  assert.ok(accepted?.isNew);
  await db.query("UPDATE campaigns SET status='paused',pause_reason='moderation_cleanup',pending_creative_revision_id=NULL WHERE id=1");
  await confirmDeletedPost(11);
  assert.equal(await hasAcceptedPreCutoffClick(db,{campaignId:1,postId:11,clickId:accepted.id}),true);
  assert.equal(await acceptChannelCampaignClick(db,input('c'.repeat(32))),null);
  const [[count]]=await db.query('SELECT COUNT(*) n FROM campaign_clicks');
  assert.equal(count.n,2);
});

test('historical click with no acceptance time cannot be billed after deletion', {skip}, async()=>{
  await db.query("INSERT INTO campaign_clicks(campaign_id,post_id,ip_address,user_agent,fingerprint,is_bot,accepted_at) VALUES (1,11,'127.0.0.1','old',?,0,NULL)",['d'.repeat(32)]);
  const [[row]]=await db.query('SELECT LAST_INSERT_ID() id');
  assert.equal(await hasAcceptedPreCutoffClick(db,{campaignId:1,postId:11,clickId:row.id}),false);
});

test('concurrent acceptance commits before deletion cutoff when it holds the post lock', {skip}, async()=>{
  await db.query("UPDATE campaigns SET status='pending',pause_reason=NULL,pending_creative_revision_id=8 WHERE id=1");
  await db.query("INSERT INTO campaign_posts VALUES (12,1,'active',NOW(6),NULL,NULL,NULL,'https://approved.example')");
  let release;
  const held=new Promise(resolve=>{release=resolve;});
  let locked;
  const lockedPromise=new Promise(resolve=>{locked=resolve;});
  const wrapped={getConnection:async()=>{
    const conn=await db.getConnection();
    const original=conn.query.bind(conn);
    conn.query=async (sql,...params)=>{
      const result=await original(sql,...params);
      if(String(sql).includes('FROM campaign_posts WHERE id=? AND campaign_id=? FOR UPDATE')){
        locked();
        await held;
      }
      return result;
    };
    return conn;
  }};
  const accepting=acceptChannelCampaignClick(wrapped,input('e'.repeat(32),12));
  await lockedPromise;
  let deletionFinished=false;
  const deleting=confirmDeletedPost(12)
    .then(()=>{deletionFinished=true;});
  await new Promise(resolve=>setTimeout(resolve,80));
  assert.equal(deletionFinished,false);
  release();
  const accepted=await accepting;
  await deleting;
  assert.ok(accepted?.isNew);
  assert.equal(await hasAcceptedPreCutoffClick(db,{campaignId:1,postId:12,clickId:accepted.id}),true);
});

test('deletion that locks first makes a concurrent new click ineligible', {skip}, async()=>{
  await db.query("INSERT INTO campaign_posts VALUES (13,1,'active',NOW(6),NULL,NULL,NULL,'https://approved.example')");
  const deleting=await db.getConnection();
  try{
    await deleting.beginTransaction();
    await deleting.query('SELECT id FROM campaigns WHERE id=1 FOR UPDATE');
    await deleting.query('SELECT id FROM campaign_posts WHERE id=13 FOR UPDATE');
    await deleting.query("UPDATE campaign_posts SET status='deleted',deleted_at=NOW(6),billing_cutoff_at=NOW(6) WHERE id=13");
    let finished=false;
    const accepting=acceptChannelCampaignClick(db,input('f'.repeat(32),13)).then(value=>{finished=true;return value;});
    await new Promise(resolve=>setTimeout(resolve,80));
    assert.equal(finished,false);
    await deleting.commit();
    assert.equal(await accepting,null);
    const [[count]]=await db.query('SELECT COUNT(*) n FROM campaign_clicks WHERE post_id=13');
    assert.equal(count.n,0);
  }finally{await deleting.rollback().catch(()=>{});deleting.release();}
});

test('live Channel Growth invite click is accepted without CPC billing entitlement', {skip}, async()=>{
  await db.query("INSERT INTO campaigns VALUES (2,'active',NULL,NULL,NULL,NULL,'channel_growth','https://t.me/channel')");
  await db.query("INSERT INTO campaign_posts VALUES (21,2,'active',NOW(6),NULL,NULL,NULL,NULL)");
  const growth={...input('g'.repeat(32),21),campaignId:2};
  const accepted=await acceptChannelCampaignClick(db,growth);
  assert.equal(accepted?.isNew,true);
  const duplicate=await acceptChannelCampaignClick(db,growth);
  assert.equal(duplicate?.id,accepted.id);
  assert.equal(duplicate?.isNew,false);
  const [[row]]=await db.query('SELECT campaign_id,post_id,accepted_at FROM campaign_clicks WHERE id=?',[accepted.id]);
  assert.equal(row.campaign_id,2);
  assert.equal(row.post_id,21);
  assert.ok(row.accepted_at instanceof Date);
});
