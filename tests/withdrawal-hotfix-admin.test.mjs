import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { createRequire } from 'node:module';

const nativeRequire = createRequire(import.meta.url);
function load(file, deps) {
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', js)(module, module.exports,
    name => deps[name] ?? (name.startsWith('@/') ? {} : nativeRequire(name)));
  return module.exports;
}

const amount = load('src/lib/withdrawalAmount.ts', {});
const response = { json: (body, opts = {}) => ({ body, status: opts.status ?? 200 }) };
const validAddress = '0x1234567890123456789012345678901234567890';

async function adminApprove(options = {}) {
  const row = {
    id: 32, user_id: 12835, amount: options.amount ?? '10.28000000',
    idempotency_key: 'original-key', status: options.rowStatus ?? 'pending',
    refunded: options.refunded ?? 0, paid_out: options.paidOut ?? 0,
    paid_at: null, created_at: options.createdAt ?? '2026-10-24T04:29:08Z',
    address: options.address ?? validAddress, network: 'BEP-20',
    balance_locked: options.locked ?? '100.00000000',
    balance_available: '50.00000000', telegram_id: 9,
  };
  const state = { rollback: 0, commit: 0, writes: [] };
  const connection = {
    beginTransaction: async () => {},
    rollback: async () => { state.rollback++; },
    commit: async () => { state.commit++; },
    release: () => {},
    query: async sql => {
      if (sql.includes('FROM withdrawals w')) return [[row]];
      if (sql.includes('CAST(COALESCE(SUM(amount)'))
        return [[{ pending_amount: options.pendingTotal ?? row.amount }]];
      if (sql.includes("source_system='withdrawal_request'")) {
        if (options.noReservationEvent) return [[]];
        return [[{
          delta_available: options.reservationAvailable ?? `-${row.amount}`,
          delta_locked: options.reservationLocked ?? row.amount,
          policy_version: options.reservationPolicy ?? 'withdrawal-reservation-v1',
        }]];
      }
      if (sql.includes("source_system='withdrawal_payout'"))
        return [options.priorPayout ? [{ id: 1 }] : []];
      if (sql.startsWith('UPDATE users') || sql.startsWith('UPDATE withdrawals')) {
        state.writes.push(sql);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`unexpected query: ${sql.slice(0, 75)}`);
    },
  };
  const route = load('src/app/api/admin/withdrawals/route.ts', {
    'next/server': { NextResponse: response },
    '@/lib/db': { default: { getConnection: async () => connection } },
    '@/lib/adminAuth': { requireAdminPermission: async () => ({ admin: { id: 1 }, response: null }) },
    '@/lib/withdrawalAmount': amount,
    '@/lib/withdrawalNetworks': { validateWithdrawalDestination: (_network, address) =>
      address === validAddress ? { ok: true, network: 'BEP-20', fee: 0 } :
        { ok: false, code: 'INVALID_WITHDRAWAL_ADDRESS', message: 'Invalid address' } },
    '@/lib/withdrawalVerification': { getLatestVerificationForWithdrawal: async () =>
      ({ status: options.verification ?? 'Review Passed', task_id: 7 }) },
    '@/lib/channelSafety': { assessWithdrawalPreclearance: async () =>
      ({ state: 'cleared', reasons: [], risk: { score: 0, state: 'low' } }) },
    '@/lib/financialPostingContext': { withFinancialPostingContext: async (_db, _context, fn) => fn() },
    '@/lib/publisherNotifications': { notifyWithdrawalPaid: async () => {} },
    '@/lib/campaignLifecycle': { recordAdminActionAudit: async () => {} },
  });
  const result = await route.PATCH({ json: async () => ({
    id: row.id, action: 'approve', reason: options.reason ?? '',
    historical_policy_reviewed: options.historicalReviewed ?? false,
  }) });
  return { result, state };
}

test('historical 10 and 25 USDT require recorded policy review, then remain eligible', async () => {
  for (const value of ['10.00000000', '25.00000000']) {
    const held = await adminApprove({ amount: value });
    assert.equal(held.result.body.code, 'HISTORICAL_POLICY_REVIEW_REQUIRED');
    assert.equal(held.state.commit, 0);
    const reviewed = await adminApprove({ amount: value, historicalReviewed: true,
      reason: 'Historical $10 policy and original reservation records reviewed.' });
    assert.equal(reviewed.result.status, 200);
    assert.equal(reviewed.state.commit, 1);
    assert.equal(reviewed.state.writes.length, 2);
  }
});

test('legacy reservation without an event needs manual policy review', async () => {
  const reviewed = await adminApprove({ amount: '25.00000000', noReservationEvent: true,
    historicalReviewed: true, reason: 'Historical $10 policy and original locked reservation reviewed.' });
  assert.equal(reviewed.result.status, 200);
});

test('historical policy uncertainty never silently grants a sub-10 exception', async () => {
  const { result, state } = await adminApprove({ amount: '0.50000000', historicalReviewed: true,
    reason: 'Historical request requires separate owner policy evidence.' });
  assert.equal(result.body.code, 'HISTORICAL_POLICY_EXCEPTION_REQUIRED');
  assert.equal(state.commit, 0);
});

test('new-policy reservation cannot make a sub-50 request payable', async () => {
  const { result, state } = await adminApprove({ amount: '25.00000000', historicalReviewed: true,
    reason: 'Historical $10 policy and original reservation reviewed.',
    reservationPolicy: 'withdrawal-reservation-min50-v1' });
  assert.equal(result.body.code, 'WITHDRAWAL_BELOW_MINIMUM');
  assert.equal(state.commit, 0);
});

test('fraud, total reservation, exact event, destination, prior payout and paid state fail closed', async () => {
  const cases = [
    [{ verification: 'Manual Review' }, 'WITHDRAWAL_VERIFICATION_REQUIRED'],
    [{ locked: '9.99999999' }, 'WITHDRAWAL_RESERVATION_UNBACKED'],
    [{ pendingTotal: '25.00000000', locked: '20.00000000' }, 'WITHDRAWAL_RESERVATION_UNBACKED'],
    [{ reservationLocked: '10.27999999' }, 'WITHDRAWAL_RESERVATION_CONFLICT'],
    [{ address: 'wrong' }, 'INVALID_WITHDRAWAL_ADDRESS'],
    [{ priorPayout: true }, 'WITHDRAWAL_ALREADY_PAID'],
    [{ paidOut: 1 }, 'WITHDRAWAL_NOT_PAYABLE'],
    [{ rowStatus: 'success' }, 'WITHDRAWAL_NOT_PAYABLE'],
    [{ refunded: 1 }, 'WITHDRAWAL_NOT_PAYABLE'],
  ];
  for (const [scenario, code] of cases) {
    const { result, state } = await adminApprove({ historicalReviewed: true,
      reason: 'Historical $10 policy and original reservation records reviewed.', ...scenario });
    assert.equal(result.body.code, code);
    assert.equal(state.commit, 0);
    assert.equal(state.writes.length, 0);
  }
});

test('50 USDT needs no historical exception when verification and reservation pass', async () => {
  const { result, state } = await adminApprove({ amount: '50.00000000', locked: '50.00000000' });
  assert.equal(result.status, 200);
  assert.equal(state.commit, 1);
});

function publisherRoute(publisherId) {
  const state = { writes: 0, available: '100.00000000' };
  const connection = { query: async sql => {
    if (sql.includes('SELECT balance_available')) return [[{ balance_available: state.available, telegram_id: 9 }]];
    if (sql.includes('SELECT id, status, request_fingerprint')) return [[]];
    if (sql.includes('SELECT DATE_ADD')) return [[]];
    if (sql.startsWith('UPDATE users')) { state.writes++; return [{ affectedRows: 1 }]; }
    if (sql.startsWith('INSERT INTO withdrawals')) { state.writes++; return [{ insertId: 88 }]; }
    throw new Error(`unexpected query: ${sql.slice(0, 70)}`);
  } };
  const route = load('src/app/api/publisher/withdrawals/route.ts', {
    'next/server': { NextResponse: response },
    '@/lib/db': { default: { query: async () => [[{ key: 'max_withdraw', value: '500.00000000' }]] } },
    '@/lib/auth': { getAuthenticatedUser: async () => ({ id: publisherId }), getAuthErrorStatus: () => 500 },
    '@/lib/withdrawalNetworks': { validateWithdrawalDestination: () =>
      ({ ok: true, network: 'BEP-20', address: validAddress, fee: 0 }),
      hashUserIdempotencyKey: () => 'fixed-key', withdrawalRequestFingerprint: () => 'fixed-fingerprint' },
    '@/lib/productionSafety': { requireWithdrawalsAllowed: async () => null },
    '@/lib/withdrawalAmount': amount,
    '@/lib/dbResilience': { withFinancialTransactionRetry: async fn => fn(connection) },
    '@/lib/financialPostingContext': { withFinancialPostingContext: async (_db, _context, fn) => fn() },
    '@/lib/platformNotifications': { enqueuePlatformNotification: async () => {} },
    '@/lib/telegram': { escapeTelegramHtml: value => value },
  });
  return { route, state };
}

test('the shared publisher API rejects 0.50, 10 and 49.99999999 for all publisher types', async () => {
  for (const publisherId of [101, 202, 303]) {
    for (const value of ['0.50000000', '10.00000000', '49.99999999']) {
      const { route, state } = publisherRoute(publisherId);
      const result = await route.POST({ headers: { get: () => '0123456789abcdef' },
        json: async () => ({ amount: value, network: 'BEP-20', address: validAddress }) });
      assert.equal(result.body.code, 'WITHDRAWAL_BELOW_MINIMUM');
      assert.equal(state.writes, 0);
    }
  }
});

test('direct API numeric bypass is rejected and exact 50 or 100 passes the minimum', async () => {
  const bypass = publisherRoute(101);
  const denied = await bypass.route.POST({ headers: { get: () => '0123456789abcdef' },
    json: async () => ({ amount: 10, network: 'BEP-20', address: validAddress }) });
  assert.equal(denied.body.code, 'INVALID_WITHDRAWAL_AMOUNT');
  assert.equal(bypass.state.writes, 0);
  for (const value of ['50.00000000', '100.00000000']) {
    const { route, state } = publisherRoute(101);
    const result = await route.POST({ headers: { get: () => '0123456789abcdef' },
      json: async () => ({ amount: value, network: 'BEP-20', address: validAddress }) });
    assert.equal(result.status, 200);
    assert.equal(state.writes, 2);
  }
});

