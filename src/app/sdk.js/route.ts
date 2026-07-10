import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function sdkSource(defaultMiniappId: string, requestOrigin: string) {
  const fallbackOrigin = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_ADSGALAXY_APP_URL || requestOrigin || "https://app.adsgalaxy.online";
  const botUsername = process.env.TELEGRAM_BOT_USERNAME || process.env.NEXT_PUBLIC_BOT_USERNAME || "Ads_Galaxy_bot";
  return `(function(){
  "use strict";
  var DEFAULT_MINIAPP_ID=${JSON.stringify(defaultMiniappId)};
  var SCRIPT_ORIGIN=${JSON.stringify(requestOrigin)};
  var FALLBACK_ORIGIN=${JSON.stringify(fallbackOrigin)};
  var DEFAULT_PROVIDER_TIMEOUT_MS=2000;
  var currentScript=document.currentScript||Array.prototype.slice.call(document.scripts).find(function(s){return /\\/sdk\\.js(\\?|$)/.test(s.src||"");});
  if(currentScript&&currentScript.src){try{var u=new URL(currentScript.src);SCRIPT_ORIGIN=u.origin;DEFAULT_MINIAPP_ID=u.searchParams.get("id")||DEFAULT_MINIAPP_ID;}catch(e){}}
  var apiOrigins=Array.from(new Set([SCRIPT_ORIGIN,FALLBACK_ORIGIN].filter(Boolean).map(function(v){return String(v).replace(/\\/$/,"");})));
  var sdkLoads={};
  function tg(){return window.Telegram&&window.Telegram.WebApp?window.Telegram.WebApp:null;}
  function initData(options){var webApp=tg();return options&&options.initData||webApp&&webApp.initData||"";}
  function parseInitDataUser(auth){
    if(!auth)return null;
    try{var raw=new URLSearchParams(auth).get("user");return raw?JSON.parse(raw):null;}catch(e){return null;}
  }
  function telegramUser(options){var webApp=tg(),unsafeUser=webApp&&webApp.initDataUnsafe&&webApp.initDataUnsafe.user;return unsafeUser||parseInitDataUser(initData(options||{}));}
  function userId(options){var user=telegramUser(options||{});return options&&options.telegramUserId||options&&options.userId||user&&user.id||"";}
  function country(options){var user=telegramUser(options||{});return options&&options.country||user&&user.language_code||"";}
  function providerName(provider){
    return provider==="a"?"AdsGram":provider==="m"?"Monetag":provider==="x"?"AdExium":provider==="r"?"RichAds":provider==="g"?"GigaPub":provider==="i"?"AdsGalaxyInternal":provider||null;
  }
  function environmentDetails(provider,error,options){
    var webApp=tg(),auth=initData(options||{}),user=telegramUser(options||{});
    var inIframe=false;
    try{inIframe=window.self!==window.top;}catch(e){inIframe=true;}
    return {
      hasTelegramObject:Boolean(window.Telegram),
      hasWebApp:Boolean(webApp),
      initDataLength:auth.length,
      platform:webApp&&webApp.platform||"unknown",
      userExists:Boolean(user),
      providerSelected:providerName(provider),
      providerErrorMessage:error&&error.message||null,
      sameWindowContext:!inIframe,
      iframeIsolatedWithoutTelegram:inIframe&&!webApp
    };
  }
  function environmentDebug(provider,error){
    var details=environmentDetails(provider,error,arguments.length>2?arguments[2]:undefined);
    console.info("[AdsGalaxy SDK debug]",details);
    return details;
  }
  function prepareTelegram(options){
    var supplied=options&&options.initData||"",attempts=0;
    function inspect(){
      var webApp=tg();
      if(webApp){try{if(typeof webApp.ready==="function")webApp.ready();}catch(e){console.warn("[AdsGalaxy SDK] Telegram.WebApp.ready() failed",e);}}
      var auth=supplied||webApp&&webApp.initData||"";
      if(webApp&&auth){environmentDebug(null,null,options);return Promise.resolve(webApp);}
      if(attempts++<20)return new Promise(function(resolve){setTimeout(resolve,150);}).then(inspect);
      var details=environmentDebug(null,null,options);
      var missing=!details.hasWebApp||!details.initDataLength;
      return Promise.reject(sdkError(missing?"Please open this inside Telegram.":"Telegram initData is unavailable.","INVALID_INIT_DATA"));
    }
    if(!tg()){
      return loadScript("https://telegram.org/js/telegram-web-app.js",null).catch(function(){return undefined;}).then(inspect);
    }
    return inspect();
  }
  function request(path,payload,options){
    var headers={"Content-Type":"application/json"};
    var auth=initData(options||{});
    if(!auth)return Promise.reject(sdkError("Open this Mini App inside Telegram to show AdsGalaxy ads","INVALID_INIT_DATA"));
    headers["x-telegram-init-data"]=auth;
    var body=JSON.stringify(payload||{});
    var lastError;
    return apiOrigins.reduce(function(chain,origin){
      return chain.catch(function(){
        var controller=new AbortController(),timer=setTimeout(function(){controller.abort();},12000);
        return fetch(origin+path,{method:"POST",headers:headers,body:body,credentials:"omit",signal:controller.signal}).finally(function(){clearTimeout(timer);}).then(function(res){
          return res.json().catch(function(){return{};}).then(function(data){
            if(!res.ok||data.success===false)throw sdkError(data.message||data.error||"AdsGalaxy request failed",data.error_code||"REQUEST_FAILED");
            return data;
          });
        }).catch(function(e){lastError=e;throw e;});
      });
    },Promise.reject()).catch(function(){throw normalizeError(lastError||sdkError("AdsGalaxy request failed","REQUEST_FAILED"));});
  }
  function providerTimeoutMs(options){var ms=Number(options&&options.timeoutMs||DEFAULT_PROVIDER_TIMEOUT_MS)||DEFAULT_PROVIDER_TIMEOUT_MS;return Math.min(DEFAULT_PROVIDER_TIMEOUT_MS,ms);}
  function loadScript(src,globalName,timeoutMs){
    if(!src)return Promise.resolve();
    if(globalName&&window[globalName])return Promise.resolve();
    if(sdkLoads[src])return sdkLoads[src];
    sdkLoads[src]=new Promise(function(resolve,reject){
      var existing=document.querySelector('script[data-adsgalaxy-asset="'+CSS.escape(src)+'"]');
      if(existing&&existing.dataset.loaded==="true"){resolve();return;}
      var s=existing||document.createElement("script");
      var timer=setTimeout(function(){delete sdkLoads[src];reject(sdkError("Ad source timed out","TIMEOUT"));},timeoutMs||DEFAULT_PROVIDER_TIMEOUT_MS);
      s.async=true;s.src=src;s.dataset.adsgalaxyAsset=src;
      s.onload=function(){clearTimeout(timer);s.dataset.loaded="true";resolve();};
      s.onerror=function(){clearTimeout(timer);delete sdkLoads[src];reject(sdkError("Ad source failed to load","SDK_UNAVAILABLE"));};
      if(!existing)document.head.appendChild(s);
    });
    return sdkLoads[src];
  }
  function loadMonetagScript(src,zoneId,timeoutMs){
    if(!src)return Promise.reject(sdkError("Monetag SDK URL is not configured","SDK_NOT_CONFIGURED"));
    var globalName="show_"+zoneId;if(typeof window[globalName]==="function")return Promise.resolve(globalName);
    var key=src+":"+zoneId;if(sdkLoads[key])return sdkLoads[key].then(function(){return globalName;});
    sdkLoads[key]=new Promise(function(resolve,reject){var s=document.createElement("script"),timer=setTimeout(function(){delete sdkLoads[key];s.remove();reject(sdkError("Monetag SDK load timed out","TIMEOUT"));},timeoutMs||DEFAULT_PROVIDER_TIMEOUT_MS);s.async=true;s.src=src;s.dataset.zone=String(zoneId);s.dataset.sdk=globalName;s.onload=function(){clearTimeout(timer);if(typeof window[globalName]!=="function"){delete sdkLoads[key];reject(sdkError("Monetag SDK loaded without "+globalName,"SDK_LOAD_FAILED"));return;}resolve();};s.onerror=function(){clearTimeout(timer);delete sdkLoads[key];reject(sdkError("Monetag SDK failed to load","SDK_LOAD_FAILED"));};document.head.appendChild(s);});
    return sdkLoads[key].then(function(){return globalName;});
  }
  function sdkError(message,code){return {code:code||"NETWORK_ERROR",message:message||"AdsGalaxy request failed"};}
  function normalizeError(error,fallbackCode){
    if(!error)return sdkError("AdsGalaxy request failed",fallbackCode||"REQUEST_FAILED");
    return {code:error.code||error.error_code||fallbackCode||"REQUEST_FAILED",message:error.message||error.error||"AdsGalaxy request failed"};
  }
  function providerLog(provider,event,details){console.info("[AdsGalaxy mediation]",Object.assign({provider:providerName(provider),event:event},details||{}));}
  function loadProjectScript(sdk,projectId,timeoutMs){
    var bases=[sdk.script_url,sdk.backup_script_url].filter(Boolean);
    var i=0,lastError;
    var displayFn="show"+"Giga";
    function next(){
      if(i>=bases.length)return Promise.reject(lastError||sdkError("Ad source failed to load","SDK_LOAD_FAILED"));
      var base=bases[i++],src=base+(base.indexOf("?")>=0?"&":"?")+"id="+encodeURIComponent(projectId);
      return loadScript(src,null,timeoutMs).then(function(){
        if(typeof window[displayFn]!=="function")throw sdkError("Ad source unavailable","SDK_LOAD_FAILED");
      }).catch(function(e){lastError=e;return next();});
    }
    return timeout(next(),timeoutMs||DEFAULT_PROVIDER_TIMEOUT_MS);
  }
  function timeout(promise,ms){return new Promise(function(resolve,reject){var t=setTimeout(function(){reject(sdkError("Ad timed out","TIMEOUT"));},ms||DEFAULT_PROVIDER_TIMEOUT_MS);promise.then(function(v){clearTimeout(t);resolve(v);},function(e){clearTimeout(t);reject(e);});});}
  function showInternalAd(decision,options){
    var ad=decision.ad||{};
    if(!ad.title||!ad.landing_url)return Promise.reject(sdkError("Unable to load this advertisement. Please try again.","AD_UNAVAILABLE"));
    return new Promise(function(resolve){
      var max=15,started=Date.now(),completed=false,closed=false,impressionSent=false;
      var previousOverflow=document.body.style.overflow;
      var interval,completeTimer,impTimer,autoTimer;
      function elapsed(){return Math.min(max,(Date.now()-started)/1000);}
      function track(event){return request("/api/miniapp/internal-ads/impression",{request_id:decision.request_id,miniapp_id:Number(options.miniappId),telegram_user_id:String(userId(options)),event_type:event.event_type,watch_duration_seconds:event.watch_duration_seconds,completed:!!event.completed,abandonment_reason:event.abandonment_reason||""},options).catch(function(){});}
      var ctaPending=false,cta;
      function clickUrl(){return request("/api/conversions/click",{campaign_type:"miniapp",campaign_id:ad.id,miniapp_id:Number(options.miniappId),request_id:decision.request_id,session_id:String(userId(options))},options).then(function(data){return data.url||ad.landing_url;});}
      function openDestination(url){var webApp=window.Telegram&&window.Telegram.WebApp;try{if(/^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\//i.test(url)&&webApp&&typeof webApp.openTelegramLink==="function"){webApp.openTelegramLink(url);return true;}if(webApp&&typeof webApp.openLink==="function"){webApp.openLink(url);return true;}var opened=window.open(url,"_blank","noopener,noreferrer");if(opened)return true;if(/^https?:\/\//i.test(url)){window.location.href=url;return true;}}catch(e){}return false;}
      function openAd(){if(ctaPending)return;ctaPending=true;if(cta)cta.disabled=true;clickUrl().then(function(url){if(!openDestination(url))throw sdkError("Unable to open advertisement","OPEN_FAILED");}).catch(function(){ctaPending=false;if(cta)cta.disabled=false;});}
      function cleanup(){document.removeEventListener("visibilitychange",vis);window.removeEventListener("pagehide",hide);clearInterval(interval);clearTimeout(completeTimer);clearTimeout(impTimer);clearTimeout(autoTimer);}
      function closeOverlay(){if(closed)return;closed=true;cleanup();document.body.style.overflow=previousOverflow;overlay.remove();}
      function complete(){if(completed)return;completed=true;track({event_type:"completed",watch_duration_seconds:15,completed:true});countdownBox.hidden=true;close.hidden=false;close.disabled=false;clearInterval(interval);resolve({request_id:decision.request_id,reward_eligible:true,completed:true});autoTimer=setTimeout(closeOverlay,2000);}
      function vis(){if(document.visibilityState==="hidden"&&!completed&&!closed)track({event_type:"app_backgrounded",watch_duration_seconds:elapsed(),abandonment_reason:"app_backgrounded"});}
      function hide(){if(!completed&&!closed)track({event_type:"session_abandoned",watch_duration_seconds:elapsed(),abandonment_reason:"session_abandoned"});}
      var botUrl="https://t.me/${botUsername}";
      var displayTitle=String(ad.title||"").trim().slice(0,50),displayDesc=String(ad.description||"").trim().slice(0,200),displayCta=String(ad.cta_text||"Learn More").trim().slice(0,24)||"Learn More",defaultLogoUrl=(SCRIPT_ORIGIN||FALLBACK_ORIGIN)+"/logo.svg",logoUrl=String(ad.advertiser_logo_url||ad.logo_url||defaultLogoUrl).trim();
      var overlay=document.createElement("div");overlay.className="agx-rewarded-overlay";
      var style=document.createElement("style");style.textContent=".agx-rewarded-overlay{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:calc(env(safe-area-inset-top) + 10px) max(10px,env(safe-area-inset-right)) calc(env(safe-area-inset-bottom) + 10px) max(10px,env(safe-area-inset-left));font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#f8fafc;background:radial-gradient(circle at 20% 6%,rgba(99,102,241,.36),transparent 26%),radial-gradient(circle at 84% 14%,rgba(34,211,238,.2),transparent 26%),radial-gradient(circle at 50% 100%,rgba(56,20,120,.28),transparent 40%),linear-gradient(180deg,#020617 0%,#07101e 48%,#020617 100%);animation:agxRewardedFade .18s ease-out;overflow:hidden}"
        +".agx-rewarded-overlay,.agx-rewarded-overlay *{box-sizing:border-box}"
        +".agx-rewarded-overlay:before{content:'';position:absolute;inset:0;background-image:radial-gradient(circle,rgba(255,255,255,.2) 0 1px,transparent 1.5px),radial-gradient(circle,rgba(125,211,252,.16) 0 1px,transparent 1.4px);background-size:92px 92px,137px 137px;background-position:12px 18px,48px 60px;opacity:.32;pointer-events:none}"
        +".agx-rewarded-overlay:after{content:'';position:absolute;inset:0;background:linear-gradient(115deg,transparent 0 24%,rgba(255,255,255,.045) 36%,transparent 50% 100%);pointer-events:none}"
        +".agx-rewarded-card{position:relative;z-index:1;width:min(410px,92vw);max-height:calc(100dvh - 20px);display:flex;flex-direction:column;overflow:hidden;border-radius:26px;background:linear-gradient(180deg,rgba(17,24,39,.98),rgba(5,11,23,.98));border:1px solid rgba(203,213,225,.14);box-shadow:0 28px 90px rgba(0,0,0,.66),0 0 0 1px rgba(99,102,241,.08),0 0 48px rgba(79,70,229,.2),inset 0 1px 0 rgba(255,255,255,.06);animation:agxRewardedPop .22s cubic-bezier(.2,.8,.2,1)}"
        +".agx-rewarded-top{position:absolute;top:0;left:0;right:0;z-index:6;display:flex;align-items:center;justify-content:space-between;padding:10px 10px 0;pointer-events:none}"
        +".agx-rewarded-heading{pointer-events:none;display:inline-flex;align-items:center;font-size:10px;line-height:1;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#f8fafc;background:rgba(8,13,26,.55);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.16);padding:6px 10px;border-radius:999px}"
        +".agx-rewarded-close{pointer-events:auto;width:30px;height:30px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(8,13,26,.55);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:#fff;display:none;align-items:center;justify-content:center;font-size:19px;line-height:1;font-weight:300;cursor:pointer;transition:background .15s ease}"
        +".agx-rewarded-close:active{background:rgba(8,13,26,.78)}"
        +".agx-rewarded-close[hidden]{display:none}"
        +".agx-rewarded-media{position:relative;display:block;width:100%;flex:0 0 auto;height:clamp(150px,42dvh,300px);background:linear-gradient(160deg,#0b1224,#111c34);overflow:hidden;cursor:pointer}"
        +".agx-rewarded-media:after{content:'';position:absolute;left:0;right:0;bottom:0;height:48px;background:linear-gradient(180deg,transparent,rgba(6,10,20,.88));pointer-events:none}"
        +".agx-rewarded-hero{display:block;width:100%;height:100%;object-fit:cover;object-position:center top;background:transparent}"
        +".agx-rewarded-placeholder{display:flex;width:100%;height:100%;align-items:center;justify-content:center;flex-direction:column;gap:8px;background:linear-gradient(135deg,#0f172a,#1e3a8a 54%,#0ea5e9);color:#fff;font-weight:950;text-align:center}"
        +".agx-rewarded-placeholder-mark{position:relative;width:44px;height:44px;border-radius:14px;background:rgba(255,255,255,.13);box-shadow:inset 0 1px 0 rgba(255,255,255,.2)}"
        +".agx-rewarded-placeholder-mark:before{content:'';position:absolute;inset:12px;border:3px solid #fff;border-right-color:transparent;border-radius:999px;transform:rotate(-24deg)}"
        +".agx-rewarded-placeholder-text{font-size:13px}"
        +".agx-rewarded-content{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;justify-content:center;padding:14px 18px;text-align:center;overflow:hidden}"
        +".agx-rewarded-card--no-media .agx-rewarded-content{padding-top:46px}"
        +".agx-rewarded-body{display:flex;flex-direction:column;align-items:center;text-align:center;min-height:0}"
        +".agx-rewarded-logo{width:24px;height:24px;border-radius:8px;object-fit:cover;border:1px solid rgba(255,255,255,.16);background:#0f172a;margin:0 auto 6px}"
        +".agx-rewarded-title{margin:0 auto 4px;max-width:100%;font-size:17px;line-height:1.25;font-weight:900;letter-spacing:-.01em;color:#fff;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}"
        +".agx-rewarded-desc{margin:0 auto 10px;width:100%;max-width:100%;color:#aab4c8;font-size:10.5px;line-height:1.3;font-weight:600;letter-spacing:-.01em;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}"
        +".agx-rewarded-cta{width:100%;min-height:44px;border:0;border-radius:14px;background:linear-gradient(135deg,#5b5cff 0%,#2563eb 52%,#14b8a6 100%);color:#fff;font-size:15px;font-weight:950;letter-spacing:-.005em;padding:11px 16px;cursor:pointer;box-shadow:0 14px 30px rgba(37,99,235,.34),inset 0 1px 0 rgba(255,255,255,.18);transition:transform .15s ease,box-shadow .15s ease;flex:0 0 auto}"
        +".agx-rewarded-cta:active{transform:scale(.98);box-shadow:0 8px 20px rgba(37,99,235,.3),inset 0 1px 0 rgba(255,255,255,.18)}.agx-rewarded-cta:disabled{opacity:.65;cursor:wait}"
        +".agx-rewarded-sponsored{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:10px;text-decoration:none;font-size:11px;font-weight:800;color:#8791a8;flex:0 0 auto}"
        +".agx-rewarded-mark{position:relative;display:inline-flex;width:16px;height:16px;border-radius:999px;align-items:center;justify-content:center;background:conic-gradient(from 140deg,#22d3ee,#5b5cff,#8b5cf6,#22d3ee);box-shadow:0 0 14px rgba(91,92,255,.26)}"
        +".agx-rewarded-mark:before{content:'';position:absolute;inset:4px;border:1.5px solid rgba(255,255,255,.88);border-right-color:transparent;border-radius:999px;transform:rotate(-22deg)}"
        +".agx-rewarded-mark:after{content:'';position:absolute;width:3px;height:3px;border-radius:999px;background:#fff;box-shadow:0 0 6px rgba(255,255,255,.7);transform:translate(4px,-4px)}"
        +".agx-rewarded-sponsored strong{color:#7477ff}"
        +".agx-rewarded-countdown{pointer-events:none;display:flex;align-items:center;justify-content:center}"
        +".agx-rewarded-countdown[hidden]{display:none}"
        +".agx-rewarded-countdown-label{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}"
        +".agx-rewarded-ring-wrap{position:relative;width:30px;height:30px;flex:0 0 auto;border-radius:999px;background:rgba(8,13,26,.55);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.18)}"
        +".agx-rewarded-ring{width:30px;height:30px;transform:rotate(-90deg)}"
        +".agx-rewarded-ring circle{fill:none;stroke-width:3}"
        +".agx-rewarded-ring-track{stroke:rgba(148,163,184,.28)}"
        +".agx-rewarded-ring-progress{stroke:#6366f1;stroke-linecap:round;transition:stroke-dashoffset .28s linear}"
        +".agx-rewarded-ring-text{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:950;font-variant-numeric:tabular-nums}"
        +"@keyframes agxRewardedFade{from{opacity:0}to{opacity:1}}"
        +"@keyframes agxRewardedPop{from{opacity:0;transform:translate3d(0,10px,0) scale(.975)}to{opacity:1;transform:translate3d(0,0,0) scale(1)}}"
        +"@media (orientation:landscape) and (max-height:500px){.agx-rewarded-media{height:clamp(90px,30dvh,160px)}.agx-rewarded-content{padding:10px 16px}.agx-rewarded-title{font-size:15px}.agx-rewarded-desc{font-size:11.5px}.agx-rewarded-card--no-media .agx-rewarded-content{padding-top:40px}}"
        +"@media (max-width:340px){.agx-rewarded-title{font-size:15px}.agx-rewarded-desc{font-size:11.5px}.agx-rewarded-cta{font-size:14px;min-height:42px}}"
        +"@media (min-width:480px){.agx-rewarded-content{padding:18px 24px}}";
      var panel=document.createElement("div");panel.className="agx-rewarded-card"+(ad.image_url?"":" agx-rewarded-card--no-media");panel.setAttribute("role","dialog");panel.setAttribute("aria-modal","true");panel.setAttribute("aria-label","Sponsored ad");
      var head=document.createElement("div");head.className="agx-rewarded-top";var heading=document.createElement("div");heading.className="agx-rewarded-heading";heading.textContent="Ads";var close=document.createElement("button");close.type="button";close.textContent="x";close.setAttribute("aria-label","Close ad");close.disabled=true;close.hidden=true;close.className="agx-rewarded-close";head.appendChild(heading);head.appendChild(close);panel.appendChild(head);
      if(ad.image_url){var media=document.createElement("div");media.className="agx-rewarded-media";var img=document.createElement("img");img.src=ad.image_url;img.alt=displayTitle;img.loading="eager";img.decoding="async";img.className="agx-rewarded-hero";img.onerror=function(){img.remove();var ph=document.createElement("div");ph.className="agx-rewarded-placeholder";ph.setAttribute("aria-label","AdsGalaxy ad creative");ph.innerHTML="<span class='agx-rewarded-placeholder-mark' aria-hidden='true'></span><span class='agx-rewarded-placeholder-text'>AdsGalaxy</span>";media.appendChild(ph);};media.appendChild(img);panel.appendChild(media);}
      var content=document.createElement("div");content.className="agx-rewarded-content";
      var body=document.createElement("div");body.className="agx-rewarded-body";var logo=document.createElement("img");logo.src=logoUrl;logo.alt="";logo.className="agx-rewarded-logo";logo.onerror=function(){if(logo.src!==defaultLogoUrl)logo.src=defaultLogoUrl;};body.appendChild(logo);var title=document.createElement("div");title.textContent=displayTitle;title.className="agx-rewarded-title";if(ad.title_color)title.style.color=ad.title_color;var desc=document.createElement("div");desc.textContent=displayDesc;desc.className="agx-rewarded-desc";if(ad.body_color)desc.style.color=ad.body_color;cta=document.createElement("button");cta.type="button";cta.textContent=displayCta;cta.className="agx-rewarded-cta";cta.onclick=openAd;body.appendChild(title);body.appendChild(desc);body.appendChild(cta);content.appendChild(body);
      var sponsor=document.createElement("a");sponsor.href=botUrl;sponsor.target="_blank";sponsor.rel="noopener noreferrer";sponsor.className="agx-rewarded-sponsored";sponsor.innerHTML="<span class='agx-rewarded-mark' aria-hidden='true'></span><span>Ad &middot; Sponsored by</span><strong>AdsGalaxy</strong>";
      var countdownBox=document.createElement("div");countdownBox.className="agx-rewarded-countdown";var label=document.createElement("div");label.className="agx-rewarded-countdown-label";label.innerHTML="<span>Skip in <strong>15s</strong></span>";var ring=document.createElement("div");ring.className="agx-rewarded-ring-wrap";ring.innerHTML="<svg class='agx-rewarded-ring' viewBox='0 0 48 48' aria-hidden='true'><circle class='agx-rewarded-ring-track' cx='24' cy='24' r='20'></circle><circle class='agx-rewarded-ring-progress' cx='24' cy='24' r='20'></circle></svg><span class='agx-rewarded-ring-text'>15</span>";var progress=ring.querySelector(".agx-rewarded-ring-progress"),ringText=ring.querySelector(".agx-rewarded-ring-text"),ringLength=2*Math.PI*20;progress.style.strokeDasharray=String(ringLength);progress.style.strokeDashoffset="0";countdownBox.appendChild(label);countdownBox.appendChild(ring);
      content.appendChild(sponsor);head.appendChild(countdownBox);panel.appendChild(content);overlay.appendChild(style);overlay.appendChild(panel);document.body.style.overflow="hidden";document.body.appendChild(overlay);
      impTimer=setTimeout(function(){impressionSent=true;track({event_type:"impression_recorded",watch_duration_seconds:1.5});},1500);
      interval=setInterval(function(){var remaining=Math.max(0,Math.ceil(max-elapsed())),passed=Math.min(max,elapsed());label.innerHTML="<span>Skip in <strong>"+remaining+"s</strong></span>";ringText.textContent=String(remaining);progress.style.strokeDashoffset=String(ringLength*(passed/max));if(remaining<=0)complete();else if(impressionSent&&remaining%5===0)track({event_type:"watch_update",watch_duration_seconds:elapsed()});},250);
      completeTimer=setTimeout(complete,max*1000);close.onclick=closeOverlay;document.addEventListener("visibilitychange",vis);window.addEventListener("pagehide",hide);
    });
  }
  function showExternalAd(decision,options){
    var c=decision.config||{},sdk=c.sdk||{},globalName=c.global_name||sdk.global_name;
    var providerTimeout=providerTimeoutMs(options);
    var env=environmentDetails(decision.adapter,null,options);
    if(!env.hasWebApp||!env.initDataLength){
      return Promise.reject(sdkError("Telegram.WebApp/initData is unavailable in this window context","INVALID_INIT_DATA"));
    }
    if(decision.adapter==="g"){
      return loadProjectScript(sdk,c.placement_id,providerTimeout).then(function(){
        return timeout(window["show"+"Giga"](),providerTimeout);
      }).catch(function(e){
        var msg=e&&e.message||"Ad source unavailable";
        var lower=String(msg).toLowerCase();
        throw sdkError(msg,lower.indexOf("timed out")>=0?"TIMEOUT":(lower.indexOf("no fill")>=0||lower.indexOf("no ad")>=0?"NO_FILL":e.code||"AD_UNAVAILABLE"));
      }).then(function(result){
        return request("/api/sdk/miniapp/impression",{request_id:decision.request_id,miniapp_id:Number(options.miniappId),telegram_user_id:String(userId(options)),country:country(options)},options).then(function(data){return {request_id:decision.request_id,reward_eligible:Boolean(data.reward_eligible),status:data.status,raw_result:result};});
      });
    }
    if(decision.adapter==="x"){
      return loadScript(c.script_url||sdk.script_url,globalName,providerTimeout).then(function(){
        if(typeof window.AdexiumWidget!=="function")throw sdkError("AdExium widget unavailable","SDK_UNAVAILABLE");
        var widget=new window.AdexiumWidget({wid:c.placement_id,adFormat:"interstitial",debug:false});
        return timeout(new Promise(function(resolve,reject){
          var settled=false;
          function cleanup(){["adReceived","noAdFound","adDisplayed","adPlaybackCompleted"].forEach(function(name){try{widget.off(name,listeners[name]);}catch(e){}});}
          function finish(fn,value){if(settled)return;settled=true;cleanup();fn(value);}
          var listeners={
            adReceived:function(ad){try{if(!ad)throw sdkError("AdExium returned an invalid response","INVALID_RESPONSE");widget.displayAd(ad);}catch(e){finish(reject,sdkError(e.message||"AdExium render failed","RENDER_FAILED"));}},
            noAdFound:function(){finish(reject,sdkError("AdExium returned no ad","NO_FILL"));},
            adDisplayed:function(){finish(resolve,{displayed:true});},
            adPlaybackCompleted:function(){finish(resolve,{displayed:true,completed:true});}
          };
          Object.keys(listeners).forEach(function(name){widget.on(name,listeners[name]);});
          try{widget.requestAd("interstitial");}catch(e){finish(reject,sdkError(e.message||"AdExium request failed","NETWORK_ERROR"));}
        }),providerTimeout).finally(function(){try{if(typeof widget.destroy==="function")widget.destroy();}catch(e){}});
      }).then(function(result){
        return request("/api/sdk/miniapp/impression",{request_id:decision.request_id,miniapp_id:Number(options.miniappId),telegram_user_id:String(userId(options)),country:country(options)},options).then(function(data){return {request_id:decision.request_id,reward_eligible:Boolean(data.reward_eligible),status:data.status,raw_result:result};});
      });
    }
    if(decision.adapter==="m"){
      return loadMonetagScript(c.script_url||sdk.script_url,c.placement_id,providerTimeout).then(function(monetagGlobal){return timeout(window[monetagGlobal]({type:"end"}),providerTimeout);}).then(function(result){return request("/api/sdk/miniapp/impression",{request_id:decision.request_id,miniapp_id:Number(options.miniappId),telegram_user_id:String(userId(options)),country:country(options)},options).then(function(data){return {request_id:decision.request_id,reward_eligible:Boolean(data.reward_eligible),status:data.status,raw_result:result};});});
    }
    if(decision.adapter==="r"){
      return loadScript(c.script_url||sdk.script_url,globalName,providerTimeout).then(function(){
        if(typeof window.TelegramAdsController!=="function")throw sdkError("RichAds controller unavailable","SDK_UNAVAILABLE");
        var controller=new window.TelegramAdsController();
        controller.initialize({pubId:sdk.richads_publisher_id,appId:sdk.richads_app_id});
        if(typeof controller.triggerInterstitialVideo!=="function")throw sdkError("RichAds Telegram Interstitial Video is unavailable","SDK_UNAVAILABLE");
        return timeout(controller.triggerInterstitialVideo(),providerTimeout);
      }).then(function(result){
        return request("/api/sdk/miniapp/impression",{request_id:decision.request_id,miniapp_id:Number(options.miniappId),telegram_user_id:String(userId(options)),country:country(options)},options).then(function(data){return {request_id:decision.request_id,reward_eligible:Boolean(data.reward_eligible),status:data.status,raw_result:result};});
      });
    }
    return loadScript(c.script_url||sdk.script_url,globalName,providerTimeout).then(function(){
      var g=globalName&&window[globalName];
      var requestTimeout=providerTimeout;
      if(g&&typeof g.init==="function"){var controller=g.init({blockId:c.placement_id});if(controller&&typeof controller.show==="function")return timeout(controller.show(),requestTimeout);}
      if(typeof g==="function")return timeout(Promise.resolve(g(c.placement_id)).then(function(fn){return typeof fn==="function"?fn({type:"end"}):fn;}),requestTimeout);
      if(g&&typeof g.show==="function")return timeout(g.show({placementId:c.placement_id,projectId:c.placement_id}),requestTimeout);
      throw sdkError("Ad source unavailable","SDK_UNAVAILABLE");
    }).then(function(result){
      return request("/api/sdk/miniapp/impression",{request_id:decision.request_id,miniapp_id:Number(options.miniappId),telegram_user_id:String(userId(options)),country:country(options)},options).then(function(data){return {request_id:decision.request_id,reward_eligible:Boolean(data.reward_eligible),status:data.status,raw_result:result};});
    });
  }
  function display(decision,options){return decision.adapter==="i"?showInternalAd(decision,options):showExternalAd(decision,options);}
  function showLoading(){
    var previousOverflow=document.body.style.overflow;
    var overlay=document.createElement("div");
    overlay.setAttribute("data-agx-loading","true");
    overlay.style.cssText="position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:18px;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:radial-gradient(circle at 20% 12%,rgba(79,70,229,.3),transparent 28%),linear-gradient(180deg,#020617 0%,#08111f 52%,#020617 100%);color:#f8fafc;";
    var card=document.createElement("div");
    card.style.cssText="width:min(360px,92vw);border-radius:22px;padding:22px;text-align:center;background:linear-gradient(180deg,rgba(15,23,42,.98),rgba(6,12,24,.98));border:1px solid rgba(148,163,184,.18);box-shadow:0 28px 90px rgba(0,0,0,.62),0 0 42px rgba(79,70,229,.2);font-size:15px;font-weight:850;";
    card.textContent="Loading advertisement...";
    overlay.appendChild(card);
    document.body.style.overflow="hidden";
    document.body.appendChild(overlay);
    return function(){document.body.style.overflow=previousOverflow;overlay.remove();};
  }
  function run(options){
    options=options||{};options.miniappId=Number(options.miniappId||options.miniapp_id||DEFAULT_MINIAPP_ID);
    if(!options.miniappId)return Promise.reject(sdkError("AdsGalaxy Mini App ID is required","INVALID_APP"));
    var removeLoading=null;
    function attempt(decision){
      if(removeLoading){removeLoading();removeLoading=null;}
      if(!decision||decision.success===false)throw sdkError(decision&&decision.message||"No advertisements are available at the moment. Please try again shortly.",decision&&decision.error_code||"NO_FILL");
      environmentDebug(decision.adapter,null,options);var providerStartedAt=Date.now();providerLog(decision.adapter,"started",{request_id:decision.request_id});
      return display(decision,options).catch(function(e){
        var duration=Date.now()-providerStartedAt;environmentDebug(decision.adapter,e,options);providerLog(decision.adapter,"failed",{request_id:decision.request_id,duration_ms:duration,result:e.code||"NETWORK_ERROR",reason:e.message||"Ad source failed",timeout:e.code==="TIMEOUT",no_fill:e.code==="NO_FILL"});
        if(!decision.fallback_available)throw normalizeError(e);
        return request("/api/sdk/miniapp/fallback",{request_id:decision.request_id,miniapp_id:Number(options.miniappId),telegram_user_id:String(userId(options)),error_code:e.code||"NETWORK_ERROR",error_message:e.message||"Ad source failed",duration_ms:duration,started_at:new Date(providerStartedAt).toISOString(),finished_at:new Date().toISOString()},options).then(attempt);
      }).then(function(result){providerLog(decision.adapter,"completed",{request_id:decision.request_id,duration_ms:Date.now()-providerStartedAt,result:"render_success",impression_success:true,completion_success:Boolean(result&&result.reward_eligible)});return result;});
    }
    var promise=prepareTelegram(options).then(function(){
      removeLoading=showLoading();
      var payload={miniapp_id:options.miniappId,telegram_user_id:String(userId(options)),country:country(options),ad_format:options.adFormat||"rewarded"};
      return request("/api/sdk/miniapp/request",payload,options);
    }).then(attempt).catch(function(error){if(removeLoading){removeLoading();removeLoading=null;}environmentDebug(null,error,options);throw normalizeError(error);});
    promise.then(function(result){if(typeof options.onSuccess==="function")options.onSuccess(result);},function(error){if(typeof options.onError==="function")options.onError(error);});
    return promise;
  }
  window.showAdsGalaxy=function(options,onSuccess,onError){
    options=options||{};
    if(typeof options==="function"){onError=onSuccess;onSuccess=options;options={};}
    if(onSuccess)options.onSuccess=onSuccess;
    if(onError)options.onError=onError;
    return run(options);
  };
  window.AdsGalaxy={show:window.showAdsGalaxy,debugEnvironment:environmentDebug,version:"14T"};
})();`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const miniappId = url.searchParams.get("id") || "";
  const origin = `${url.protocol}//${url.host}`;
  return new NextResponse(sdkSource(miniappId, origin), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    },
  });
}

