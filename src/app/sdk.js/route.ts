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
  function loadScript(src,globalName){
    if(!src)return Promise.resolve();
    if(globalName&&window[globalName])return Promise.resolve();
    if(sdkLoads[src])return sdkLoads[src];
    sdkLoads[src]=new Promise(function(resolve,reject){
      var existing=document.querySelector('script[data-adsgalaxy-asset="'+CSS.escape(src)+'"]');
      if(existing&&existing.dataset.loaded==="true"){resolve();return;}
      var s=existing||document.createElement("script");
      var timer=setTimeout(function(){delete sdkLoads[src];reject(sdkError("Ad source timed out","TIMEOUT"));},15000);
      s.async=true;s.src=src;s.dataset.adsgalaxyAsset=src;
      s.onload=function(){clearTimeout(timer);s.dataset.loaded="true";resolve();};
      s.onerror=function(){clearTimeout(timer);delete sdkLoads[src];reject(sdkError("Ad source failed to load","SDK_UNAVAILABLE"));};
      if(!existing)document.head.appendChild(s);
    });
    return sdkLoads[src];
  }
  function sdkError(message,code){return {code:code||"NETWORK_ERROR",message:message||"AdsGalaxy request failed"};}
  function normalizeError(error,fallbackCode){
    if(!error)return sdkError("AdsGalaxy request failed",fallbackCode||"REQUEST_FAILED");
    return {code:error.code||error.error_code||fallbackCode||"REQUEST_FAILED",message:error.message||error.error||"AdsGalaxy request failed"};
  }
  function loadProjectScript(sdk,projectId,timeoutMs){
    var bases=[sdk.script_url,sdk.backup_script_url].filter(Boolean);
    var i=0,lastError;
    var displayFn="show"+"Giga";
    function next(){
      if(i>=bases.length)return Promise.reject(lastError||sdkError("Ad source failed to load","SDK_LOAD_FAILED"));
      var base=bases[i++],src=base+(base.indexOf("?")>=0?"&":"?")+"id="+encodeURIComponent(projectId);
      return loadScript(src,null).then(function(){
        if(typeof window[displayFn]!=="function")throw sdkError("Ad source unavailable","SDK_LOAD_FAILED");
      }).catch(function(e){lastError=e;return next();});
    }
    return timeout(next(),sdk.script_timeout_ms||15000);
  }
  function timeout(promise,ms){return new Promise(function(resolve,reject){var t=setTimeout(function(){reject(sdkError("Ad timed out","TIMEOUT"));},ms||30000);promise.then(function(v){clearTimeout(t);resolve(v);},function(e){clearTimeout(t);reject(e);});});}
  function showInternalAd(decision,options){
    var ad=decision.ad||{};
    if(!ad.title||!ad.landing_url)return Promise.reject(sdkError("Ad unavailable","AD_UNAVAILABLE"));
    return new Promise(function(resolve,reject){
      var done=false,started=Date.now(),max=15,impressionSent=false;
      function elapsed(){return Math.min(max,(Date.now()-started)/1000);}
      function track(event){return request("/api/miniapp/internal-ads/impression",{request_id:decision.request_id,miniapp_id:Number(options.miniappId),telegram_user_id:String(userId(options)),event_type:event.event_type,watch_duration_seconds:event.watch_duration_seconds,completed:!!event.completed,abandonment_reason:event.abandonment_reason||""},options).catch(function(){});}
      function clickUrl(){return request("/api/conversions/click",{campaign_type:"miniapp",campaign_id:ad.id,miniapp_id:Number(options.miniappId),request_id:decision.request_id,session_id:String(userId(options))},options).then(function(data){return data.url||ad.landing_url;}).catch(function(){return ad.landing_url;});}
      function openAd(){clickUrl().then(function(url){window.open(url,"_blank","noopener,noreferrer");});}
      function cleanup(){document.removeEventListener("visibilitychange",vis);window.removeEventListener("pagehide",hide);clearInterval(interval);clearTimeout(impTimer);}
      function complete(){if(done)return;done=true;track({event_type:"completed",watch_duration_seconds:15,completed:true}).then(function(){cleanup();overlay.remove();resolve({request_id:decision.request_id,reward_eligible:true,completed:true});});}
      function fail(reason){if(done)return;done=true;track({event_type:"ad_abandoned",watch_duration_seconds:elapsed(),abandonment_reason:reason});cleanup();overlay.remove();reject(sdkError("Ad was not completed","USER_CLOSED"));}
      function vis(){if(document.visibilityState==="hidden"&&!done)track({event_type:"app_backgrounded",watch_duration_seconds:elapsed(),abandonment_reason:"app_backgrounded"});}
      function hide(){if(!done)track({event_type:"session_abandoned",watch_duration_seconds:elapsed(),abandonment_reason:"session_abandoned"});}
      var displayTitle=String(ad.title||"").trim().slice(0,40),displayDesc=String(ad.description||"").trim().slice(0,120),displayCta=String(ad.cta_text||"Learn More").trim().slice(0,40)||"Learn More";
      var overlay=document.createElement("div");overlay.className="agx-rewarded-overlay";
      var style=document.createElement("style");style.textContent=".agx-rewarded-overlay{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:calc(max(6vh,env(safe-area-inset-top)) + 12px) max(16px,env(safe-area-inset-right)) calc(max(6vh,env(safe-area-inset-bottom)) + 12px) max(16px,env(safe-area-inset-left));font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:radial-gradient(circle at 50% 0%,rgba(96,165,250,.18),transparent 32%),rgba(2,6,23,.82);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);animation:agxRewardedFade .18s ease-out}.agx-rewarded-card{position:relative;width:min(420px,100%);max-height:calc(100dvh - max(12vh,96px));overflow:auto;border-radius:32px;padding:16px;color:#f8fafc;background:linear-gradient(180deg,rgba(15,23,42,.96),rgba(2,6,23,.98));border:1px solid rgba(255,255,255,.14);box-shadow:0 32px 90px rgba(0,0,0,.48),0 14px 44px rgba(37,99,235,.18);text-align:left;animation:agxRewardedPop .24s cubic-bezier(.2,.8,.2,1);overscroll-behavior:contain}.agx-rewarded-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.agx-rewarded-brand{min-width:0;color:#94a3b8;font-size:12px;font-weight:800;letter-spacing:.01em;white-space:nowrap}.agx-rewarded-brand a{color:#e0e7ff;text-decoration:none}.agx-rewarded-actions{display:flex;align-items:center;gap:10px;flex-shrink:0}.agx-rewarded-timer{min-width:48px;height:36px;padding:0 12px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.14);color:#fff;font-size:13px;font-weight:950;font-variant-numeric:tabular-nums}.agx-rewarded-close{width:44px;height:44px;border-radius:999px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.1);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:24px;line-height:1;font-weight:500;box-shadow:0 12px 30px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.14);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);cursor:pointer;transition:transform .16s ease,opacity .16s ease,background .16s ease}.agx-rewarded-close:disabled{opacity:.48;cursor:not-allowed}.agx-rewarded-hero{display:block;width:100%;aspect-ratio:4/5;max-height:min(56dvh,520px);object-fit:cover;background:#0f172a;border-radius:26px;box-shadow:0 18px 52px rgba(0,0,0,.34);cursor:pointer}.agx-rewarded-body{padding:18px 4px 2px;text-align:center}.agx-rewarded-title{margin:0 auto 8px;max-width:100%;font-size:21px;line-height:1.18;font-weight:950;letter-spacing:-.025em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#fff}.agx-rewarded-desc{margin:0 auto 18px;max-width:340px;color:#cbd5e1;font-size:14px;line-height:1.45;font-weight:650;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.agx-rewarded-cta{width:100%;min-height:50px;border:0;border-radius:18px;background:linear-gradient(135deg,#7c3aed 0%,#2563eb 48%,#06b6d4 100%);color:#fff;font-size:15px;font-weight:950;padding:14px 18px;cursor:pointer;box-shadow:0 16px 34px rgba(37,99,235,.34);transition:transform .16s ease,filter .16s ease}@keyframes agxRewardedFade{from{opacity:0}to{opacity:1}}@keyframes agxRewardedPop{from{opacity:0;transform:translate3d(0,10px,0) scale(.975)}to{opacity:1;transform:translate3d(0,0,0) scale(1)}}@media (prefers-color-scheme:light){.agx-rewarded-overlay{background:radial-gradient(circle at 50% 0%,rgba(59,130,246,.15),transparent 34%),rgba(248,250,252,.72)}.agx-rewarded-card{background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(248,250,252,.98));border-color:rgba(15,23,42,.08);box-shadow:0 32px 90px rgba(15,23,42,.18),0 12px 40px rgba(37,99,235,.12);color:#0f172a}.agx-rewarded-brand{color:#64748b}.agx-rewarded-brand a{color:#334155}.agx-rewarded-timer,.agx-rewarded-close{background:rgba(15,23,42,.06);border-color:rgba(15,23,42,.08);color:#0f172a}.agx-rewarded-title{color:#0f172a}.agx-rewarded-desc{color:#475569}.agx-rewarded-hero{background:#e2e8f0}}@media (orientation:landscape) and (max-height:560px){.agx-rewarded-overlay{padding:calc(env(safe-area-inset-top) + 10px) max(16px,env(safe-area-inset-right)) calc(env(safe-area-inset-bottom) + 10px) max(16px,env(safe-area-inset-left))}.agx-rewarded-card{width:min(640px,100%);max-height:calc(100dvh - 20px);border-radius:24px}.agx-rewarded-hero{max-height:42dvh}.agx-rewarded-body{padding-top:12px}}";
      var panel=document.createElement("div");panel.className="agx-rewarded-card";panel.setAttribute("role","dialog");panel.setAttribute("aria-modal","true");panel.setAttribute("aria-label","Sponsored rewarded ad");
      var head=document.createElement("div");head.className="agx-rewarded-top";var sponsor=document.createElement("div");sponsor.className="agx-rewarded-brand";sponsor.innerHTML="Sponsored &middot; <a href='${`https://t.me/${botUsername}`}' target='_blank' rel='noopener noreferrer'>AdsGalaxy</a>";var actions=document.createElement("div");actions.className="agx-rewarded-actions";var count=document.createElement("div");count.className="agx-rewarded-timer";count.textContent="15s";var close=document.createElement("button");close.type="button";close.textContent="×";close.setAttribute("aria-label","Close ad");close.disabled=true;close.className="agx-rewarded-close";close.onclick=complete;actions.appendChild(count);actions.appendChild(close);head.appendChild(sponsor);head.appendChild(actions);panel.appendChild(head);
      if(ad.image_url){var img=document.createElement("img");img.src=ad.image_url;img.alt=displayTitle;img.loading="eager";img.decoding="async";img.className="agx-rewarded-hero";img.onclick=openAd;panel.appendChild(img);}
      var body=document.createElement("div");body.className="agx-rewarded-body";var title=document.createElement("div");title.textContent=displayTitle;title.className="agx-rewarded-title";if(ad.title_color)title.style.color=ad.title_color;var desc=document.createElement("div");desc.textContent=displayDesc;desc.className="agx-rewarded-desc";if(ad.body_color)desc.style.color=ad.body_color;var cta=document.createElement("button");cta.type="button";cta.textContent=displayCta;cta.className="agx-rewarded-cta";cta.onclick=openAd;
      body.appendChild(title);body.appendChild(desc);body.appendChild(cta);panel.appendChild(body);overlay.appendChild(style);overlay.appendChild(panel);document.body.appendChild(overlay);
      var impTimer=setTimeout(function(){impressionSent=true;track({event_type:"impression_recorded",watch_duration_seconds:1.5});},1500);
      var interval=setInterval(function(){var remaining=Math.max(0,Math.ceil(max-elapsed()));count.textContent=remaining+"s";if(impressionSent&&remaining>0&&remaining%5===0)track({event_type:"watch_update",watch_duration_seconds:elapsed()});if(remaining<=0){close.disabled=false;close.setAttribute("aria-label","Close ad and continue");clearInterval(interval);}},250);
      document.addEventListener("visibilitychange",vis);window.addEventListener("pagehide",hide);
    });
  }
  function showExternalAd(decision,options){
    var c=decision.config||{},sdk=c.sdk||{},globalName=c.global_name||sdk.global_name;
    var env=environmentDetails(decision.adapter,null,options);
    if(!env.hasWebApp||!env.initDataLength){
      return Promise.reject(sdkError("Telegram.WebApp/initData is unavailable in this window context","INVALID_INIT_DATA"));
    }
    if(decision.adapter==="g"){
      return loadProjectScript(sdk,c.placement_id,options.timeoutMs).then(function(){
        return timeout(window["show"+"Giga"](),options.timeoutMs||30000);
      }).catch(function(e){
        var msg=e&&e.message||"Ad source unavailable";
        var lower=String(msg).toLowerCase();
        throw sdkError(msg,lower.indexOf("timed out")>=0?"TIMEOUT":(lower.indexOf("no fill")>=0||lower.indexOf("no ad")>=0?"NO_FILL":e.code||"AD_UNAVAILABLE"));
      }).then(function(result){
        return request("/api/sdk/miniapp/impression",{request_id:decision.request_id,miniapp_id:Number(options.miniappId),telegram_user_id:String(userId(options)),country:country(options)},options).then(function(){return {request_id:decision.request_id,reward_eligible:true,raw_result:result};});
      });
    }
    if(decision.adapter==="r"){
      return loadScript(c.script_url||sdk.script_url,globalName).then(function(){
        if(typeof window.TelegramAdsController!=="function")throw sdkError("RichAds controller unavailable","SDK_UNAVAILABLE");
        var controller=new window.TelegramAdsController();
        controller.initialize({pubId:sdk.richads_publisher_id,appId:sdk.richads_app_id});
        if(typeof controller.triggerInterstitialVideo!=="function")throw sdkError("RichAds Telegram Interstitial Video is unavailable","SDK_UNAVAILABLE");
        return timeout(controller.triggerInterstitialVideo(),options.timeoutMs||30000);
      }).then(function(result){
        return request("/api/sdk/miniapp/impression",{request_id:decision.request_id,miniapp_id:Number(options.miniappId),telegram_user_id:String(userId(options)),country:country(options)},options).then(function(data){return {request_id:decision.request_id,reward_eligible:Boolean(data.reward_eligible),status:data.status,raw_result:result};});
      });
    }
    return loadScript(c.script_url||sdk.script_url,globalName).then(function(){
      var g=globalName&&window[globalName];
      if(g&&typeof g.init==="function"){var controller=g.init({blockId:c.placement_id,placementId:c.placement_id,projectId:c.placement_id});if(controller&&typeof controller.show==="function")return timeout(controller.show(),options.timeoutMs);}
      if(typeof g==="function")return timeout(Promise.resolve(g(c.placement_id)).then(function(fn){return typeof fn==="function"?fn({type:"end"}):fn;}),options.timeoutMs);
      if(g&&typeof g.show==="function")return timeout(g.show({placementId:c.placement_id,projectId:c.placement_id}),options.timeoutMs);
      throw sdkError("Ad source unavailable","SDK_UNAVAILABLE");
    }).then(function(result){
      return request("/api/sdk/miniapp/impression",{request_id:decision.request_id,miniapp_id:Number(options.miniappId),telegram_user_id:String(userId(options)),country:country(options)},options).then(function(){return {request_id:decision.request_id,reward_eligible:true,raw_result:result};});
    });
  }
  function display(decision,options){return decision.adapter==="i"?showInternalAd(decision,options):showExternalAd(decision,options);}
  function run(options){
    options=options||{};options.miniappId=Number(options.miniappId||options.miniapp_id||DEFAULT_MINIAPP_ID);
    if(!options.miniappId)return Promise.reject(sdkError("AdsGalaxy Mini App ID is required","INVALID_APP"));
    function attempt(decision){
      if(!decision||decision.success===false)throw sdkError(decision&&decision.message||"No ad available right now",decision&&decision.error_code||"NO_FILL");
      environmentDebug(decision.adapter,null,options);
      return display(decision,options).catch(function(e){
        environmentDebug(decision.adapter,e,options);
        if(!decision.fallback_available)throw normalizeError(e);
        return request("/api/sdk/miniapp/fallback",{request_id:decision.request_id,miniapp_id:Number(options.miniappId),telegram_user_id:String(userId(options)),error_code:e.code||"NETWORK_ERROR",error_message:e.message||"Ad source failed"},options).then(attempt);
      });
    }
    var promise=prepareTelegram(options).then(function(){
      var payload={miniapp_id:options.miniappId,telegram_user_id:String(userId(options)),country:country(options),ad_format:options.adFormat||"rewarded"};
      return request("/api/sdk/miniapp/request",payload,options);
    }).then(attempt).catch(function(error){environmentDebug(null,error,options);throw normalizeError(error);});
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
