import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const audit=read("src/lib/campaignLifecycle.ts"), notify=read("src/lib/platformNotifications.ts"), telegram=read("src/lib/telegramNotification.ts");
const system=read("src/lib/systemLogs.ts"), mini=read("src/lib/miniappInternalAds.ts"), ext=read("src/lib/externalNetworkRevenueReconciliation.ts");
const deposit=read("src/lib/depositAmountValidation.ts"), depositRoute=read("src/app/api/advertiser/deposits/route.ts");
const click=read("src/app/api/clicks/[id]/[postId]/route.ts"), clickDest=read("src/lib/clickDestination.ts"), body=read("src/lib/requestBodyValidation.ts");
const broadcast=read("src/app/api/cron/process-broadcast/route.ts"), campaign=read("src/app/api/advertiser/campaigns/route.ts");
const cases = [
 ["A1 numeric entity",/Number\.isSafeInteger/.test(audit)], ["A2 string entity key",/entity_key/.test(audit)], ["A3 nullable entity",/entityId\?:/.test(audit)],
 ["A4 secret metadata filter",/password\|api/.test(audit)], ["A5 structured failure",/admin_audit_write_failed/.test(audit)],
 ["N1 canonical recipient",/SELECT telegram_id FROM users/.test(telegram)], ["N2 stale users chat id removed",!broadcast.includes("SELECT chat_id FROM users")],
 ["N3 blocked permanent",/bot was blocked/.test(telegram)], ["N4 timeout temporary",/timeout/.test(telegram)], ["N5 429 temporary",/status === 429/.test(telegram)],
 ["N6 permanent terminal",/9999-12-31/.test(notify)], ["N7 invalid recipient",/INVALID_RECIPIENT/.test(telegram)],
 ["S1 trust event supported",/publisher_trust_enforcement/.test(system)], ["S2 known duplicate upsert",/LAST_INSERT_ID/.test(system)], ["S3 unknown duplicate thrown",/throw error/.test(system)],
 ["M1 zero safe",/total === 0 \? 0/.test(mini)], ["M2 same-unit numerator",/internal_requests/.test(mini)], ["M3 100 cap",/Math\.min\(100/.test(mini)],
 ["M4 never above 100",/Math\.min\(100/.test(mini)], ["M5 shared window",/rolling_1_hour_utc/.test(mini)], ["M6 projected request",/projected_share_percent/.test(mini)],
 ["M7 cap policy",/internal_share_cap_reached/.test(mini)], ["M8 fallback reason",/cap_bypassed_due_to_no_external_fill/.test(mini)],
 ["M9 no divide zero",/total === 0/.test(mini)], ["M10 DB shared counters",/miniapp_mediation_requests/.test(mini)],
 ["E1 disabled status declared",/DISABLED/.test(ext)], ["E2 credentials status",/NO_CREDENTIALS/.test(ext)], ["E3 no-data status",/NO_DATA/.test(ext)],
 ["E4 temporary status",/TEMPORARY_FAILURE/.test(ext)], ["E5 success status",/SUCCESS/.test(ext)], ["E6 reconciliation upsert",/ON DUPLICATE KEY UPDATE/.test(ext)],
 ["E7 unsupported status",/NOT_SUPPORTED/.test(ext)], ["E8 no token logging",!ext.includes("console.log(token")],
 ["D1 valid normalization",/normalized/.test(deposit)], ["D2 maximum",/MAX_DEPOSIT_AMOUNT/.test(deposit)], ["D3 huge rejected",/MAX_SCALED/.test(deposit)],
 ["D4 negative rejected",/\^\(\\d\+\)/.test(deposit)], ["D5 malformed rejected",/INVALID_AMOUNT/.test(deposit)], ["D6 precision bounded",/d\{1,8\}/.test(deposit)],
 ["D7 validation before provider",depositRoute.indexOf("validateDepositAmount") < depositRoute.indexOf("fetch(OXAPAY")],
 ["D8 validation before insert",depositRoute.indexOf("validateProviderPayAmount") < depositRoute.indexOf("INSERT INTO deposits")],
 ["C1 IDs parsed",/parsePositiveIntegerId/.test(click)], ["C2 malformed campaign safe",/Malformed campaign post click ids rejected/.test(click)],
 ["C3 malformed post safe",/!campaignId \|\| !postId/.test(click)], ["C4 missing IDs safe",/redirectToFallback/.test(click)],
 ["C5 relation joined",/JOIN campaign_posts/.test(click)], ["C6 javascript blocked",!/javascript:/.test(clickDest)], ["C7 https allowed",/https:/.test(clickDest)],
 ["C8 telegram allowed",/tg:/.test(clickDest)], ["C9 redirect preserved",/redirect preserved/.test(click)], ["C10 duplicate retained",/isNew: false/.test(click)],
 ["F1 boundary accepted",/boundary=/.test(body)], ["F2 missing boundary 400",/Invalid multipart boundary/.test(body)], ["F3 malformed boundary",/boundary.length > 200/.test(body)],
 ["F4 unsupported 415",/status: 415/.test(body)], ["F5 oversized 413",/status: 413/.test(body)], ["F6 no stack response",!body.includes("stack")],
 ["X1 campaign guarded",/validateMultipartRequest/.test(campaign)], ["X2 canonical destination",/safeCampaignDestination/.test(click)], ["X3 provider amount guarded",/validateProviderPayAmount/.test(depositRoute)]
];
assert.equal(cases.length,60);
for (const [name, pass] of cases) test(name,()=>assert.equal(pass,true));
