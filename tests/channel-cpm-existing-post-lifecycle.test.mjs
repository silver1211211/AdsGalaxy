import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

function load(file, stubs) {
  const source = fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }}).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', js)(module, module.exports, (name) => {
    if (!(name in stubs)) throw new Error(`unexpected_dependency:${name}`);
    return stubs[name];
  });
  return module.exports;
}

test('daily cap cleanup sends the existing campaign post to the deletion path', async () => {
  const calls = [];
  const daily = load('src/lib/channelDailyCap.ts', {
    '@/lib/db': { default: {} },
    '@/lib/campaignPostDeletion': {
      deleteAllCampaignPostsForLifecycle: async id => { calls.push(id); return { deleted: 1 }; },
    },
    '@/lib/platformNotifications': {},
    '@/lib/dbResilience': {},
    '@/lib/channelDailySpend': {},
  });
  const result = await daily.cleanupChannelDailyCapPosts(24);
  assert.deepEqual(calls, [24]);
  assert.equal(result.deleted, 1);
});

test('24-hour expiry runs settlement then selects already-settled old posts for deletion', async () => {
  const calls = [];
  const expired = load('src/lib/expiredChannelCleanup.ts', {
    '@/lib/db': { default: {} },
    '@/lib/campaignPostDeletion': {
      markStalePendingDeliveryPosts: async () => ({ recovered: 0 }),
      getConfiguredPostLifetimeHours: async () => 24,
      deleteCampaignPosts: async options => {
        calls.push(options);
        return { checked: 1, deleted: 1, failed: 0, retry: 0, skipped: 0,
          failedIds: [], details: [] };
      },
    },
    '@/lib/channelFastBilling': {
      settlePendingChannelPublisherCredits: async () => ({ candidates: 0, settled: 0 }),
    },
    '@/lib/channelSettlement': {
      settleChannelCampaigns: async () => ({ failedPosts: 0, candidates: 0, settledPosts: 0 }),
    },
  });
  const result = await expired.cleanupExpiredChannelPosts();
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].olderThan24Hours, true);
  assert.equal(calls[0].lifetimeHours, 24);
  const deletion = fs.readFileSync('src/lib/campaignPostDeletion.ts', 'utf8');
  assert.match(deletion, /c\.type = 'views' AND COALESCE\(cp\.views, 0\) <= COALESCE\(cp\.settled_views, 0\)/);
});
