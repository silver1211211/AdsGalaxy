import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = async (path) => readFile(new URL(path, root), "utf8");

test("non-Mini App campaigns use the unified stepped command header", async () => {
  const [wizard, shell, miniApp] = await Promise.all([
    source("src/app/advertiser/campaigns/new/[kind]/page.tsx"),
    source("src/components/advertiser/CampaignWizardShell.tsx"),
    source("src/app/advertiser/miniapp-rewarded/page.tsx"),
  ]);
  assert.match(wizard, /<CampaignWizardShell/);
  assert.match(shell, /Step \{step\} of \{steps\.length\}/);
  assert.match(shell, /bg-\[#020b20\]/);
  assert.doesNotMatch(miniApp, /CampaignWizardShell/);
});

test("campaign categories support three selections with a selected marker", async () => {
  const [wizard, categories, createRoute, updateRoute] = await Promise.all([
    source("src/app/advertiser/campaigns/new/[kind]/page.tsx"),
    source("src/lib/campaignCategories.ts"),
    source("src/app/api/advertiser/campaigns/route.ts"),
    source("src/app/api/advertiser/campaigns/[id]/route.ts"),
  ]);
  assert.match(wizard, /current\.length < 3/);
  assert.match(wizard, /rounded-full bg-emerald-500/);
  assert.match(categories, /campaign\.some\(\(category\) => inventory\.includes\(category\)\)/);
  assert.match(createRoute, /serializeCampaignCategories\(formData\.get\("category"\), 3\)/);
  assert.match(updateRoute, /serializeCampaignCategories\(body\.category \?\? campaign\.category, 3\)/);
});

test("preview allows verification and stateless read-only admin login only", async () => {
  const [proxy, login, auth] = await Promise.all([
    source("src/proxy.ts"),
    source("src/app/api/admin/login/route.ts"),
    source("src/lib/adminAuth.ts"),
  ]);
  assert.match(proxy, /channel-growth\/verify/);
  assert.match(proxy, /api\/admin\/login/);
  assert.match(proxy, /PREVIEW_READ_ONLY/);
  assert.match(login, /createAdminPreviewCookieValue/);
  assert.match(auth, /role: "read_only_admin"/);
});

test("growth verification and Teaser validation are presented before submission", async () => {
  const [wizard, teaser] = await Promise.all([
    source("src/app/advertiser/campaigns/new/[kind]/page.tsx"),
    source("src/lib/teaser.ts"),
  ]);
  assert.match(wizard, /Add us as admin/);
  assert.match(wizard, /growthVerificationError&&/);
  assert.match(wizard, /hasInvalidTeaserCopies/);
  assert.match(wizard, /teaserCtaOpen/);
  assert.match(teaser, /join_channel/);
  assert.match(teaser, /shop_now/);
});
