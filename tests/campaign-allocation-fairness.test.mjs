import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';

const root = process.cwd();
const allocatorSource = fs.readFileSync(path.join(root, 'src/lib/channelCampaignAllocator.ts'), 'utf8');
const placementSource = fs.readFileSync(path.join(root, 'src/lib/campaignPlacement.ts'), 'utf8');
const affordabilitySource = fs.readFileSync(path.join(root, 'src/lib/channelPlacementAffordability.ts'), 'utf8');
const routeSource = fs.readFileSync(path.join(root, 'src/app/api/cron/process-ads/route.ts'), 'utf8');

function loadTs(source, filename) {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText;
  const compiledModule = { exports: {} };
  vm.runInNewContext(output, { module: compiledModule, exports: compiledModule.exports }, { filename });
  return compiledModule.exports;
}

const allocator = loadTs(allocatorSource, 'channelCampaignAllocator.ts');
const placement = loadTs(placementSource, 'campaignPlacement.ts');

function campaign(id, overrides = {}) {
  return { id, type: 'views', cpm: 2, budget: 10, ...overrides };
}

function candidate(item, state, overrides = {}) {
  return {
    campaign: item,
    score: overrides.score ?? 1,
    successfulThisRun: state.get(item.id) || 0,
    lifetimeSuccessful: overrides.lifetimeSuccessful ?? 0,
    lastSuccessfulPlacementAt: overrides.lastSuccessfulPlacementAt ?? null,
  };
}

function simulate(campaigns, slots) {
  const state = new Map();
  for (let channelId = 1; channelId <= slots; channelId += 1) {
    const ranked = allocator.rankEligibleCampaigns({
      candidates: campaigns.map((item) => candidate(item, state, { score: Number(item.score || 1) })),
      dominanceCap: Math.ceil(slots * 0.4),
      channelId,
      seed: 'test-seed',
    }).ranked;
    const chosen = ranked[0];
    if (chosen) state.set(chosen.campaign.id, (state.get(chosen.campaign.id) || 0) + 1);
  }
  return state;
}

test('1 - seven campaigns each receive an initial opportunity', () => {
  const result = simulate(Array.from({ length: 7 }, (_, index) => campaign(index + 1, { score: 20 - index })), 7);
  assert.equal(result.size, 7);
});

test('2 - 146 compatible placements do not leave a campaign at zero', () => {
  const result = simulate(Array.from({ length: 7 }, (_, index) => campaign(index + 1, { score: 100 - index })), 146);
  assert.equal([...result.values()].filter((count) => count === 0).length, 0);
});

test('3 - priority is a boost and does not remove normal candidates', () => {
  assert.match(routeSource, /prioritizedCampaignCount/);
  assert.doesNotMatch(routeSource, /campaigns\s*=\s*prioritizedCampaigns/);
});

test('4 - ineligible priority cannot suppress an affordable normal candidate', () => {
  assert.match(routeSource, /checkChannelPlacementAffordability\(conn, Number\(campaign\.id\)\)/);
  assert.match(affordabilitySource, /campaign\.status !== "active"/);
  assert.match(routeSource, /preSendCandidateFallbacks\+\+/);
});

test('5 - targeting is evaluated before priority ranking', () => {
  assert.ok(routeSource.indexOf('channelCampaignMatchesInventory') < routeSource.indexOf('rankEligibleCampaigns'));
});

test('6 - failed post is not a successful delivery', () => {
  assert.equal(allocator.isSuccessfulChannelPlacement({ delivery_confirmed_at: null, delivery_failed_at: new Date() }), false);
});

test('7 - failed post cannot create the 24h success map', () => {
  assert.match(routeSource, /if \(!post\.delivery_confirmed_at \|\| post\.delivery_failed_at\) continue/);
});

test('8 - confirmed post creates successful delivery state', () => {
  assert.equal(allocator.isSuccessfulChannelPlacement({ delivery_confirmed_at: new Date(), delivery_failed_at: null }), true);
});

test('9 - confirmed then deleted remains historically successful', () => {
  assert.equal(allocator.isSuccessfulChannelPlacement({ delivery_confirmed_at: new Date(), delivery_failed_at: null, status: 'deleted' }), true);
});

test('10 - failed send does not increment successfulThisRun', () => {
  const failure = routeSource.indexOf('incrementSkip("telegram_send_failed")');
  const increment = routeSource.indexOf('placementCounts.set(campaign.id');
  assert.ok(increment < failure);
  assert.equal((routeSource.slice(failure - 600, failure + 300).match(/placementCounts\.set/g) || []).length, 0);
});

test('11 - zero-served candidate has fairness precedence', () => {
  const a = campaign(1); const b = campaign(2);
  const ranked = allocator.rankEligibleCampaigns({ candidates: [candidate(a, new Map([[1, 10]]), { score: 100 }), candidate(b, new Map(), { score: 1 })], dominanceCap: 20, channelId: 1, seed: 'x' });
  assert.equal(ranked.ranked[0].campaign.id, 2);
});

test('12 - older last success wins starvation precedence', () => {
  const state = new Map();
  const ranked = allocator.rankEligibleCampaigns({ candidates: [
    candidate(campaign(1), state, { lastSuccessfulPlacementAt: '2026-09-27T11:50:00Z', lifetimeSuccessful: 2 }),
    candidate(campaign(2), state, { lastSuccessfulPlacementAt: '2026-09-27T00:00:00Z', lifetimeSuccessful: 2 }),
  ], dominanceCap: 10, channelId: 1, seed: 'x' });
  assert.equal(ranked.ranked[0].campaign.id, 2);
});

test('13 - never delivered campaign is maximally starved', () => {
  const state = new Map();
  const ranked = allocator.rankEligibleCampaigns({ candidates: [
    candidate(campaign(1), state, { lastSuccessfulPlacementAt: '2026-01-01', lifetimeSuccessful: 1 }),
    candidate(campaign(2), state),
  ], dominanceCap: 10, channelId: 1, seed: 'x' });
  assert.equal(ranked.ranked[0].campaign.id, 2);
});

test('14 - fairness cannot bypass targeting', () => {
  const selection = routeSource.slice(routeSource.indexOf('const eligibleCampaigns'));
  assert.ok(selection.indexOf('targeting_mismatch') < selection.indexOf('rankEligibleCampaigns({'));
});
test('15 - fairness cannot bypass budget', () => assert.ok(routeSource.indexOf('available_budget_for_placement') < routeSource.indexOf('const eligibleCampaigns')));
test('16 - fairness cannot bypass daily cap', () => assert.ok(routeSource.indexOf('dailyAvailable') < routeSource.indexOf('const eligibleCampaigns')));
test('17 - fairness cannot bypass same owner exclusion', () => {
  const selection = routeSource.slice(routeSource.indexOf('const eligibleCampaigns'));
  assert.ok(selection.indexOf('same_owner') < selection.indexOf('rankEligibleCampaigns({'));
});

test('18 - dominance is based on successful current-run placements', () => assert.match(allocatorSource, /successfulThisRun < input\.dominanceCap/));

test('19 - dominance removes capped campaign and leaves another', () => {
  const ranked = allocator.rankEligibleCampaigns({ candidates: [
    { ...candidate(campaign(1), new Map()), successfulThisRun: 4 },
    { ...candidate(campaign(2), new Map()), successfulThisRun: 1 },
  ], dominanceCap: 4, channelId: 1, seed: 'x' });
  assert.equal(ranked.ranked[0].campaign.id, 2);
});

test('20 - CPC campaign uses CPC bid', () => assert.equal(allocator.campaignAllocationBid(campaign(1, { type: 'clicks', cpc: 5, cpm: 0 })), 5));
test('21 - CPM campaign uses CPM bid', () => assert.equal(allocator.campaignAllocationBid(campaign(1, { type: 'views', cpm: 6, cpc: 0 })), 6));

test('22 - CPC and CPM normalize inside separate pricing buckets', () => {
  const items = [campaign(1, { type: 'clicks', cpc: 3 }), campaign(2, { type: 'views', cpm: 8 })];
  const maxima = allocator.buildAllocationBidMaxima(items);
  assert.equal(allocator.normalizedCampaignAllocationBid(items[0], maxima), 1);
  assert.equal(allocator.normalizedCampaignAllocationBid(items[1], maxima), 1);
});

test('23 - campaign loading is paged beyond 200 with rotation', () => {
  assert.match(routeSource, /CRON_CAMPAIGN_SCAN_LIMIT/);
  assert.match(routeSource, /await scanRange\(startAfter, null\)/);
  assert.match(routeSource, /await scanRange\(0, startAfter\)/);
});

test('24 - channel with no match has an explicit diagnostic', () => assert.match(routeSource, /no_campaign_for_channel/));
test('25 - campaign with no compatible channel is not labelled starved', () => assert.equal(allocator.zeroDeliveryReason({ successfulThisRun: 0, compatibleChannels: 0, frequencyEligibleChannels: 0, candidateAttempts: 0 }), 'NO_COMPATIBLE_CHANNEL_IN_WINDOW'));
test('26 - successful current-run delivery immediately updates recent map', () => assert.match(routeSource, /postMaps\.recent24h\.add/));
test('27 - failure branch does not update recent map', () => assert.equal((routeSource.slice(routeSource.indexOf('} else {', routeSource.indexOf('if (result.ok)'))).match(/postMaps\.recent24h\.add/g) || []).length, 0));

test('28 - priority provides bounded advantage after initial fairness', () => assert.equal(allocator.applyBoundedPriorityBoost(1, true), 1.12));

test('29 - priority cannot bypass dominance', () => {
  const ranked = allocator.rankEligibleCampaigns({ candidates: [{ ...candidate(campaign(1, { is_prioritized: true }), new Map()), successfulThisRun: 4 }, { ...candidate(campaign(2), new Map()), successfulThisRun: 1 }], dominanceCap: 4, channelId: 1, seed: 'x' });
  assert.equal(ranked.ranked[0].campaign.id, 2);
});

test('30 - priority cannot bypass final affordability', () => assert.ok(routeSource.indexOf('rankEligibleCampaigns') < routeSource.indexOf('checkChannelPlacementAffordability(conn')));
test('31 - priority cannot bypass frequency cap', () => {
  const selection = routeSource.slice(routeSource.indexOf('const eligibleCampaigns'));
  assert.ok(selection.indexOf('same_campaign_channel_24h') < selection.indexOf('rankEligibleCampaigns({'));
});
test('32 - rejected reservation can fall back to another unique candidate', () => assert.match(routeSource, /for \(const candidate of ranking\.ranked\)/));
test('33 - candidate retry is bounded by unique ranked candidates', () => assert.doesNotMatch(routeSource, /while\s*\([^)]*candidate/));

test('34 - deterministic tie breaker is repeatable', () => {
  assert.equal(allocator.deterministicAllocationTieBreaker('s', 2, 3), allocator.deterministicAllocationTieBreaker('s', 2, 3));
});

test('35 - single eligible campaign preserves happy path', () => {
  const item = candidate(campaign(1), new Map());
  const ranked = allocator.rankEligibleCampaigns({ candidates: [item], dominanceCap: 1, channelId: 1, seed: 'x' });
  assert.equal(ranked.ranked[0].campaign.id, 1);
});

test('36 - Prompt 3 due-slot evaluator remains the channel input', () => assert.match(routeSource, /evaluateChannelPostingSlot/));
test('37 - Prompt 2 canonical health remains before allocation', () => assert.ok(routeSource.indexOf('verifyTelegramChannelAccess({') < routeSource.indexOf('const eligibleCampaigns')));
test('38 - fairness helper contains no financial mutation', () => assert.doesNotMatch(allocatorSource, /\bUPDATE\b|\bINSERT INTO\b|\bDELETE FROM\b|advertiser_debit|publisher_credit/i));

test('39 - SQL success predicate requires confirmation and no failure', () => assert.equal(allocator.successfulChannelPlacementSql('cp'), 'cp.delivery_confirmed_at IS NOT NULL AND cp.delivery_failed_at IS NULL'));

test('40 - score accepts normalized type-aware allocation bid', () => {
  const low = placement.calculateCampaignScore(campaign(1), { totalEligibleBudget: 10, totalSuccessfulPlacementsToday: 1, actualPlacementsToday: 0, maxUnderDelivery: 1, normalizedAllocationBid: 0, randomization: 0 });
  const high = placement.calculateCampaignScore(campaign(1), { totalEligibleBudget: 10, totalSuccessfulPlacementsToday: 1, actualPlacementsToday: 0, maxUnderDelivery: 1, normalizedAllocationBid: 1, randomization: 0 });
  assert.ok(high.score > low.score);
});

test('41 - 24h window is measured from confirmed delivery time', () => {
  assert.match(routeSource, /delivery_confirmed_at > NOW\(\) - INTERVAL 24 HOUR/);
  assert.match(routeSource, /new Date\(post\.delivery_confirmed_at/);
});

test('42 - scheduled retry retires only an unconfirmed failed delivery claim', () => {
  const deliverySource = fs.readFileSync(path.join(root, 'src/lib/channelDelivery.ts'), 'utf8');
  assert.match(deliverySource, /input\.mode === "scheduled"/);
  assert.match(deliverySource, /SET delivery_claim_key=NULL/);
  assert.match(deliverySource, /delivery_confirmed_at IS NULL/);
  assert.match(deliverySource, /delivery_failed_at IS NOT NULL OR status='delivery_failed'/);
});
