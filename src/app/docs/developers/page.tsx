import DocsArticle from "@/components/docs/DocsArticle";

const publicSdkUrl = (process.env.NEXT_PUBLIC_SDK_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_ADSGALAXY_APP_URL || "https://app.adsgalaxy.online").replace(/\/$/, "");
const sdk = `<script src="${publicSdkUrl}/sdk.js?id=YOUR_NUMERIC_MINI_APP_ID"></script>`;
const promise = `window.showAdsGalaxy()
  .then(function (result) {
    // Send result.request_id to your backend. Do not credit a valuable wallet here.
  })
  .catch(function (error) { console.log(error.code, error.message); });`;
const verify = `POST /api/v1/rewarded/verify
x-api-key: agx_priv_v1_...
Content-Type: application/json

{"mini_app_id":123,"request_id":"existing-sdk-request-id","external_user_reference":"publisher-user-42"}`;
const claim = `POST /api/v1/rewarded/claim
x-api-key: agx_priv_v1_...
Idempotency-Key: your-stable-operation-key
Content-Type: application/json

{"mini_app_id":123,"event_id":"rwe_...","external_user_reference":"publisher-user-42"}`;
const node = `import crypto from "node:crypto";
function verify(rawBody, headers, secret) {
  const timestamp = headers["x-adsgalaxy-timestamp"];
  const eventId = headers["x-adsgalaxy-event-id"];
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = crypto.createHmac("sha256", secret)
    .update(timestamp + "." + eventId + "." + rawBody).digest("hex");
  const supplied = String(headers["x-adsgalaxy-signature"] || "");
  return supplied.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}
// In one DB transaction: insert eventId under UNIQUE constraint and credit once.`;
const php = `<?php
$raw=file_get_contents("php://input");
$ts=$_SERVER["HTTP_X_ADSGALAXY_TIMESTAMP"]??"";
$id=$_SERVER["HTTP_X_ADSGALAXY_EVENT_ID"]??"";
$sig=$_SERVER["HTTP_X_ADSGALAXY_SIGNATURE"]??"";
if(abs(time()-intval($ts))>300) exit;
$expected=hash_hmac("sha256",$ts.".".$id.".".$raw,$secret);
if(!hash_equals($expected,$sig)) exit;
// In one DB transaction: insert $id under UNIQUE constraint and credit once.
?>`;
const python = `import hashlib, hmac, time
def verify(raw_body, headers, secret):
    ts=headers["x-adsgalaxy-timestamp"]; event_id=headers["x-adsgalaxy-event-id"]
    if abs(time.time()-int(ts))>300: return False
    message=ts.encode()+b"."+event_id.encode()+b"."+raw_body
    expected=hmac.new(secret,message,hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected,headers["x-adsgalaxy-signature"])
# In one DB transaction: insert event_id under UNIQUE constraint and credit once.`;

export default function DeveloperDocsPage() {
  return <DocsArticle
    eyebrow="Developer Platform"
    title="AdsGalaxy SDK and Reward Callbacks"
    intro="Keep the existing browser SDK, verify request_id on your server, and credit valuable rewards only from an eligible backend event."
    sections={[
      { id:"overview", title:"Integration overview", body:[
        "The canonical browser route remains /sdk.js?id=<numeric-mini-app-id>. The numeric Mini App ID differs from the Developer Center application ID.",
        "Create a Developer application, grant its private key reward_validation permission, and bind it to a publisher-owned Mini App in the same environment.",
      ], code:{language:"html",value:sdk}},
      { id:"promise", title:"Promise and verification", body:[
        "window.showAdsGalaxy() keeps its existing Promise timing, fields, and errors. Resolution means the browser flow completed; it is not sufficient proof for valuable wallet credit.",
        "Send the existing request_id to your backend. Never expose private keys or trust browser-provided reward amounts.",
      ], code:{language:"javascript",value:promise}},
      { id:"verify", title:"Verify a request", body:[
        "POST /api/v1/rewarded/verify requires a private key. HTTP 202 EVENT_PENDING means the scoped request is still being prepared; retry with bounded backoff.",
        "Internal completion returns eligible, ads_galaxy_validated, reward_eligible true. External browser completion returns client_completed, client_confirmed, reward_eligible false.",
      ], code:{language:"http",value:verify}},
      { id:"claim", title:"Claim once", body:[
        "POST /api/v1/rewarded/claim consumes eligible, unexpired events and requires a stable Idempotency-Key. Same-key retries return the stored response; another key receives REWARD_ALREADY_CLAIMED.",
        "GET /api/v1/rewarded/events/{event_id}?mini_app_id=123 provides authenticated lookup. Claiming does not credit your game wallet.",
      ], code:{language:"http",value:claim}},
      { id:"webhook", title:"Webhook v2", body:[
        "Production event types are reward.eligible and reward.claimed. reward.reversed is not active because no authoritative request-level reversal producer exists.",
        "Headers include x-adsgalaxy-event, x-adsgalaxy-event-id, x-adsgalaxy-timestamp, x-adsgalaxy-signature-version: v2, and hexadecimal x-adsgalaxy-signature.",
        "The signing input is timestamp + \".\" + event_id + \".\" + raw_body. Verify the exact raw bytes, reject timestamps outside five minutes, and compare in constant time.",
      ]},
      { id:"delivery", title:"Delivery and retry", body:[
        "Attempts are immediate, then 1, 5, 15, 60, and 360 minutes after failures. Attempt six is terminal.",
        "Manual retry preserves and links the failed historical row. Rotation retains the previous secret for a 24-hour overlap and shows the new secret once.",
      ]},
      { id:"wallet", title:"Safe wallet order", body:["Use one authoritative, idempotent server transaction."], bullets:[
        "Authenticate the webhook or verify from your server.",
        "Require an eligible event and reward_eligible true.",
        "Insert event_id under a unique constraint.",
        "Credit your configured reward and record event_id in one local transaction.",
        "Treat duplicate event_id as an idempotent success.",
      ]},
      { id:"node", title:"Node.js example", body:["Verify the exact raw body."], code:{language:"javascript",value:node}},
      { id:"php", title:"PHP example", body:["hash_equals is constant-time."], code:{language:"php",value:php}},
      { id:"python", title:"Python example", body:["compare_digest is constant-time."], code:{language:"python",value:python}},
      { id:"errors", title:"Errors and troubleshooting", body:[
        "Confirmed SDK categories include NO_FILL, TIMEOUT, SDK_UNAVAILABLE, INVALID_INIT_DATA, APP_NOT_READY, INVALID_APP, REQUEST_FAILED, NETWORK_ERROR, SDK_NOT_CONFIGURED, SDK_LOAD_FAILED, AD_UNAVAILABLE, INVALID_RESPONSE, RENDER_FAILED, OPEN_FAILED, RATE_LIMITED, IMPRESSION_FAILED, INTERNAL_USER_COOLDOWN, and INSUFFICIENT_BALANCE. Some are route- or adapter-specific.",
        "Check the numeric Mini App ID, Telegram initData, environment, binding, private-key permission, feature availability, and raw-body handling.",
      ]},
    ]}
  />;
}
