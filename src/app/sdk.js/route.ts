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
  function initData(options){return options&&options.initData||tg()&&tg().initData||"";}
  function userId(options){return options&&options.telegramUserId||options&&options.userId||tg()&&tg().initDataUnsafe&&tg().initDataUnsafe.user&&tg().initDataUnsafe.user.id||"";}
  function country(options){return options&&options.country||tg()&&tg().initDataUnsafe&&tg().initDataUnsafe.user&&tg().initDataUnsafe.user.language_code||"";}
  function request(path,payload,options){
    var headers={"Content-Type":"application/json"};
    var auth=initData(options||{});
    if(!auth)return Promise.reject(sdkError("Open this Mini App inside Telegram to show AdsGalaxy ads","INVALID_INIT_DATA"));
    headers["x-telegram-init-data"]=auth;
    var body=JSON.stringify(payload||{});
    var lastError;
    return apiOrigins.reduce(function(chain,origin){
      return chain.catch(function(){
        return fetch(origin+path,{method:"POST",headers:headers,body:body,credentials:"omit"}).then(function(res){
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
      var overlay=document.createElement("div");overlay.style.cssText="position:fixed;inset:0;z-index:2147483647;background:rgba(2,6,23,.94);display:flex;align-items:center;justify-content:center;padding:14px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
      var panel=document.createElement("div");panel.style.cssText="position:relative;width:min(448px,100%);max-height:calc(100vh - 28px);overflow:auto;background:#111821;border:1px solid rgba(148,163,184,.14);border-radius:18px;padding:16px 12px 14px;color:white;text-align:center;box-shadow:0 24px 90px rgba(59,130,246,.22)";
      var close=document.createElement("button");close.textContent="X";close.setAttribute("aria-label","Close ad");close.style.cssText="display:none;position:absolute;right:16px;top:12px;border:0;background:transparent;color:white;font-size:26px;cursor:pointer";close.onclick=complete;
      var head=document.createElement("div");head.textContent="AdsGalaxy";head.style.cssText="font-size:18px;font-weight:900;margin-bottom:10px";
      panel.appendChild(close);panel.appendChild(head);
      if(ad.image_url){var img=document.createElement("img");img.src=ad.image_url;img.alt=ad.title;img.style.cssText="width:100%;aspect-ratio:1/1;max-height:360px;object-fit:cover;border-radius:8px;background:#e0f2fe";img.onclick=openAd;panel.appendChild(img);}
      var title=document.createElement("div");title.textContent=ad.title;title.style.cssText="font-size:17px;font-weight:900;color:"+(ad.title_color||"#646cff")+";margin:16px 8px 8px";
      var desc=document.createElement("div");desc.textContent=ad.description||"";desc.style.cssText="font-size:14px;line-height:1.45;color:"+(ad.body_color||"#a7adbc")+";margin:0 auto 18px;max-width:330px";
      var cta=document.createElement("button");cta.textContent=(ad.cta_text||"Learn More")+" >";cta.style.cssText="width:calc(100% - 20px);border:0;border-radius:9px;background:#4f46ff;color:white;font-size:16px;font-weight:900;padding:14px 12px;cursor:pointer";cta.onclick=openAd;
      var sponsor=document.createElement("a");sponsor.href=${JSON.stringify(`https://t.me/${botUsername}`)};sponsor.target="_blank";sponsor.rel="noopener noreferrer";sponsor.textContent="Sponsored by AdsGalaxy";sponsor.style.cssText="display:block;margin:12px auto 2px;color:#8ea0ff;text-decoration:none;font-size:13px;font-weight:800";
      var count=document.createElement("div");count.style.cssText="margin:14px 10px 8px;border:1px solid rgba(148,163,184,.16);border-radius:14px;background:rgba(15,23,42,.38);padding:14px;font-size:15px;font-weight:800;color:#9aa3b5";count.textContent="Reward unlocks in 15s";
      panel.appendChild(title);panel.appendChild(desc);panel.appendChild(cta);panel.appendChild(sponsor);panel.appendChild(count);overlay.appendChild(panel);document.body.appendChild(overlay);
      var impTimer=setTimeout(function(){impressionSent=true;track({event_type:"impression_recorded",watch_duration_seconds:1.5});},1500);
      var interval=setInterval(function(){var remaining=Math.max(0,Math.ceil(max-elapsed()));count.textContent=remaining>0?"Reward unlocks in "+remaining+"s":"Reward ready";if(impressionSent&&remaining>0&&remaining%5===0)track({event_type:"watch_update",watch_duration_seconds:elapsed()});if(remaining<=0){close.style.display="block";clearInterval(interval);}},250);
      document.addEventListener("visibilitychange",vis);window.addEventListener("pagehide",hide);
    });
  }
  function showExternalAd(decision,options){
    var c=decision.config||{},sdk=c.sdk||{},globalName=c.global_name||sdk.global_name;
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
    if(!initData(options))return Promise.reject(sdkError("Open this Mini App inside Telegram to show AdsGalaxy ads","INVALID_INIT_DATA"));
    var payload={miniapp_id:options.miniappId,telegram_user_id:String(userId(options)),country:country(options),ad_format:options.adFormat||"rewarded"};
    function attempt(decision){
      if(!decision||decision.success===false)throw sdkError(decision&&decision.message||"No ad available right now",decision&&decision.error_code||"NO_FILL");
      return display(decision,options).catch(function(e){
        if(!decision.fallback_available)throw normalizeError(e);
        return request("/api/sdk/miniapp/fallback",{request_id:decision.request_id,error_code:e.code||"NETWORK_ERROR",error_message:e.message||"Ad source failed"},options).then(attempt);
      });
    }
    var promise=request("/api/sdk/miniapp/request",payload,options).then(attempt).catch(function(error){throw normalizeError(error);});
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
  window.AdsGalaxy={show:window.showAdsGalaxy,version:"13F"};
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
