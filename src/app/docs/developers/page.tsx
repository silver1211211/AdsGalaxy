import DocsArticle from "@/components/docs/DocsArticle";

const publicSdkUrl = (process.env.NEXT_PUBLIC_SDK_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_ADSGALAXY_APP_URL || "https://app.adsgalaxy.online").replace(/\/$/, "");
const backupSdkUrl = process.env.NEXT_PUBLIC_BACKUP_SDK_URL || "https://YOUR_BACKUP_ADSGALAXY_DOMAIN";

const addScriptExample = `<script src="${publicSdkUrl}/sdk.js?id=YOUR_INTEGRATION_ID"></script>`;

const showAdsExample = `<button onclick="showAd()">Show Ad</button>
<script>
  function showAd() {
    window.showAdsGalaxy()
      .then(function (result) {
        // Handle success here
        console.log("Ad completed", result);
      })
      .catch(function (error) {
        // Handle errors here
        console.log(error.code, error.message);
      });
  }
</script>`;

const fullHtmlExample = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>AdsGalaxy Ads Example</title>
  <script src="${publicSdkUrl}/sdk.js?id=YOUR_INTEGRATION_ID"></script>
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

const errorHandlingExample = `window.showAdsGalaxy()
.then(function (result) {
  // Continue app logic here
})
.catch(function (error) {
  if (error.code === "NO_FILL") return console.log("No ad available.");
  if (error.code === "INVALID_INIT_DATA") return console.log("Open this inside Telegram.");
  if (error.code === "APP_NOT_READY") return console.log("App is not ready for ads.");
  console.log(error.message);
});`;

const enhancedLoaderExample = `<script data-integration-id="YOUR_INTEGRATION_ID">
  !function(){
    var s=document.currentScript,p=s.getAttribute('data-integration-id')||'default';
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

export default function DeveloperDocsPage() {
  return (
    <DocsArticle
      eyebrow="Developer Platform"
      title="AdsGalaxy SDK"
      intro="Use one Integration ID to display AdsGalaxy Ads in approved publisher Mini Apps. Publishers integrate ads; advertisers buy ads."
      sections={[
        {
          id: "quick-start",
          title: "Part 1: Quick Start",
          body: [
            "Add Script: paste the AdsGalaxy script in your Mini App page and replace YOUR_INTEGRATION_ID with the 6-10 digit Integration ID from Publisher > Developer Center.",
            "Show Ads: call window.showAdsGalaxy() from a user action such as a button tap.",
            "Handle Success: continue your app logic only after the promise resolves.",
            "Handle Errors: use the error code to show no-fill, Telegram-only, or app-not-ready messaging.",
          ],
          code: { language: "html", value: addScriptExample },
        },
        {
          id: "show-ads",
          title: "Show Ads",
          body: [
            "Use simple Ads wording in your UI. Buttons such as Show Ad, Show Ads, or Continue with Ads are clear for users.",
          ],
          code: { language: "html", value: showAdsExample },
        },
        {
          id: "integration-id",
          title: "One Integration ID",
          body: [
            "Every publisher app uses one public Integration ID for SDK loading.",
            "Integration IDs are 6-10 digit non-sequential values such as 839204, 582913, 104728, or 93210482.",
            "Do not put internal database IDs, project IDs, zone IDs, network IDs, or credentials in public Mini App code.",
          ],
          bullets: [
            "Sandbox Integration ID: use this while testing.",
            "Production Integration ID: use this after the app is approved for production delivery.",
            "Current Mode: Publisher > Developer Center shows whether the app is in sandbox or production.",
          ],
        },
        {
          id: "full-html-example",
          title: "Full HTML Example",
          body: ["This is the smallest complete page: one script, one button, and one function call."],
          code: { language: "html", value: fullHtmlExample },
        },
        {
          id: "error-handling",
          title: "Handle Errors",
          body: [
            "AdsGalaxy returns structured errors. A rejected promise means the app should continue without crediting ad completion.",
          ],
          bullets: [
            "NO_FILL: no ad is available right now.",
            "INVALID_INIT_DATA: open the Mini App inside Telegram.",
            "APP_NOT_READY: the Mini App is not approved or ready for ads.",
            "TIMEOUT or SDK_UNAVAILABLE: show a retry option or continue without ads.",
          ],
          code: { language: "javascript", value: errorHandlingExample },
        },
        {
          id: "analytics",
          title: "Analytics",
          body: [
            "Publisher analytics focus on operational results: requests, impressions, completions, fill rate, errors, and revenue.",
            "AdsGalaxy does not expose network-level data, ranking, fallback order, project IDs, zone IDs, or internal credentials.",
          ],
        },
        {
          id: "sandbox-mode",
          title: "Sandbox Mode",
          body: [
            "Use the Sandbox Integration ID for testing. Sandbox checks your page flow without affecting production revenue or delivery.",
            "When your app is ready, switch to the Production Integration ID shown in Publisher > Developer Center.",
          ],
        },
        {
          id: "advanced-reliability",
          title: "Advanced Reliability",
          body: [
            "If your deployment uses a backup AdsGalaxy SDK domain, this loader can switch from the primary domain to the backup domain after a timeout.",
            "Keep YOUR_BACKUP_ADSGALAXY_DOMAIN as a placeholder until AdsGalaxy gives you a real backup domain.",
          ],
          code: { language: "html", value: enhancedLoaderExample },
        },
        {
          id: "advertisers",
          title: "For Advertisers",
          body: [
            "Advertisers do not add SDK code, JavaScript examples, API credentials, or Integration IDs.",
            "Advertiser pages explain how ads look, campaign examples, targeting examples, reporting examples, audience reach, and CPM basics.",
          ],
        },
      ]}
    />
  );
}
