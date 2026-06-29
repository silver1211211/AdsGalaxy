import DocsArticle, { type DocsSection } from "@/components/docs/DocsArticle";
import CopyCodeBlock from "@/components/docs/CopyCodeBlock";

const publicSdkUrl = (process.env.NEXT_PUBLIC_SDK_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_ADSGALAXY_APP_URL || "https://app.adsgalaxy.online").replace(/\/$/, "");
const backupSdkUrl = process.env.NEXT_PUBLIC_BACKUP_SDK_URL || "https://YOUR_BACKUP_ADSGALAXY_DOMAIN";

const miniAppValidationExample = `Mini App Name: Your Mini App Name
Mini App Username: @YourMiniAppBot
Bot ID: 1234567890
Web App URL: https://your-webapp-url.example.com
Direct Mini App URL: https://t.me/YourMiniAppBot/app`;

const miniAppScriptExample = `<script src="${publicSdkUrl}/sdk.js?id=YOUR_MINI_APP_ID"></script>`;

const miniAppButtonExample = `<button onclick="showAd()">Show Ad</button>
<script>
  function showAd() {
    window.showAdsGalaxy()
      .then(function (result) {
        // Continue your app logic here
        console.log("Ad completed", result);
      })
      .catch(function (error) {
        // Handle no ad or error here
        console.log(error.code, error.message);
      });
  }
</script>`;

const miniAppFullHtmlExample = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>AdsGalaxy Integration Example</title>
  <script src="${publicSdkUrl}/sdk.js?id=YOUR_MINI_APP_ID"></script>
</head>
<body>
  <button onclick="showAd()">Show Ad</button>
  <script>
    function showAd() {
      window.showAdsGalaxy()
        .then(function (result) {
          // Continue your app logic here
        })
        .catch(function (error) {
          // Handle no-fill or errors here
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

const miniAppReliabilityExample = `<script data-miniapp-id="YOUR_MINI_APP_ID">
  !function(){
    var s=document.currentScript,p=s.getAttribute('data-miniapp-id')||'default';
    var d=['${publicSdkUrl}','${backupSdkUrl}'],i=0,t,sc;
    function l(){
      sc=document.createElement('script');
      sc.async=true;
      sc.src=d[i]+'/sdk.js?id='+p;
      clearTimeout(t);
      t=setTimeout(function(){
        sc.onload=sc.onerror=null;
        sc.src='';
        if(++i<d.length)l();
      },15000);
      sc.onload=function(){clearTimeout(t)};
      sc.onerror=function(){clearTimeout(t);if(++i<d.length)l()};
      document.head.appendChild(sc);
    }
    l();
  }();
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
    id: "overview",
    title: "How Mini App monetization works",
    body: [
      "Mini App monetization lets approved Telegram Mini App publishers earn from ad activity inside their Mini Apps.",
      "Mini App monetization is live for all publisher accounts. Approved Mini Apps can serve ads after AdsGalaxy configures at least one delivery network.",
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
      "Web App URL: required HTTPS URL. HTTP and invalid URLs are rejected.",
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
      "Web App URL: use the HTTPS URL where your Mini App frontend is hosted, for example https://your-webapp-url.example.com. This must be a real HTTPS page, not localhost, HTTP, or a private staging link.",
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
    id: "quick-start",
    title: "Quick Start",
    body: [
      "After approval, add the AdsGalaxy public script to your Telegram Mini App and call window.showAdsGalaxy() when the user chooses to show ads.",
      "Use the Mini App ID shown in Publisher > Monetize > Mini Apps > View Details.",
      "Continue your app logic only when the promise resolves. If it rejects, use the structured error code and message to show a retry, no-fill, or Telegram-only message.",
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
    title: "Body and button example",
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
    id: "enhanced-reliability",
    title: "Enhanced reliability script",
    body: [
      "This loader automatically switches to a backup AdsGalaxy SDK domain if the primary domain is unavailable.",
      "Keep YOUR_BACKUP_ADSGALAXY_DOMAIN as a placeholder until you have a real AdsGalaxy backup domain configured.",
    ],
    code: { language: "html", value: miniAppReliabilityExample },
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
    ],
  },
  {
    id: "withdrawals",
    title: "Earnings and withdrawals",
    body: [
      "Mini App earnings follow the AdsGalaxy earnings and withdrawal flow once eligible activity has been recorded and processed.",
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
