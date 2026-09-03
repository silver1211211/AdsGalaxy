import DocsArticle from "@/components/docs/DocsArticle";
import {
  canonicalMiniappDisplayExample,
  canonicalMiniappScriptExample,
  directRewardCallbackPayloadExample,
  minimalMiniappDisplayExample,
  nodeRewardCallbackVerificationExample,
} from "@/lib/miniappIntegrationExamples";

const verify = `POST /api/v1/rewarded/verify
x-api-key: agx_priv_v1_...
Content-Type: application/json

{"mini_app_id":123,"request_id":"existing-sdk-request-id","external_user_reference":"publisher-user-42"}`;
const claim = `POST /api/v1/rewarded/claim
x-api-key: agx_priv_v1_...
Idempotency-Key: your-stable-operation-key
Content-Type: application/json

{"mini_app_id":123,"event_id":"rwe_...","external_user_reference":"publisher-user-42"}`;
const php = `<?php
$raw=file_get_contents("php://input");
$ts=$_SERVER["HTTP_X_ADSGALAXY_TIMESTAMP"]??"";
$id=$_SERVER["HTTP_X_ADSGALAXY_EVENT_ID"]??"";
$sig=$_SERVER["HTTP_X_ADSGALAXY_SIGNATURE"]??"";
if(abs(time()-intval($ts))>300) exit;
$expected=hash_hmac("sha256",$ts.".".$id.".".$raw,$secret);
if(!hash_equals($expected,$sig)) exit;
// Confirm the header ID equals the JSON payload event_id.
// In one DB transaction: insert $id under UNIQUE constraint and credit once.
?>`;
const python = `import hashlib, hmac, time
def verify(raw_body, headers, secret):
    ts=headers["x-adsgalaxy-timestamp"]; event_id=headers["x-adsgalaxy-event-id"]
    if abs(time.time()-int(ts))>300: return False
    message=ts.encode()+b"."+event_id.encode()+b"."+raw_body
    expected=hmac.new(secret,message,hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected,headers["x-adsgalaxy-signature"])
# Confirm the header ID equals the JSON payload event_id.
# In one DB transaction: insert event_id under UNIQUE constraint and credit once.`;

export default function DeveloperDocsPage() {
  return <DocsArticle
    eyebrow="Developer Platform"
    title="AdsGalaxy SDK and Reward Callbacks"
    intro="Load the Mini App SDK with a Numeric Mini App ID, handle its Promise, and optionally receive a signed verified reward callback."
    sections={[
      { id:"quick-start", title:"1. Add the HTML script", body:[
        "Find the Numeric Mini App ID in Publisher → Mini Apps → Mini App Details. It is the only identifier required in the public SDK URL.",
      ], code:{language:"html",value:canonicalMiniappScriptExample}},
      { id:"display", title:"2. Minimum display and optional Promise handling", body:[
        "window.showAdsGalaxy() alone requests and displays an ad. Promise handlers and callback configuration are optional.",
        "then() and catch() are recommended for UI, request mapping, completion confirmation, and errors, but they are not required for the ad request or display.",
        "then() runs only after AdsGalaxy confirms the completed internal ad. catch() handles structured failures such as NO_FILL, invalid Telegram context, loading failure, or completion-confirmation failure.",
        "The browser result is useful for UI and request mapping. A valuable or withdrawable reward must be credited from the signed backend callback, not browser code alone.",
      ], code:{language:"javascript",value:`${minimalMiniappDisplayExample}\n\n// Optional robust handling:\n${canonicalMiniappDisplayExample}`}},
      { id:"reward-callback", title:"3. Receive the verified reward callback", body:[
        "Configure one optional Reward callback URL in Publisher → Mini Apps → Mini App Details. AdsGalaxy generates the callback signing secret.",
        "Use a public HTTPS endpoint with no embedded credentials, then copy the one-time secret returned after Save. The configuration response reports configured_status, platform_enabled, and effective_status so disabled-by-publisher is distinct from a saved platform-disabled callback.",
        "The callback is optional for displaying ads but required when you want a trustworthy server notification for valuable user rewards.",
        "user_id is the verified Telegram user ID derived from Telegram initData, not a publisher-selected value. It is a string for integer precision safety and includes no profile or wallet data.",
        "x-adsgalaxy-event: reward.eligible is the callback event type; payload status: completed is the verified ad-watch state. Process event_id idempotently.",
      ], code:{language:"json",value:directRewardCallbackPayloadExample}},
      { id:"verify-callback", title:"4. Verify and process the callback safely", body:[
        "Verify with the AdsGalaxy-generated callback signing secret. rawBody means the exact bytes received: verify before JSON parsing or reserialization, require a recent timestamp, and require event_id to match both the header and payload.",
        "Callback delivery is at least once. Every retry retains the same event_id and payload, so insert event_id under a UNIQUE constraint and credit the user in the same database transaction. Duplicate deliveries must not create duplicate rewards.",
      ], code:{language:"javascript",value:nodeRewardCallbackVerificationExample}},
      { id:"delivery", title:"5. Delivery, retries, and HTTP responses", body:[
        "Return HTTP 2xx only after signature verification and the idempotent credit transaction commits. Non-2xx responses or network failures are retried with a fresh timestamp and signature.",
        "Attempts are immediate, then 1, 5, 15, 60, and 360 minutes after failures. Attempt six is terminal. Secret rotation retains the previous secret for a 24-hour overlap.",
        "CALLBACK_SCHEMA_NOT_READY means callback database setup is temporarily incomplete; retry configuration later. It must not be interpreted as Disabled by publisher. Invalid/private URLs are rejected, while receiver timeouts and non-2xx responses enter the retry schedule.",
      ]},
      { id:"wallet", title:"Safe wallet order", body:["Use one authoritative, idempotent server transaction."], bullets:[
        "Verify the callback signature against the exact raw request body.",
        "Require the header event ID to equal payload event_id.",
        "Insert event_id under a unique constraint.",
        "Credit your configured reward and record event_id in one local transaction.",
        "Treat duplicate event_id as an idempotent success.",
      ]},
      { id:"php", title:"PHP callback verification", body:["hash_equals verifies the callback signature in constant time."], code:{language:"php",value:php}},
      { id:"python", title:"Python callback verification", body:["compare_digest verifies the callback signature in constant time."], code:{language:"python",value:python}},
      { id:"errors", title:"SDK errors and troubleshooting", body:[
        "Confirmed SDK categories include NO_FILL, TIMEOUT, SDK_UNAVAILABLE, INVALID_INIT_DATA, APP_NOT_READY, INVALID_APP, REQUEST_FAILED, NETWORK_ERROR, SDK_NOT_CONFIGURED, SDK_LOAD_FAILED, AD_UNAVAILABLE, INVALID_RESPONSE, RENDER_FAILED, OPEN_FAILED, RATE_LIMITED, IMPRESSION_FAILED, INTERNAL_USER_COOLDOWN, INSUFFICIENT_BALANCE, and CONFIRMATION_FAILED.",
        "Check the Numeric Mini App ID, Telegram initData, Mini App approval, network availability, and completion response. Callback configuration does not affect ordinary ad display.",
      ]},
      { id:"advanced", title:"Advanced Developer APIs", body:[
        "These APIs are not required to load the Mini App SDK, display ads, handle SDK errors, or receive a direct Mini App reward callback.",
        "Claim, verify, event lookup, private API keys, Developer applications, and advanced Developer webhooks remain optional functionality for specialized integrations.",
      ]},
      { id:"verify", title:"Advanced: verify a request", body:[
        "POST /api/v1/rewarded/verify requires a private key. HTTP 202 EVENT_PENDING means the scoped request is still being prepared; retry with bounded backoff.",
        "Internal completion returns eligible, ads_galaxy_validated, reward_eligible true. External browser completion remains client-confirmed and ineligible without request-level provider proof.",
      ], code:{language:"http",value:verify}},
      { id:"claim", title:"Advanced: claim once", body:[
        "POST /api/v1/rewarded/claim consumes eligible, unexpired events and requires a stable Idempotency-Key. Same-key retries return the stored response; another key receives REWARD_ALREADY_CLAIMED.",
        "GET /api/v1/rewarded/events/{event_id}?mini_app_id=123 provides authenticated lookup. Claiming does not credit your game wallet.",
      ], code:{language:"http",value:claim}},
      { id:"webhook", title:"Advanced Developer webhook v2", body:[
        "Production event types are reward.eligible and reward.claimed. reward.reversed is not active because no authoritative request-level reversal producer exists.",
        "Headers include x-adsgalaxy-event, x-adsgalaxy-event-id, x-adsgalaxy-timestamp, x-adsgalaxy-signature-version: v2, and hexadecimal x-adsgalaxy-signature.",
        "The signing input is timestamp + \".\" + event_id + \".\" + raw_body. Verify the exact raw bytes, reject timestamps outside five minutes, and compare in constant time.",
        "For advanced Developer webhooks, terminal deliveries can be retried manually while preserving the failed historical row and event identity.",
      ]},
    ]}
  />;
}
