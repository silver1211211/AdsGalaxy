import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import mysql from 'mysql2/promise';
import ts from 'typescript';
import dotenv from 'dotenv';

const env = dotenv.parse(fs.readFileSync('.env'));
const schema = `test_adsfusion_refund_${process.pid}`;
const load = (file, modules) => {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const record = { exports: {} };
  new Function('require', 'module', 'exports', output)((name) => {
    if (!(name in modules)) throw Error(`unexpected import ${name}`);
    return modules[name];
  }, record, record.exports);
  return record.exports;
};
const amounts = load('src/lib/withdrawalAmount.ts', {});
const context = load('src/lib/financialPostingContext.ts', {});
const recovery = load('src/lib/withdrawalRefundRecovery.ts', {
  './db': { default: {} }, './withdrawalAmount': amounts,
  './financialPostingContext': context,
});

test('approved recovery is transactional, exact, and idempotent in an isolated MariaDB schema', async (t) => {
  const admin = await mysql.createConnection({
    host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER,
    password: env.DB_PASS,
  });
  let created = false;
  let pool;
  try {
    assert.match(schema, /^test_adsfusion_refund_[0-9]+$/);
    try {
      await admin.query(`CREATE DATABASE ${schema}`);
      created = true;
    } catch (error) {
      if (error?.code === 'ER_DBACCESS_DENIED_ERROR' || error?.code === 'ER_SPECIFIC_ACCESS_DENIED_ERROR') {
        t.skip('DB account cannot create a disposable test schema');
        return;
      }
      throw error;
    }
    pool = mysql.createPool({
      host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER,
      password: env.DB_PASS, database: schema, connectionLimit: 4,
    });
    await pool.query(`CREATE TABLE users (
      id INT PRIMARY KEY,balance_available DECIMAL(20,8) NOT NULL,balance_locked DECIMAL(20,8) NOT NULL
    ) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE withdrawals (
      id INT PRIMARY KEY,user_id INT NOT NULL,amount DECIMAL(20,8) NOT NULL,
      idempotency_key VARCHAR(191),status VARCHAR(32) NOT NULL,refunded TINYINT NOT NULL DEFAULT 0,
      paid_out TINYINT NOT NULL DEFAULT 0,paid_at DATETIME NULL,updated_at DATETIME NULL
    ) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE publisher_balance_events (
      id INT AUTO_INCREMENT PRIMARY KEY,user_id INT NOT NULL,source_system VARCHAR(64),
      source_event_key VARCHAR(191) NOT NULL UNIQUE,source_record_id VARCHAR(128),
      delta_available DECIMAL(20,8) NOT NULL,delta_locked DECIMAL(20,8) NOT NULL
    ) ENGINE=InnoDB`);
    await pool.query(`CREATE TRIGGER test_refund_balance_event AFTER UPDATE ON users FOR EACH ROW
      INSERT INTO publisher_balance_events
        (user_id,source_system,source_event_key,source_record_id,delta_available,delta_locked)
      VALUES (NEW.id,@adsgalaxy_financial_source_system,@adsgalaxy_financial_source_key,
        @adsgalaxy_financial_source_record_id,NEW.balance_available-OLD.balance_available,
        NEW.balance_locked-OLD.balance_locked)`);

    async function fixture(id, amount, available, locked, pending = null) {
      await pool.query('INSERT INTO users VALUES (?,?,?)', [id, available, locked]);
      await pool.query('INSERT INTO withdrawals (id,user_id,amount,idempotency_key,status) VALUES (?,?,?,?,?)',
        [id,id,amount,`fixture-key-${id}`,'rejected']);
      await pool.query('INSERT INTO publisher_balance_events (user_id,source_system,source_event_key,source_record_id,delta_available,delta_locked) VALUES (?,?,?,?,?,?)',
        [id,'withdrawal_request',`withdrawal:reserve:fixture-key-${id}`,`fixture-key-${id}`,`-${amount}`,amount]);
      if (pending) await pool.query('INSERT INTO withdrawals (id,user_id,amount,status) VALUES (?,?,?,?)', [id+1000,id,pending,'pending']);
    }
    const approve = (withdrawalId, expectedMissing) => ({
      withdrawalId,expectedMissing,approvalReference:`fixture-approval-${withdrawalId}`,
      externalPaymentCleared:true,
    });

    await fixture(1,'0.50000000','0.00000000','0.50000000');
    assert.equal((await recovery.dryRunWithdrawalRefund(1,pool)).missing,'0.50000000');
    assert.equal((await recovery.applyOwnerApprovedRefundRecovery(approve(1,'0.50000000'),pool)).state,'already_restored');
    const [[one]] = await pool.query('SELECT balance_available,balance_locked FROM users WHERE id=1');
    assert.deepEqual([one.balance_available,one.balance_locked],['0.50000000','0.00000000']);
    await assert.rejects(recovery.applyOwnerApprovedRefundRecovery(approve(1,'0.50000000'),pool),/refund_evidence_changed/);
    const [[oneEvents]] = await pool.query("SELECT COUNT(*) n FROM publisher_balance_events WHERE source_system='withdrawal_refund_recovery' AND user_id=1");
    assert.equal(oneEvents.n,1);

    await fixture(2,'10.00000000','4.25000000','5.75000000');
    await pool.query('INSERT INTO publisher_balance_events (user_id,source_system,source_event_key,source_record_id,delta_available,delta_locked) VALUES (?,?,?,?,?,?)',
      [2,'withdrawal_refund','withdrawal:refund:2','2','4.25000000','-4.25000000']);
    assert.equal((await recovery.applyOwnerApprovedRefundRecovery(approve(2,'5.75000000'),pool)).state,'already_restored');
    const [[two]] = await pool.query('SELECT balance_available,balance_locked FROM users WHERE id=2');
    assert.deepEqual([two.balance_available,two.balance_locked],['10.00000000','0.00000000']);

    await fixture(3,'10.00000000','0.00000000','10.00000000','1.00000000');
    assert.equal((await recovery.dryRunWithdrawalRefund(3,pool)).state,'manual_review');
    await assert.rejects(recovery.applyOwnerApprovedRefundRecovery(approve(3,'10.00000000'),pool),/refund_evidence_changed/);

    await fixture(4,'50.00000000','0.00000000','50.00000000');
    await pool.query('UPDATE withdrawals SET paid_out=1 WHERE id=4');
    assert.equal((await recovery.dryRunWithdrawalRefund(4,pool)).state,'manual_review');

    await fixture(5,'10.00000000','0.00000000','10.00000000');
    const outcomes = await Promise.allSettled([
      recovery.applyOwnerApprovedRefundRecovery(approve(5,'10.00000000'),pool),
      recovery.applyOwnerApprovedRefundRecovery(approve(5,'10.00000000'),pool),
    ]);
    assert.equal(outcomes.filter((result) => result.status==='fulfilled').length,1);
    const [[five]] = await pool.query('SELECT balance_available,balance_locked FROM users WHERE id=5');
    assert.deepEqual([five.balance_available,five.balance_locked],['10.00000000','0.00000000']);

    await fixture(6,'10.00000000','0.00000000','10.00000000');
    await pool.query('INSERT INTO publisher_balance_events (user_id,source_system,source_event_key,source_record_id,delta_available,delta_locked) VALUES (?,?,?,?,?,?)',
      [6,'unrelated','withdrawal:refund-recovery:6','unrelated','0.00000000','0.00000000']);
    await assert.rejects(recovery.applyOwnerApprovedRefundRecovery(approve(6,'10.00000000'),pool));
    const [[six]] = await pool.query('SELECT balance_available,balance_locked FROM users WHERE id=6');
    assert.deepEqual([six.balance_available,six.balance_locked],['0.00000000','10.00000000']);
  } finally {
    if (pool) await pool.end();
    if (created) await admin.query(`DROP DATABASE ${schema}`);
    await admin.end();
  }
});

