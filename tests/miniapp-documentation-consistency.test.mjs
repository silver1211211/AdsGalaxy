import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const examples = read("src/lib/miniappIntegrationExamples.ts");
const publisher = read("src/app/docs/publisher/miniapps/page.tsx");
const developer = read("src/app/docs/developers/page.tsx");
const hub = read("src/app/docs/page.tsx");
const publisherHub = read("src/app/docs/publisher/page.tsx");
const homepage = read("src/components/home/PublicHomepage.tsx");
const details = read("src/components/publisher/MiniAppDetailsScreen.tsx");
const developerCenter = read("src/app/publisher/developer/page.tsx");

function template(name) {
  const match = examples.match(new RegExp("export const " + name + " = `([\\s\\S]*?)`;"));
  assert.ok(match, `${name} must remain an exported template`);
  return match[1];
}

test("canonical first script example uses the Numeric Mini App ID", () => {
  assert.equal(examples.match(/canonicalMiniappScriptExample =\s*\n?\s*'([^']+)'/)?.[1], '<script src="https://app.adsgalaxy.online/sdk.js?id=YOUR_NUMERIC_MINI_APP_ID"></script>');
  assert.doesNotMatch(hub + publisher + developer + homepage, /YOUR_INTEGRATION_ID|YOUR_MINI_APP_ID/);
});

test("canonical second example is syntactically valid then/catch JavaScript", () => {
  const body = template("canonicalMiniappDisplayExample");
  assert.match(body, /^window\.showAdsGalaxy\(\)\n  \.then\(function \(result\)/);
  assert.match(body, /\n  \.catch\(function \(error\)/);
  assert.doesNotThrow(() => new Function(body));
});

test("third example is the exact valid direct callback JSON", () => {
  const payload = template("directRewardCallbackPayloadExample");
  assert.deepEqual(Object.keys(JSON.parse(payload)), ["event_id", "request_id", "mini_app_id", "user_id", "status", "completed_at"]);
  assert.equal(JSON.parse(payload).status, "completed");
});

test("both basic guides order script, display, callback, and verification first", () => {
  for (const guide of [publisher, developer]) {
    const positions = ["quick-start", "display", "reward-callback", "verify-callback"].map((id) => guide.search(new RegExp(`id:\\s*\"${id}\"`)));
    assert.ok(positions.every((position) => position >= 0));
    assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  }
});

test("basic publisher guide requires no private key, application, webhook, or claim", () => {
  const basic = publisher.slice(publisher.indexOf('id: "quick-start"'), publisher.indexOf('id: "overview"'));
  assert.doesNotMatch(basic, /x-api-key|agx_priv|POST \/api\/v1\/rewarded\/claim|create a Developer application|Developer webhook/i);
});

test("basic Developer sequence is isolated from optional private APIs", () => {
  const basic = developer.slice(developer.indexOf('id:"quick-start"'), developer.indexOf('id:"advanced"'));
  assert.doesNotMatch(basic, /x-api-key|agx_priv|rewarded\/claim|Developer webhook|Developer binding/i);
  assert.match(developer, /title:"Advanced Developer APIs"/);
  assert.match(developer, /These APIs are not required to load the Mini App SDK, display ads, handle SDK errors, or receive a direct Mini App reward callback/);
});

test("callback verifier uses the generated secret and exact raw body signing input", () => {
  const verifier = template("nodeRewardCallbackVerificationExample");
  assert.match(verifier, /createHmac\("sha256", secret\)/);
  assert.match(verifier, /timestamp \+ "\." \+ eventId \+ "\." \+ rawBody/);
  assert.match(verifier, /Math\.abs\(Date\.now\(\) \/ 1000 - Number\(timestamp\)\) > 300/);
  assert.match(verifier, /timingSafeEqual/);
});

test("raw-body, header/payload matching, and at-least-once deduplication are explained", () => {
  for (const guide of [publisher, developer]) {
    assert.match(guide, /exact byte|exact raw/i);
    assert.match(guide, /header event ID to match payload event_id|event_id to match both the header and payload/i);
    assert.match(guide, /at least once/i);
    assert.match(guide, /UNIQUE constraint/);
    assert.match(guide, /same database transaction/);
  }
});

test("valuable browser-only credit is explicitly prohibited", () => {
  assert.match(examples, /Do not credit a valuable wallet here/);
  assert.match(publisher + developer, /must be credited from the signed backend callback|Do not credit a valuable or withdrawable reward from browser code alone/);
});

test("existing full-page, fallback, error, PHP, Python, verify, and claim examples remain", () => {
  assert.match(publisher, /miniAppFullHtmlExample/);
  assert.match(publisher, /miniAppFallbackExample/);
  assert.match(publisher, /miniAppErrorHandlingExample/);
  assert.match(developer, /const php =/);
  assert.match(developer, /const python =/);
  assert.match(developer, /const verify =/);
  assert.match(developer, /const claim =/);
});

test("documentation hubs describe the simple Mini App contract", () => {
  assert.match(hub, /Numeric Mini App ID and script/);
  assert.match(hub, /Promise success and errors/);
  assert.match(hub, /Optional verified reward callback/);
  assert.match(publisherHub, /showAdsGalaxy\(\)\.then\(\)\.catch\(\)/);
});

test("homepage uses Numeric Mini App ID terminology and Promise handling", () => {
  assert.match(homepage, /YOUR_NUMERIC_MINI_APP_ID/);
  assert.match(homepage, /\.then\(function \(result\)/);
  assert.match(homepage, /\.catch\(function \(error\)/);
  assert.doesNotMatch(homepage, /Integration ID|Developer Center ID|YOUR_INTEGRATION_ID/);
});

test("Mini App Details displays and copies the same shared examples", () => {
  assert.match(details, /const bodyCode = `\$\{minimalMiniappDisplayExample\}[\s\S]*\$\{canonicalMiniappDisplayExample\}`/);
  assert.match(details, /code=\{bodyCode\}[\s\S]*onCopy=\{\(\) => copyCode\("body", bodyCode\)\}/);
  assert.match(details, /code=\{directRewardCallbackPayloadExample\}[\s\S]*copyCode\("callback", directRewardCallbackPayloadExample\)/);
  assert.doesNotMatch(details, /showAdsGalaxy\(\{ miniappId/);
});

test("direct callback examples contain no keys, secrets, or advertiser data", () => {
  const browserAndPayload = template("canonicalMiniappDisplayExample") + template("directRewardCallbackPayloadExample");
  assert.doesNotMatch(browserAndPayload, /x-api-key|agx_priv|signing_secret|campaign|advertiser|price/i);
});

test("Developer Center clearly labels its Mini App API controls advanced", () => {
  assert.match(developerCenter, /Advanced Developer APIs:/);
  assert.match(developerCenter, /Ordinary publishers configure Reward callback in Publisher → Mini Apps → Mini App Details/);
  assert.doesNotMatch(developerCenter, /Copy Integration ID/);
});

test("unrelated documentation categories remain linked and intact", () => {
  for (const route of ["/docs/publisher/channels", "/docs/publisher/bots", "/docs/advertiser/channels", "/docs/advertiser/miniapps", "/docs/advertiser/bots"]) assert.match(hub, new RegExp(route));
  assert.match(read("src/app/docs/publisher/channels/page.tsx"), /Channel/);
  assert.match(read("src/app/docs/publisher/bots/page.tsx"), /Bot/);
});
