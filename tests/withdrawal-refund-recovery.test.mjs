import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const amountSource = fs.readFileSync('src/lib/withdrawalAmount.ts', 'utf8');
const amountModule = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(amountSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(() => { throw Error('unexpected amount import'); }, amountModule, amountModule.exports);

const source = fs.readFileSync('src/lib/withdrawalRefundRecovery.ts', 'utf8');
const recoveryModule = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)((name) => {
  if (name === './withdrawalAmount') return amountModule.exports;
  if (name === './db') return { default: {} };
  if (name === './financialPostingContext') return { withFinancialPostingContext: async (_db, _ctx, action) => action() };
  throw Error(`unexpected import ${name}`);
}, recoveryModule, recoveryModule.exports);
const { assessWithdrawalRefund } = recoveryModule.exports;

const event = (key, available, locked) => ({ source_event_key: key, delta_available: available, delta_locked: locked });
function evidence(amount = '0.50000000', changes = {}) {
  return {
    id: 81, user_id: 123, amount, status: 'rejected', refunded: 0, paid_out: 0,
    paid_at: null, balance_locked: '100.00000000', other_pending: '0.00000000',
    requests: [event('withdrawal:request:81', `-${amount}`, amount)], refunds: [],
    ...changes,
  };
}

test('correctly refunded 0.50 is a no-op', () => {
  const e = evidence('0.50000000', { refunded: 1, refunds: [event('withdrawal:refund:81', '0.50000000', '-0.50000000')] });
  assert.deepEqual([assessWithdrawalRefund(e).state, assessWithdrawalRefund(e).missing], ['already_restored', '0.00000000']);
});
test('missing 0.50 has exact proposed amount', () => {
  assert.equal(assessWithdrawalRefund(evidence()).missing, '0.50000000');
});
test('missing 10 has exact proposed amount', () => {
  assert.equal(assessWithdrawalRefund(evidence('10.00000000')).missing, '10.00000000');
});
test('50 remains a valid reservation amount for recovery', () => {
  assert.equal(assessWithdrawalRefund(evidence('50.00000000')).state, 'eligible_after_owner_approval');
});
test('partial refund proposes only the outstanding amount', () => {
  const e = evidence('10.00000000', { refunds: [event('withdrawal:refund:81', '4.25000000', '-4.25000000')] });
  assert.equal(assessWithdrawalRefund(e).missing, '5.75000000');
});
test('refund flag without full event evidence cannot authorize another credit', () => {
  assert.equal(assessWithdrawalRefund(evidence('10.00000000', { refunded: 1 })).state, 'manual_review');
});
test('duplicate refund event keys are blocked', () => {
  const e = evidence('10.00000000', { refunds: [event('same', '1.00000000', '-1.00000000'), event('same', '1.00000000', '-1.00000000')] });
  assert.equal(assessWithdrawalRefund(e).state, 'manual_review');
});
test('incorrect refund ledger deltas are blocked', () => {
  const e = evidence('10.00000000', { refunds: [event('bad', '2.00000000', '-1.00000000')] });
  assert.equal(assessWithdrawalRefund(e).state, 'manual_review');
});
test('paid or potentially paid withdrawal is blocked', () => {
  assert.equal(assessWithdrawalRefund(evidence('10.00000000', { paid_out: 1 })).state, 'manual_review');
  assert.equal(assessWithdrawalRefund(evidence('10.00000000', { paid_at: '2026-10-01' })).state, 'manual_review');
});
test('other pending reservations remain protected', () => {
  const e = evidence('10.00000000', { balance_locked: '10.00000000', other_pending: '1.00000000' });
  assert.equal(assessWithdrawalRefund(e).state, 'manual_review');
});
test('historical withdrawal without a recorded reservation remains manual', () => {
  assert.equal(assessWithdrawalRefund(evidence('10.00000000', { requests: [] })).state, 'manual_review');
});
test('unproven or invalid amounts are blocked', () => {
  assert.equal(assessWithdrawalRefund(evidence('0.00000000')).state, 'manual_review');
  assert.equal(assessWithdrawalRefund(evidence('0.123456789')).state, 'manual_review');
});

