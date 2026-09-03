import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const referralSource = fs.readFileSync("src/lib/referralSprint.ts", "utf8");
const verifierSource = fs.readFileSync("src/app/api/verify-url/route.ts", "utf8");

test("team leaderboard aggregates referrals once and isolates failures", () => {
  const start = referralSource.indexOf("async function getTeamLeaderboard(sprintId: number)");
  const end = referralSource.indexOf("async function getTeamLeagueSummary", start);
  const source = referralSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.equal(source.includes("r_all"), false);
  assert.equal(source.includes("r_sprint"), false);
  assert.match(source, /SUM\(r\.sprint_id = \?\)/);
  assert.match(source, /TEAM_LEADERBOARD_CACHE_MS/);
  assert.match(source, /REFERRAL_TEAM_LEADERBOARD_QUERY_FAILED/);
  assert.match(source, /return cached\?\.rows \|\| \[\]/);
});

test("URL verifier validates and resolves before a bounded non-following fetch", () => {
  assert.match(verifierSource, /new URL\(url\)/);
  assert.match(verifierSource, /VALID_HOSTNAME/);
  assert.match(verifierSource, /hostname\.endsWith\("\."\)/);
  assert.match(verifierSource, /lookup\(hostname/);
  assert.match(verifierSource, /AbortSignal\.timeout\(5_000\)/);
  assert.match(verifierSource, /redirect: "manual"/);
  assert.match(verifierSource, /URL_VERIFICATION_FAILED/);
});
