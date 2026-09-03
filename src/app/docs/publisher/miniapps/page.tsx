import DocsArticle, { type DocsSection } from "@/components/docs/DocsArticle";
import CopyCodeBlock from "@/components/docs/CopyCodeBlock";
import {
  canonicalMiniappDisplayExample,
  canonicalMiniappScriptExample,
  directRewardCallbackPayloadExample,
  minimalMiniappDisplayExample,
  nodeRewardCallbackVerificationExample,
} from "@/lib/miniappIntegrationExamples";

const publicSdkUrl = "https://app.adsgalaxy.online/sdk.js?id=YOUR_NUMERIC_MINI_APP_ID";

const miniAppValidationExample = `Mini App Name: Your Mini App Name
Mini App Username: @YourMiniAppBot
Bot ID: 1234567890
Web App URL: https://your-webapp-url.example.com
Direct Mini App URL: https://t.me/YourMiniAppBot/app`;

const miniAppScriptExample = canonicalMiniappScriptExample;

const miniAppButtonExample = `<button onclick="showAd()">Show Ad</button>
<script>
  function showAd() {
    window.showAdsGalaxy()
      .then(function (result) {
        // Send result.request_id to your backend.
        // Do not credit a valuable wallet here.
      })
      .catch(function (error) {
        console.log(error.code, error.message);
      });
  }
</script>`;

const miniAppFullHtmlExample = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>AdsGalaxy Integration Example</title>
  <script src="${publicSdkUrl}"></script>
</head>
<body>
  <button onclick="showAd()">Show Ad</button>
  <script>
    function showAd() {
      window.showAdsGalaxy()
        .then(function (result) {
          // Send result.request_id to your backend.
          // Do not credit a valuable wallet here.
        })
        .catch(function (error) {
          console.log(error.code, error.message);
        });
    }
  </script>
</body>
</html>`;

const miniAppFallbackExample = `<script>
  const previousAdShow = function () {
    // Your existing fallback ad logic here
  };

  window.AdsGalaxyFallback = previousAdShow;

  if (window.showAdsGalaxy === undefined) {
    window.showAdsGalaxy = function () {
      return window.AdsGalaxyFallback();
    };
  }
</script>`;

const miniAppErrorHandlingExample = `window.showAdsGalaxy()
.then(function (result) {
// Continue app logic here
})
.catch(function (error) {
if (error.code === "NO_FILL") return console.log("No ad available.");
if (error.code === "INVALID_INIT_DATA") return console.log("Open this inside Telegram.");
if (error.code === "APP_NOT_READY") return console.log("App is not ready for ads.");
console.log(error.message);
});`;

const sections: DocsSection[] = [
  {
    id: "quick-start",
    title: "1. Find your Numeric Mini App ID and add the script",
    body: [
      "Find the Numeric Mini App ID in Publisher → Mini Apps → Mini App Details. Add it to this public script URL; no Developer application, private API key, or manual server-side ad request is required.",
    ],
    code: { language: "html", value: canonicalMiniappScriptExample },
  },
  {
    id: "display",
    title: "2. Minimum display: call showAdsGalaxy()",
    body: [
      "window.showAdsGalaxy() alone requests and displays an ad. Promise handlers, a callback URL, Developer application, API key, webhook, and publisher backend are not required.",
      "The Promise handlers below are optional but recommended for application UI, request mapping, confirmed completion, and structured errors.",
      "then() runs only after AdsGalaxy confirms the completed internal ad. The browser result is useful for UI and request mapping.",
      "catch() handles structured failures such as NO_FILL, invalid Telegram context, loading failure, or completion-confirmation failure. Do not credit a valuable or withdrawable reward from browser code alone.",
    ],
    code: { language: "javascript", value: `${minimalMiniappDisplayExample}\n\n// Optional robust handling:\n${canonicalMiniappDisplayExample}` },
  },
  {
    id: "reward-callback",
    title: "3. Optionally receive the verified reward callback",
    body: [
      "Configure one Reward callback URL directly in Publisher → Mini Apps → Mini App Details. AdsGalaxy generates the signing secret; you do not need Developer Center setup.",
      "Enter a public HTTPS URL, choose Save, and copy the generated signing secret immediately. The secret is shown only on creation or rotation. Active means delivery is enabled; Saved means the configuration is retained while the platform feature is disabled; Unavailable means platform database setup is pending, not that you disabled it.",
      "The callback is optional for displaying ads but required when you want a trustworthy server notification for valuable user rewards.",
      "user_id is the verified Telegram user ID derived by AdsGalaxy from Telegram initData. Publishers do not choose or submit it. It is encoded as a string to avoid JavaScript integer precision loss; no username, name, photo, wallet, or profile data is included.",
      "x-adsgalaxy-event: reward.eligible names the callback event type. Payload status: completed is the verified ad-watch state. AdsGalaxy sends this callback after validating the completed internal ad; process event_id idempotently.",
    ],
    code: { language: "json", value: directRewardCallbackPayloadExample },
  },
  {
    id: "verify-callback",
    title: "4. Verify and process the callback safely",
    body: [
      "Verify with the AdsGalaxy-generated callback signing secret. rawBody is the exact byte sequence received and must be verified before JSON reserialization. Require a recent timestamp and require the header event ID to match payload event_id.",
      "Delivery is at least once and retries keep the same event_id and payload. Insert event_id under a UNIQUE constraint and credit the user in the same database transaction. Duplicate deliveries must not create duplicate rewards. Return HTTP 2xx only after successful processing.",
      "AdsGalaxy attempts delivery immediately, then after 1, 5, 15, 60, and 360 minutes. Common failures are a non-public or non-HTTPS URL, an invalid signature or stale timestamp, a receiver timeout/non-2xx response, and temporary platform setup unavailability.",
    ],
    code: { language: "javascript", value: nodeRewardCallbackVerificationExample },
  },
  {
    id: "results",
    title: "5. Understand success and error results",
    body: [
      "A confirmed internal result includes request_id, event_id, completed: true, reward_eligible: true, and status: completed. Use request_id to map browser UI to your backend callback.",
      "NO_FILL means no eligible ad is available. INVALID_INIT_DATA means the Mini App lacks a valid Telegram context. SDK_LOAD_FAILED and CONFIRMATION_FAILED indicate loading or authoritative completion failures.",
    ],
  },
  {
    id: "overview",
    title: "How Mini App monetization works",
    body: [
      "Mini App monetization lets approved Telegram Mini App publishers earn from ad activity inside their Mini Apps.",
      "Mini App monetization is available to approved publisher accounts with Mini App access. Approved Mini Apps can serve ads after AdsGalaxy configures at least one delivery network.",
    ],
  },
  {
    id: "submission",
    title: "Submission process",
    body: [
      "Open Publisher > Mini Apps, select Add Mini App, and submit real Mini App details. Invalid details are rejected before moderation.",
      "After submission, the Mini App enters pending review. Approved Mini Apps can be configured for monetization by AdsGalaxy admins.",
    ],
  },
  {
    id: "fields",
    title: "Required fields and validation",
    body: ["Every field must match the actual Telegram Mini App and bot identity."],
    bullets: [
      "Mini App Name: required, trimmed, and at least 3 characters.",
      "Mini App Username: required, accepts @UsernameBot or UsernameBot, must use Telegram username characters, must meet Telegram length rules, and must end with bot.",
      "Bot ID: required numeric Telegram bot ID. Random text is rejected.",
      "Web App URL: required HTTPS URL. HTTP, invalid URLs, and t.me/telegram.me links are rejected.",
      "Direct Mini App URL: required Telegram Mini App link such as https://t.me/BotUsername/app, https://t.me/BotUsername?startapp=..., or tg://resolve?domain=BotUsername&appname=.... The bot username should match the submitted Mini App Username.",
    ],
  },
  {
    id: "how-to-get-fields",
    title: "How to get each Mini App field",
    body: [
      "Use the same Telegram bot and Mini App details that are live in Telegram. Do not submit a test name, copied username, or unrelated bot ID.",
      "If you are unsure about a value, open your bot in BotFather and compare it with the Mini App link you give users.",
    ],
    bullets: [
      "Mini App Name: use the public product name users recognize, for example Your Mini App Name. You can use the name shown in your Mini App, landing page, or Telegram bot profile.",
      "Mini App Username: use the Telegram bot username connected to the Mini App, for example @YourMiniAppBot. You can find it in Telegram by opening the bot profile or in BotFather under your bot list.",
      "Bot ID: use the numeric Telegram bot ID, for example 1234567890. You can usually get it from your bot setup records, Telegram bot management tooling, or by calling Telegram Bot API getMe with your own bot token. AdsGalaxy cannot verify the bot ID for you without your bot token.",
      "Web App URL: use the HTTPS URL where your Mini App frontend is hosted, for example https://your-webapp-url.example.com. This must be a real HTTPS page, not localhost, HTTP, or a private staging link — and not a t.me or telegram.me link (that belongs in Direct Mini App URL below). This is the same URL you configure as your Mini App in BotFather, and the URL required by AdsGram and most Telegram Mini App ad networks.",
      "Direct Mini App URL: use the Telegram link that opens the Mini App for users, for example https://t.me/YourMiniAppBot/app. If your Mini App uses start parameters, https://t.me/YourMiniAppBot?startapp=example is also valid.",
    ],
  },
  {
    id: "monetization",
    title: "Monetization flow",
    body: [
      "AdsGalaxy manages Mini App monetization settings after approval. Publishers do not enter private delivery configuration themselves.",
      "Admins review the Mini App, approve eligible submissions, and configure monetization settings when the app is ready.",
    ],
  },
  {
    id: "integration-notes",
    title: "Integration notes",
    body: [
      "After approval, add the AdsGalaxy public script to your Telegram Mini App and call window.showAdsGalaxy() when the user chooses to show ads.",
      "Use the Numeric Mini App ID shown in Publisher → Mini Apps → Mini App Details.",
      "Continue your app logic only when the promise resolves. If it rejects, use the structured error code and message to show a retry, no-fill, or Telegram-only message.",
      "Optionally configure one signed Reward callback in Mini App Details. No Developer application or private API key is required for basic display or this direct callback.",
      "The SDK uses Telegram initData automatically and binds each ad request to the authenticated Telegram user. Never call mediation endpoints without initData.",
      "Use the script example, add a Show Ad button, then call window.showAdsGalaxy() from your app action.",
    ],
  },
  {
    id: "script-example",
    title: "Script example",
    body: ["Use the Mini App ID shown in its publisher details. Do not add private keys or network-specific IDs to the public page."],
    code: { language: "html", value: miniAppScriptExample },
  },
  {
    id: "button-example",
    title: "Remaining example: button integration",
    body: ["Call window.showAdsGalaxy() from a user action such as a button click."],
    code: { language: "html", value: miniAppButtonExample },
  },
  {
    id: "full-html-example",
    title: "Full HTML example",
    body: ["This minimal page shows the Mini App ID script and a Show Ad button in one place."],
    code: { language: "html", value: miniAppFullHtmlExample },
  },
  {
    id: "fallback-logic",
    title: "Optional: Fallback Logic for Safety",
    body: [
      "AdsGalaxy handles internal mediation fallback automatically behind the scenes.",
      "This fallback is only for the rare case where the AdsGalaxy SDK itself fails to load. Publishers may define their own fallback function for that SDK-load failure case.",
    ],
    code: { language: "html", value: miniAppFallbackExample },
  },
  {
    id: "error-handling",
    title: "Error handling",
    body: ["Use structured error codes to decide whether to show no-fill, Telegram-only, or app-not-ready messaging."],
    code: { language: "javascript", value: miniAppErrorHandlingExample },
  },
  {
    id: "reporting",
    title: "Reporting",
    body: [
      "Publisher Mini App reporting shows daily performance, impressions, revenue summaries when available, and country impression counts.",
      "Country reporting tracks impressions only. Revenue by country is intentionally not shown.",
      "External provider revenue remains pending until AdsGalaxy receives a trusted provider import or postback; browser-supplied revenue is never accepted as confirmed earnings.",
    ],
  },
  {
    id: "reward-security",
    title: "Reward security",
    body: [
      "then() means AdsGalaxy confirmed the completed internal ad. catch() handles no-fill, invalid context, load failure, or confirmation failure.",
      "Do not credit a valuable wallet from browser code alone. Credit from the signed backend callback: insert event_id uniquely and credit in one database transaction.",
    ],
    bullets: [
      "Internal AdsGalaxy completion can produce an eligible, server-validated event.",
      "External browser completion is client-confirmed and remains ineligible without request-level provider proof.",
      "Credit a verified callback event once by storing event_id atomically with the wallet update.",
      "Do not submit revenue, provider credentials, or API keys from browser code.",
      "Use the Numeric Mini App ID for sdk.js. A Developer application is not part of ordinary Mini App setup.",
    ],
  },
  {
    id: "backend-callbacks",
    title: "Backend callbacks",
    body: [
      "Configure the optional Reward callback directly in Publisher > Mini Apps > Mini App Details. AdsGalaxy generates the signing secret and shows it only after creation or rotation.",
      "Verify signatures against the exact raw body, reject timestamps older than five minutes, deduplicate event_id under a unique constraint, and credit the wallet in the same transaction.",
      "See the Developer documentation for callback verification in Node.js, PHP, and Python, retry behavior, raw-body handling, and optional advanced API references.",
    ],
  },
  {
    id: "advanced-developer-apis",
    title: "Advanced Developer APIs",
    body: [
      "These APIs are not required to load the Mini App SDK, display ads, handle SDK errors, or receive a direct Mini App reward callback.",
      "Private API keys, reward claim, reward verify, event lookup, Developer applications, and advanced Developer webhooks remain available for specialized integrations.",
    ],
  },
  {
    id: "withdrawals",
    title: "Earnings and withdrawals",
    body: [
      "Mini App earnings follow the AdsGalaxy earnings and withdrawal flow once eligible activity has been recorded and processed.",
      "Locked and available publisher earnings are AdsGalaxy platform earnings. They are separate from rewards inside your own application wallet.",
      "Use the publisher withdrawal area to review available balance and withdrawal status.",
    ],
  },
];

export default function PublisherMiniAppsDocsPage() {
  return (
    <DocsArticle
      eyebrow="Publisher Documentation"
      title="Mini App Monetization"
      intro="Submit real Telegram Mini Apps for review, integrate the SDK, and learn how reporting and monetization fit together."
      sections={sections}
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl bg-blue-50 p-5">
          <h2 className="text-sm font-black uppercase tracking-tight text-slate-900">Valid submission example</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Use matching bot usernames and production HTTPS URLs.</p>
        </div>
        <CopyCodeBlock code={miniAppValidationExample} language="text" />
      </div>
    </DocsArticle>
  );
}
