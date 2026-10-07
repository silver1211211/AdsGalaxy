import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import crypto from 'node:crypto';

const read = p => fs.readFileSync(p, 'utf8');
function load(file, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    if (name in mocks) return mocks[name];
    if (name === 'server-only') return {};
    if (name === 'node:crypto' || name === 'crypto') return crypto;
    return new Proxy({}, { get: (_, key) => key === '__esModule' ? false : async () => undefined });
  }, console, process, Date, URL, URLSearchParams, Buffer, setTimeout, clearTimeout });
  return exports;
}
const dailySpend = load('src/lib/channelDailySpend.ts', {'@/lib/channelBilling':load('src/lib/channelBilling.ts')});
const cadence = load('src/lib/channelViewCadence.ts');
const delivery = load('src/lib/channelDelivery.ts');
const billing = load('src/lib/channelBilling.ts');

function fixture({ cap = 1, cps = 0.4, budget = 10, balance = 10, spent = 0, status = 'active' } = {}) {
  const state = { campaign: { id: 1, user_id: 1, name: 'Growth', campaign_kind: 'channel_growth', status,
    destination_chat_id: -100, cost_per_subscriber: cps, daily_budget_limit: cap, budget,
    channel_spend: spent, funding_model: 'direct_debit', growth_seed_allocated: 0 },
    balance, conversions: [], events: {}, notifications: new Set(), invites: 'active', posts: 'active', spent };
  let snapshot;
  const conn = {
    async beginTransaction() { snapshot = structuredClone(state); },
    async commit() {}, async rollback() { Object.assign(state, snapshot); }, release() {},
    async query(sql, p = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.startsWith('SELECT e.*')) return [[state.events[p[0]]]];
      if (s.startsWith('SELECT * FROM campaigns')) return [[state.campaign]];
      if (s.startsWith('SELECT (CASE')) {
        assert.match(s, /g.status='billed' AND g.fraud_status='clear'/);
        assert.match(s, /g.billed_at>=UTC_DATE\(\)/);
        assert.match(s, /g.billed_at<DATE_ADD/);
        return [[{ spend: state.spent }]];
      }
      if (s.startsWith('UPDATE campaigns SET status=\'daily_cap_reached\'')) {
        if (state.campaign.status !== 'active') return [{ affectedRows: 0 }];
        state.campaign.status = 'daily_cap_reached'; state.campaign.pause_reason = 'daily_budget_limit';
        return [{ affectedRows: 1 }];
      }
      if (s.startsWith('UPDATE channel_growth_invites i')) { state.invites = 'revoke_pending'; return [{}]; }
      if (s.startsWith('UPDATE campaign_posts cp')) { state.posts = 'cleanup_pending'; return [{}]; }
      if (s.startsWith('SELECT user_id,name')) return [[{ user_id: 1, name: 'Growth', billing_day: '2026-09-28' }]];
      if (s.startsWith('INSERT IGNORE INTO channel_growth_conversions')) {
        if (state.conversions.some(c => c.key === p[10])) return [{ affectedRows: 0 }];
        state.conversions.push({ key: p[10], price: p[9], debit: 0 });
        return [{ affectedRows: 1, insertId: state.conversions.length }];
      }
      if (s.startsWith('UPDATE campaigns SET budget=budget-')) {
        state.campaign.budget -= p[0]; state.campaign.channel_spend += p[1]; return [{ affectedRows: 1 }];
      }
      if (s.startsWith('SELECT `key`,value FROM settings')) return [[]];
      if (s.startsWith("UPDATE channel_growth_conversions SET status='billed'")) {
        state.conversions[p.at(-1) - 1].debit = p[0]; state.spent += p[0]; return [{}];
      }
      if (s.startsWith('UPDATE campaigns SET channel_publisher_earnings')) return [{}];
      if (s.startsWith('UPDATE channel_growth_membership_events')) {
        const event = state.events[p.at(-1)];
        event.processing_status = s.includes("processing_status='billed'") ? 'billed' : 'nonbillable';
        return [{}];
      }
      throw new Error(`Unhandled SQL: ${s}`);
    },
  };
  const notifications = { enqueueCampaignNotification: async (_, n) => state.notifications.add(`${n.event}:${n.billingDay}`) };
  const capService = load('src/lib/channelDailyCap.ts', {
    '@/lib/channelDailySpend': dailySpend, '@/lib/platformNotifications': notifications,
  });
  const growth = load('src/lib/channelGrowth.ts', {
    '@/lib/db': { getConnection: async () => conn }, '@/lib/channelDailySpend': dailySpend,
    '@/lib/channelDailyCap': capService, '@/lib/platformNotifications': notifications,
    '@/lib/publisherQuality': { getPublisherQuality: async () => ({ qualityWeight: 1 }) },
    '@/lib/earnings': { creditUserLockedBalance: async () => true },
    '@/lib/channelAllocationLedger': { shadowWriteChannelAllocation: async () => {} },
    '@/lib/advertiserDirectDebit': { claimAdvertiserDirectDebit: async (_, x) => { state.balance -= x.amount; return { ok: true }; } },
  });
  function event(id) {
    state.events[id] = { id, processing_status: 'pending', event_type: 'chat_member', is_bot: false,
      invite_id: 1, old_status: 'left', new_status: 'member', campaign_id: 1,
      destination_chat_id: -100, source_publisher_id: 2, source_channel_id: 3,
      campaign_valid_at_event: true, telegram_user_id: id, campaign_post_id: 4, event_at: new Date() };
    return growth.processGrowthMembershipEvent(id);
  }
  return { state, event, conn, capService, growth };
}

test('A/H: sequential CPS bills once; changed CPS preserves historic charges and campaign counter', async () => {
  const f = fixture({ cap: 10 });
  assert.equal((await f.event(1)).status, 'billed');
  assert.equal((await f.growth.processGrowthMembershipEvent(1)).status, 'duplicate');
  f.state.campaign.cost_per_subscriber = 0.6;
  assert.equal((await f.event(2)).status, 'billed');
  assert.deepEqual(f.state.conversions.map(c => c.debit), [0.4, 0.6]);
  assert.equal(f.state.campaign.channel_spend, f.state.conversions.reduce((n, c) => n + c.debit, 0));
  assert.equal(f.state.balance, 9);
});
test('B/C: cap blocks overage, transitions once, queues cleanup and one notification', async () => {
  const f = fixture({ spent: 0.8 });
  assert.equal((await f.event(1)).status, 'daily_cap_reached');
  assert.equal((await f.event(2)).status, 'daily_cap_reached');
  assert.equal(f.state.balance, 10);
  assert.equal(f.state.conversions.length, 0);
  assert.equal(f.state.campaign.status, 'daily_cap_reached');
  assert.equal(f.state.invites, 'revoke_pending'); assert.equal(f.state.posts, 'cleanup_pending');
  assert.equal(f.state.notifications.size, 1);
});
test('C: final affordable conversion stops delivery before next conversion exceeds cap', async () => {
  const f = fixture({ spent: 0.5 });
  assert.equal((await f.event(1)).status, 'billed');
  assert.equal(f.state.campaign.status, 'daily_cap_reached');
  assert.equal(f.state.notifications.size, 1);
});
test('E: manual pause never becomes a daily-cap pause', async () => {
  const f = fixture({ status: 'paused' });
  assert.equal(await f.capService.markChannelDailyCapReached(f.conn, 1), false);
  assert.equal(f.state.campaign.status, 'paused'); assert.equal(f.state.notifications.size, 0);
});
test('F/G: canonical SQL selects billed clear conversions and CPS as next unit', () => {
  assert.match(dailySpend.channelDailySpendSql(), /channel_growth_conversions/);
  assert.match(dailySpend.channelNextUnitSql(), /channel_growth' THEN COALESCE\(c.cost_per_subscriber,0\)/);
});
test('I/J: both actual delivery branches create unique invite then construct tracked CTA', async () => {
  for (const file of ['src/app/api/cron/process-ads/route.ts', 'src/app/api/admin/campaigns/[id]/emergency-push/route.ts']) {
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
    let statements;
    function walk(node) {
      if (ts.isBlock(node) && node.statements.some(s => s.getText(source).startsWith('await createGrowthDeliveryInvite('))) {
        const i = node.statements.findIndex(s => s.getText(source).startsWith('await createGrowthDeliveryInvite('));
        statements = node.statements.slice(i, i + 2).map(s => s.getText(source)).join('\n');
      }
      ts.forEachChild(node, walk);
    }
    walk(source); assert.ok(statements, file);
    let inviteCreated;
    const context = { campaign: { id: 9, public_id: 19, destination_chat_id: -100 }, channel: { id: 5, user_id: 7 }, postId: 42, host: 'https://adsgalaxy.online',
      trackedGrowthCtaUrl: delivery.trackedGrowthCtaUrl,
      createGrowthDeliveryInvite: async x => { inviteCreated = x; return { url: 'https://t.me/+exact' }; } };
    const url = await vm.runInNewContext(`(async()=>{let buttonUrl; ${statements}; return buttonUrl;})()`, context);
    assert.equal(url, 'https://adsgalaxy.online/api/clicks/19/42?growth=1'); assert.equal(inviteCreated.postId, 42);
  }
});
test('M: live impressions follow confirmed post views immediately', async () => {
  let views = 50;
  const service = load('src/lib/channelGrowthStatistics.ts');
  const db = { query: async sql => { assert.match(sql, /delivery_confirmed_at IS NOT NULL/); return [[{ views }]]; } };
  assert.equal(await service.getGrowthLiveImpressions(db, 1), 50);
  views = 123;
  assert.equal(await service.getGrowthLiveImpressions(db, 1), 123);
});
test('N/O: public cadence is adaptive while private intervals remain conservative', () => {
  assert.deepEqual([30, 90, 400, 1600, 5000].map(m => cadence.channelViewIntervalSeconds(m * 60, false)), [300,900,1800,7200,21600]);
  assert.deepEqual([30,90,400,1600].map(m => cadence.channelViewIntervalSeconds(m * 60, true)), [1800,3600,7200,21600]);
  const worker = read('src/app/api/cron/update-views/route.ts');
  assert.ok(worker.indexOf("retry_after=") < worker.indexOf('ELSE ${channelViewCadenceSql'));
  assert.match(worker, /acquireCronLock/);
});
test('P: classic CPM and CPC unit billing retains original economics', () => {
  assert.equal(billing.getChannelUnitPrice({ type: 'views', cpm: 6.2 }), 0.0062);
  assert.equal(billing.getChannelUnitPrice({ type: 'clicks', cpc: 50 }), 0.05);
});

test('D/E/G: next-day eligibility requires a full CPS, both funds, and a cap pause', async () => {
  const base = { status: 'daily_cap_reached', unitPrice: 0.56, budget: 1, balance: 1, requiresBalance: true, cap: 50, spent: 0 };
  assert.equal(dailySpend.canResumeChannelDailyCap(base), true);
  for (const change of [{ budget: 0.55 }, { balance: 0.55 }, { status: 'paused' }, { spent: 49.5 }]) {
    assert.equal(dailySpend.canResumeChannelDailyCap({ ...base, ...change }), false);
  }
  let updates = 0;
  const conn = { query: async sql => {
    if (sql.includes('SELECT c.id')) {
      assert.match(sql, /daily_cap_billing_date<UTC_DATE\(\)/);
      assert.match(sql, /cost_per_subscriber/);
      return [[{ id: 1, status: 'daily_cap_reached', budget: 1, ad_balance: 1, unit_price: 0.56,
        campaign_kind: 'channel_growth', funding_model: 'direct_debit', daily_budget_limit: 50, today_spend: 0 },
        { id: 2, status: 'paused', budget: 1, ad_balance: 1, unit_price: 0.56 }]];
    }
    updates++; return [{ affectedRows: 1 }];
  } };
  const service = load('src/lib/channelDailyCap.ts', { '@/lib/channelDailySpend': dailySpend,
    '@/lib/dbResilience': { withFinancialTransactionRetry: fn => fn(conn) } });
  assert.deepEqual(Array.from(await service.reactivateChannelCampaignsForNewBillingDay()), [1]);
  assert.equal(updates, 1);
});

test('K/L: real Growth click handler records analytics and preserves exact invite without CPC billing', async () => {
  let debits = 0, clicks = 0;
  const invite = 'https://t.me/+ExactPlacementInvite';
  const db = { query: async (sql, params) => {
    if (sql.includes('FROM campaigns c')) return [[{ id: 9, user_id: 1, campaign_kind: 'channel_growth', link: 'https://t.me/channel', post_id: 42, channel_id: 5 }]];
    if (sql.includes('FROM channel_growth_invites')) {
      assert.deepEqual(Array.from(params), [42, 9]); assert.match(sql, /status='active'/);
      return [[{ invite_link_encrypted: 'cipher' }]];
    }
    if (sql.includes('INFORMATION_SCHEMA')) return [['campaign_id', 'post_id', 'fingerprint'].map(COLUMN_NAME => ({ COLUMN_NAME }))];
    if (sql.startsWith('SELECT id FROM campaign_clicks')) return [[]];
    if (sql.includes('INSERT INTO campaign_clicks')) { clicks++; return [{ insertId: 7 }]; }
    throw new Error(sql);
  } };
  const route = load('src/app/api/clicks/[id]/[postId]/route.ts', {
    'next/server': { NextResponse: { redirect: url => ({ location: String(url) }) } },
    '@/lib/db': db, '@/lib/channelFastBilling': { debitChannelClick: async () => { debits++; } },
    '@/lib/routeIds': { parsePositiveIntegerId: Number },
    '@/lib/clickDestination': { safeCampaignDestination: x => x },
    '@/lib/privateInviteLinkVault': { decryptPrivateInviteLink: x => x === 'cipher' ? invite : null },
    '@/lib/conversionTracking': { recordAdClick: async () => 'click-7', appendClickId: () => { throw new Error('Must not alter Growth invite'); } },
    '@/lib/channelTrafficTelemetry': { recordChannelTrafficEvent: async () => {}, telemetryCountry: () => null },
  });
  const response = await route.GET({ nextUrl: new URL('https://adsgalaxy.online/api/clicks/19/42?growth=1'),
    headers: { get: key => key === 'user-agent' ? 'Mozilla/5.0' : null }, cookies: { get: () => undefined } },
    { params: Promise.resolve({ id: '19', postId: '42' }) });
  assert.equal(response.location, invite); assert.equal(clicks, 1); assert.equal(debits, 0);
});
