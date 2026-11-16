import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import mysql from 'mysql2/promise';

const url=process.env.ADSGALAXY_BROADCAST_TEST_DATABASE_URL;
if(!url || new URL(url).hostname!=='127.0.0.1' || new URL(url).pathname!=='/adsgalaxy_broadcast_test')
  throw new Error('isolated full-schema database required');
const pool=mysql.createPool({uri:url,connectionLimit:4});

test('moderation cleanup waits for accepted click and completes after its debit',async()=>{
  let userId,channelId,campaignId,postId,clickId,debitId;
  try{
    const source=readFileSync(new URL('../src/app/api/cron/retry-telegram-cleanup/route.ts',import.meta.url),'utf8');
    const functionStart=source.indexOf('async function finalizeModerationCleanup()');
    const functionEnd=source.indexOf('\nexport async function GET',functionStart);
    assert.ok(functionStart>0&&functionEnd>functionStart);
    const sqlSource=readFileSync(new URL('../src/lib/channelSettlement.ts',import.meta.url),'utf8');
    const predicateStart=sqlSource.indexOf('export function unpaidAcceptedClickSql(');
    const predicateEnd=sqlSource.indexOf('\nexport async function recoverDeletedAcceptedEngagement',predicateStart);
    assert.ok(predicateStart>0&&predicateEnd>predicateStart);
    const compiled=ts.transpileModule(`${sqlSource.slice(predicateStart,predicateEnd)}\n${source.slice(functionStart,functionEnd)}\nexports.finalizeModerationCleanup=finalizeModerationCleanup;`,
      {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const module={exports:{}};
    vm.runInNewContext(compiled,{module,exports:module.exports,pool,
      isUnifiedSchemaReady:async()=>true,
      outstandingViewsSql:alias=>`GREATEST(COALESCE(${alias}.views,0)-COALESCE(${alias}.settled_views,0)-COALESCE((SELECT SUM(cvw.waived_views) FROM channel_view_waivers cvw WHERE cvw.post_id=${alias}.id),0),0)`});
    const {finalizeModerationCleanup}=module.exports;
    const [user]=await pool.query('INSERT INTO users (telegram_id,username) VALUES (?,?)',[String(Date.now()),`cleanup_fixture_${Date.now()}`]);
    userId=user.insertId;
    const [channel]=await pool.query('INSERT INTO channels (user_id) VALUES (?)',[userId]);
    channelId=channel.insertId;
    const [campaign]=await pool.query(`INSERT INTO campaigns
      (user_id,name,message_text,link,button_text,type,budget,total_budget,cpm,category,continents,status,pause_reason,approved_creative_revision_id)
      VALUES (?,'cleanup fixture','test','https://example.invalid','Open','clicks',10,10,1,'tech','["NA"]','paused','moderation_cleanup',1)`,[userId]);
    campaignId=campaign.insertId;
    const [post]=await pool.query(`INSERT INTO campaign_posts
      (campaign_id,channel_id,status,delivery_confirmed_at,deleted_at,billing_cutoff_at)
      VALUES (?,?,'deleted',DATE_SUB(NOW(6),INTERVAL 1 HOUR),NOW(6),NOW(6))`,[campaignId,channelId]);
    postId=post.insertId;
    const [click]=await pool.query(`INSERT INTO campaign_clicks (campaign_id,post_id,is_bot,accepted_at)
      VALUES (?,?,0,DATE_SUB(NOW(6),INTERVAL 1 SECOND))`,[campaignId,postId]);
    clickId=click.insertId;
    await finalizeModerationCleanup();
    let [[state]]=await pool.query('SELECT telegram_cleanup_status FROM campaigns WHERE id=?',[campaignId]);
    assert.notEqual(state.telegram_cleanup_status,'success');
    const [debit]=await pool.query(`INSERT INTO channel_advertiser_debits
      (source_key,settlement_type,campaign_id,post_id,channel_id,publisher_id,units,unit_price,advertiser_debit,publisher_status)
      VALUES (?,'click',?,?,?,?,1,1,1,'settled')`,[`click:${clickId}`,campaignId,postId,channelId,userId]);
    debitId=debit.insertId;
    await finalizeModerationCleanup();
    [[state]]=await pool.query('SELECT telegram_cleanup_status FROM campaigns WHERE id=?',[campaignId]);
    assert.equal(state.telegram_cleanup_status,'success');
  }finally{
    if(debitId)await pool.query('DELETE FROM channel_advertiser_debits WHERE id=?',[debitId]);
    if(clickId)await pool.query('DELETE FROM campaign_clicks WHERE id=?',[clickId]);
    if(postId)await pool.query('DELETE FROM campaign_posts WHERE id=?',[postId]);
    if(campaignId)await pool.query('DELETE FROM campaigns WHERE id=?',[campaignId]);
    if(channelId)await pool.query('DELETE FROM channels WHERE id=?',[channelId]);
    if(userId)await pool.query('DELETE FROM users WHERE id=?',[userId]);
    await pool.end();
  }
});
