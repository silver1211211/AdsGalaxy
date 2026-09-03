import crypto from "crypto";

function secret(){return process.env.TELEMETRY_HASH_SECRET||process.env.ADMIN_SESSION_SECRET||process.env.CRON_SECRET||"";}
function hmac(value:string){const key=secret();return key&&value?crypto.createHmac("sha256",key).update(value).digest("hex"):null;}
function firstHeader(headers:Headers,names:string[]){for(const name of names){const value=headers.get(name)?.trim();if(value)return value;}return "";}
function networkBucket(ip:string){const clean=ip.split(",")[0].trim();const ipv4=clean.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);if(ipv4)return `${ipv4[1]}.${ipv4[2]}.${ipv4[3]}.0/24`;if(clean.includes(":"))return `${clean.split(":").slice(0,4).join(":")}::/64`;return "";}
function countryCode(value:unknown){const code=String(value||"").trim().toUpperCase();return /^[A-Z]{2}$/.test(code)&&code!=="XX"?code:null;}

export function trustedMiniAppCountry(headers:Headers,sdkCountry?:unknown){
  const trustedEdge=String(process.env.MINIAPP_TRUSTED_EDGE_COUNTRY_HEADERS||"").split(",").map(value=>value.trim().toLowerCase()).filter(Boolean);
  for(const header of trustedEdge){const code=countryCode(headers.get(header));if(code)return {country:code,source:`trusted_edge:${header}`};}
  if(process.env.MINIAPP_TRUST_VALIDATED_SDK_COUNTRY==="1"){const code=countryCode(sdkCountry);if(code)return {country:code,source:"validated_sdk"};}
  return {country:null,source:"unknown"};
}

export function miniAppEconomicIdentity(headers:Headers,input:{telegramUserId:string|number;sessionId?:unknown;deviceId?:unknown;fingerprint?:unknown}){
  const trustProxy=process.env.MINIAPP_TRUST_PROXY_IP_HEADERS==="1";
  const ip=trustProxy?firstHeader(headers,["cf-connecting-ip","x-real-ip","x-forwarded-for"]):"";
  const userAgent=headers.get("user-agent")||"";
  return {
    telegram_user_id:String(input.telegramUserId),
    session_hash:hmac(String(input.sessionId||"")),
    device_hash:hmac(String(input.fingerprint||input.deviceId||userAgent)),
    network_hash:hmac(networkBucket(ip)),
  };
}
