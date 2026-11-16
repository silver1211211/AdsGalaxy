import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {test} from "node:test";
import mysql from "mysql2/promise";
import ts from "typescript";

const schema=`test_smart_cpm_${randomUUID().replaceAll("-","")}`;
const cfg={host:"127.0.0.1",port:53307,user:"root",multipleStatements:true};
function load(path,deps={}){const js=ts.transpileModule(readFileSync(path,"utf8"),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};new Function("module","exports","require","process",js)(mod,mod.exports,
    name=>deps[name]??{},process);return mod.exports;}
function migrate(file,success=true){const r=spawnSync("/usr/bin/mariadb",
  ["--no-defaults","-h","127.0.0.1","-P","53307","-u","root",schema],
  {input:readFileSync(file,"utf8"),encoding:"utf8"});assert.equal(r.status===0,success,r.stderr);}
const math=load("src/lib/channelAllocationMath.ts");
const policy=load("src/lib/channelPhase1FinancialPolicy.ts",{"@/lib/channelAllocationMath":math});
const service=load("src/lib/channelSmartReachDynamicCpm.ts",{
  "@/lib/channelPhase1FinancialPolicy":policy,"@/lib/channelAllocationMath":math,
  "@/lib/channelSmartReachConfiguration":{SMART_REACH_POLICY_VERSION:"adsgalaxy-smart-reach-v1"}});
async function value(db,sql){const [rows]=await db.query(sql);return rows[0];}

test("dynamic Smart Reach CPM uses qualified billed views, settled clicks and durable 30-minute evaluations",async t=>{
  const admin=await mysql.createConnection(cfg);let db;const old=process.env.CHANNEL_SMART_REACH_DYNAMIC_CPM_ENABLED;
  try{
    await admin.query(`CREATE DATABASE \`${schema}\``);db=mysql.createPool({...cfg,database:schema,connectionLimit:3});
    await db.query(`CREATE TABLE campaigns(id INT PRIMARY KEY,financial_policy_version VARCHAR(80),
      financial_billing_mode VARCHAR(40),status VARCHAR(30),smart_reach_effective_cpm DECIMAL(24,8),
      smart_reach_max_cpm DECIMAL(24,8),smart_reach_last_evaluated_at DATETIME(6)) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE channel_smart_reach_impression_billings(id INT PRIMARY KEY,campaign_id INT,
      billable_views INT,created_at DATETIME(6)) ENGINE=InnoDB`);
    await db.query("CREATE TABLE campaign_posts(id INT PRIMARY KEY,campaign_id INT,settled_clicks INT) ENGINE=InnoDB");
    await db.query(`INSERT INTO campaigns VALUES(1,'adsgalaxy-smart-reach-v1','smart_reach','active',
      0.10000000,0.50000000,NULL)`);
    await db.query("INSERT INTO channel_smart_reach_impression_billings VALUES(1,1,3000,UTC_TIMESTAMP(6)-INTERVAL 31 MINUTE)");
    await db.query("INSERT INTO campaign_posts VALUES(1,1,0)");
    await db.query(`INSERT INTO campaigns VALUES(2,'adsgalaxy-smart-reach-v1','smart_reach','active',
      0.20000000,0.50000000,NULL)`);
    await db.query("INSERT INTO channel_smart_reach_impression_billings VALUES(2,2,3000,UTC_TIMESTAMP(6)-INTERVAL 31 MINUTE)");
    await db.query("INSERT INTO campaign_posts VALUES(2,2,30)");
    migrate("db/migrations/20261114_1100_smart_reach_cpm_evaluations.sql");
    process.env.CHANNEL_SMART_REACH_DYNAMIC_CPM_ENABLED="true";
    await t.test("qualified low CTR increases one step and same-window retry is idempotent",async()=>{
      const first=await service.evaluateSmartReachDynamicCpm(db,1);
      assert.equal(first.nextCpm,"0.20000000");
      assert.equal((await service.evaluateSmartReachDynamicCpm(db,1)).status,"too_soon");
      assert.equal((await value(db,"SELECT COUNT(*) n FROM channel_smart_reach_cpm_evaluations")).n,1);
    });
    await t.test("verified CTR at 1% lowers the ceiling without changing old charges",async()=>{
      const result=await service.evaluateSmartReachDynamicCpm(db,2);
      assert.equal(result.nextCpm,"0.10000000");
      assert.equal((await value(db,"SELECT billable_views FROM channel_smart_reach_impression_billings")).billable_views,3000);
    });
    await t.test("disabled flag and guarded rollback preserve audit history",async()=>{
      delete process.env.CHANNEL_SMART_REACH_DYNAMIC_CPM_ENABLED;
      assert.equal((await service.evaluateSmartReachDynamicCpm(db,1)).status,"disabled");
      migrate("db/migrations/20261114_1100_smart_reach_cpm_evaluations.down.sql",false);
      await db.query("DELETE FROM channel_smart_reach_cpm_evaluations");
      migrate("db/migrations/20261114_1100_smart_reach_cpm_evaluations.down.sql");
    });
  }finally{old===undefined?delete process.env.CHANNEL_SMART_REACH_DYNAMIC_CPM_ENABLED:
    process.env.CHANNEL_SMART_REACH_DYNAMIC_CPM_ENABLED=old;
    if(db)await db.end();await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);await admin.end();}
});
