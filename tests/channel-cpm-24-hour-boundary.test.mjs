import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({path:'.env',quiet:true});

const source=fs.readFileSync('src/lib/postingTimes.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const posting={exports:{}};
new Function('module','exports',js)(posting,posting.exports);

test('publisher settings retain 48 half-hour choices and 1–3 daily posts',()=>{
  const {POSTING_TIME_OPTIONS,normalizePostsPerDay,normalizePostingTimes}=posting.exports;
  assert.equal(POSTING_TIME_OPTIONS.length,48);
  assert.deepEqual([POSTING_TIME_OPTIONS[0],POSTING_TIME_OPTIONS.at(-1)],['00:00','23:30']);
  assert.deepEqual(normalizePostingTimes(['18:00','06:30','12:00'],3),['06:30','12:00','18:00']);
  assert.equal(normalizePostsPerDay(1),1);assert.equal(normalizePostsPerDay(3),3);
  assert.throws(()=>normalizePostsPerDay(0));assert.throws(()=>normalizePostsPerDay(4));
  assert.throws(()=>normalizePostingTimes(['12:15'],1));
});

test('disposable MariaDB checks exact 24-hour expiry from successful delivery',async()=>{
  const schema='test_cpm_24h_'+Date.now();
  assert.match(schema,/^test_cpm_24h_\d+$/);
  const quote=x=>'`'+x+'`';
  const opts={host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASS};
  const admin=await mysql.createConnection({...opts,database:process.env.DB_NAME});
  let db,created=false;
  try{
    await admin.query('CREATE DATABASE '+quote(schema));created=true;
    db=await mysql.createConnection({...opts,database:schema});
    await db.query('CREATE TABLE campaign_posts (id INT PRIMARY KEY,created_at DATETIME,delivery_confirmed_at DATETIME,views INT,settled_views INT,status VARCHAR(20)) ENGINE=InnoDB');
    await db.query("INSERT INTO campaign_posts VALUES (1,'2026-11-02 17:00:00','2026-11-02 18:01:00',1000,1000,'active'),(2,'2026-11-02 17:00:00','2026-11-02 18:00:00',1000,1000,'active'),(3,'2026-11-02 17:00:00','2026-11-02 17:59:00',1400,1000,'active'),(4,'2026-11-02 17:00:00','2026-11-02 17:59:00',1900,1900,'active')");
    const [rows]=await db.query("SELECT id, COALESCE(delivery_confirmed_at,created_at)<=DATE_SUB('2026-11-03 18:00:00',INTERVAL 24 HOUR) age_due, COALESCE(views,0)<=COALESCE(settled_views,0) fully_accounted FROM campaign_posts ORDER BY id");
    assert.deepEqual(rows.map(r=>[r.id,r.age_due,r.fully_accounted]),[[1,0,1],[2,1,1],[3,1,0],[4,1,1]]);
    const deletion=fs.readFileSync('src/lib/campaignPostDeletion.ts','utf8');
    assert.match(deletion,/COALESCE\(cp\.delivery_confirmed_at, cp\.created_at\)/);
    assert.match(deletion,/DATE_SUB\(NOW\(\), INTERVAL \? HOUR\)/);
    assert.match(deletion,/COALESCE\(cp\.views, 0\) <= COALESCE\(cp\.settled_views, 0\)/);
  }finally{
    if(db)await db.end();
    if(created)await admin.query('DROP DATABASE '+quote(schema));
    await admin.end();
  }
});
