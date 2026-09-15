import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { claimAdvertiserDirectDebit } from "@/lib/advertiserDirectDebit";
import { creditUserLockedBalance } from "@/lib/earnings";
import { getPrivatePostViews } from "@/lib/telegramMtproto";
import { getPublisherQuality } from "@/lib/publisherQuality";

export const TEASER_BRAND_URL = "https://t.me/Ads_Galaxy_bot?start=REF770190998629F";
export const TEASER_CTA = { learn_more:"Learn More",click_here:"Click Here",join_now:"Join Now",join_channel:"Join Channel",join_group:"Join Group",start_now:"Start Now",start_bot:"Start Bot",open_now:"Open Now",view_more:"View More",get_started:"Get Started",buy_now:"Buy Now",sign_up:"Sign Up",download:"Download",visit_now:"Visit Now",visit_site:"Visit Site",play_now:"Play Now",shop_now:"Shop Now" } as const;
export type TeaserCtaKey = keyof typeof TEASER_CTA;
export type TelegramEntity = { type:string; offset:number; length:number; url?:string; custom_emoji_id?:string };

export function teaserCharacterCount(value:string){ return Array.from(value.normalize("NFC")).length; }
export function normalizeTeaserVariants(values:unknown){
  if(!Array.isArray(values)) throw new Error("TEASER_VARIANTS_INVALID");
  const variants=values.map((v)=>String(v??"").trim().replace(/\s+/g," "));
  if(variants.length<2||variants.length>5) throw new Error("TEASER_VARIANT_COUNT_INVALID");
  if(new Set(variants.map((v)=>v.toLocaleLowerCase())).size!==variants.length) throw new Error("TEASER_VARIANT_DUPLICATE");
  for(const value of variants){ const length=teaserCharacterCount(value); if(length<20||length>80) throw new Error("TEASER_COPY_LENGTH_INVALID"); if(/(?:https?:\/\/|t\.me\/)/iu.test(value)) throw new Error("TEASER_COPY_URL_FORBIDDEN"); }
  return variants;
}
export function validateTeaserCta(value:unknown):TeaserCtaKey { const key=String(value||"") as TeaserCtaKey; if(!TEASER_CTA[key]) throw new Error("TEASER_CTA_INVALID"); return key; }
export function validateTeaserDailyLimit(value:unknown){ const n=Number(value); if(!Number.isInteger(n)||n<2||n>5) throw new Error("TEASER_DAILY_LIMIT_INVALID"); return n; }
export function validateTeaserCpm(value:unknown, limits={min:0.5,max:6.5}){ const n=Number(value); if(!Number.isFinite(n)||n<limits.min||n>limits.max) throw new Error("TEASER_CPM_INVALID"); return n; }
export function opaqueTeaserToken(){ return randomBytes(32).toString("base64url"); }
export function contentHash(text:string, entities:TelegramEntity[]){ return createHash("sha256").update(JSON.stringify([text,entities])).digest("hex"); }
export function renderTeaserSuffix(copy:string,cta:TeaserCtaKey,trackingUrl:string){
  const sponsor="Sponsored",brand="Ads Galaxy",ctaText=`${TEASER_CTA[cta]} →`;
  const text=`\n\n─────────────\n${sponsor} · ${brand}\n\n${copy}\n\n${ctaText}`;
  const entity=(needle:string,type:string,url?:string):TelegramEntity=>{const offset=text.indexOf(needle);return {type,offset,length:needle.length,...(url?{url}:{})};};
  return {text,entities:[entity(sponsor,"bold"),entity(brand,"bold"),entity(brand,"text_link",TEASER_BRAND_URL),entity(ctaText,"bold"),entity(ctaText,"text_link",trackingUrl)]};
}
export function appendTelegramEntities(organicText:string,organicEntities:TelegramEntity[],suffix:{text:string;entities:TelegramEntity[]}){
  const offset=organicText.length;
  return {text:organicText+suffix.text,entities:[...organicEntities,...suffix.entities.map((e)=>({...e,offset:e.offset+offset}))]};
}
export function stripExactTeaserSuffix(content:string,suffix:string){return content.endsWith(suffix)?content.slice(0,-suffix.length):content;}
export function teaserDelta(baseline:number|null,lastSeen:number|null,current:number){if(baseline===null||current<0)return 0;const checkpoint=Math.max(baseline,lastSeen??baseline);return Math.max(0,current-checkpoint);}
export function teaserContentLimit(messageType:string){return messageType==="text"?4096:1024;}
export function teaserContentFits(messageType:string,text:string){return text.length<=teaserContentLimit(messageType);}
/** One operational ceiling for every durable Teaser worker retry. */
export const TEASER_MAX_RETRY_ATTEMPTS=8;
export function teaserRetryDelaySeconds(attempt:number,retryAfter?:number){return Math.max(retryAfter||0,Math.min(3600,30*2**Math.min(Math.max(0,attempt),7)));}
export function teaserRetryExhausted(attempt:number){return attempt>=TEASER_MAX_RETRY_ATTEMPTS;}

type TelegramEditInput={chatId:number;messageId:number;messageType:string;text:string;entities:TelegramEntity[]};
export type TeaserTelegramErrorCategory="IDEMPOTENT_SUCCESS"|"RETRYABLE_NETWORK"|"RATE_LIMITED"|"MESSAGE_TERMINAL"|"CHANNEL_PERMISSION"|"CHANNEL_TERMINAL"|"CONTENT_TERMINAL"|"AUTH_FAILURE"|"UNKNOWN";
export function classifyTeaserTelegramError(input:{status?:number;code?:number;description?:unknown;retryAfter?:number;network?:boolean}){
  const description=String(input.description||"").toLowerCase(),status=Number(input.status||input.code||0);
  const retryAfter=Number(input.retryAfter)||undefined;
  if(/message is not modified/.test(description))return{category:"IDEMPOTENT_SUCCESS" as const,code:"TELEGRAM_NOT_MODIFIED",retryAfter};
  if(status===429||/flood[_ ]?wait|too many requests/.test(description))return{category:"RATE_LIMITED" as const,code:"TELEGRAM_RATE_LIMIT",retryAfter};
  if(/message to edit not found|message_id_invalid|message no longer exists/.test(description))return{category:"MESSAGE_TERMINAL" as const,code:"SNAPSHOT_MESSAGE_ABSENT",retryAfter};
  if(/not enough rights|need administrator rights|bot is not a member|chat_admin_required|bot.*administrator/.test(description))return{category:"CHANNEL_PERMISSION" as const,code:"TELEGRAM_CHANNEL_PERMISSION",retryAfter};
  if(/message can.t be edited|message is too old|message edit time expired|there is no (?:text|caption)/.test(description))return{category:"MESSAGE_TERMINAL" as const,code:"SNAPSHOT_NOT_EDITABLE",retryAfter};
  if(/entities|parse entities|message is too long|caption is too long/.test(description))return{category:"CONTENT_TERMINAL" as const,code:"TELEGRAM_CONTENT_INVALID",retryAfter};
  if(status===401||status===403||/unauthorized|invalid token/.test(description))return{category:"AUTH_FAILURE" as const,code:"TELEGRAM_AUTH_FAILURE",retryAfter};
  if(input.network||status>=500)return{category:"RETRYABLE_NETWORK" as const,code:input.network?"TELEGRAM_NETWORK_ERROR":"TELEGRAM_SERVER_ERROR",retryAfter};
  return{category:"UNKNOWN" as const,code:"TELEGRAM_EDIT_FAILED",retryAfter};
}
export type TelegramEditResult={ok:true;category?:"IDEMPOTENT_SUCCESS"}|{ok:false;terminal:boolean;code:string;category:TeaserTelegramErrorCategory;retryAfter?:number};
export async function editTelegramTeaser(input:TelegramEditInput):Promise<TelegramEditResult>{
  const token=String(process.env.BOT_TOKEN||"").trim();
  if(!token)return{ok:false,terminal:false,code:"BOT_TOKEN_MISSING",category:"AUTH_FAILURE"};
  const method=input.messageType==="text"?"editMessageText":"editMessageCaption";
  const payload=input.messageType==="text"
    ?{chat_id:input.chatId,message_id:input.messageId,text:input.text,entities:input.entities}
    :{chat_id:input.chatId,message_id:input.messageId,caption:input.text,caption_entities:input.entities};
  try{
    const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(15_000)});
    const data=await response.json().catch(()=>({})) as {ok?:boolean;description?:string;error_code?:number;parameters?:{retry_after?:number}};
    if(response.ok&&data.ok)return{ok:true};
    const classified=classifyTeaserTelegramError({status:response.status,code:data.error_code,description:data.description,retryAfter:data.parameters?.retry_after});
    if(classified.category==="IDEMPOTENT_SUCCESS")return{ok:true,category:"IDEMPOTENT_SUCCESS"};
    return{ok:false,terminal:["MESSAGE_TERMINAL","CHANNEL_PERMISSION","CHANNEL_TERMINAL","CONTENT_TERMINAL","AUTH_FAILURE"].includes(classified.category),...classified};
  }catch(error){const classified=classifyTeaserTelegramError({description:error instanceof Error?error.name:"",network:true});return{ok:false,terminal:false,...classified};}
}

export async function fetchTeaserViews(input:{chatId:number;messageId:number;username?:string|null;channelType?:string|null;trackingAccount?:number|null;rotationSeed:number}){
  const privateChannel=input.channelType==="private";
  const peer=privateChannel?input.chatId:(input.username?`@${input.username.replace(/^@/,"")}`:input.chatId);
  return getPrivatePostViews(peer,input.messageId,{preferredAccount:input.trackingAccount,rotationSeed:input.rotationSeed,requirePreferredAccount:privateChannel});
}
export async function settleTeaserViews(conn:PoolConnection,placementId:number,currentViews:number){
  const [rows]=await conn.query<Array<RowDataPacket & Record<string,unknown>>>(`SELECT tp.*,c.user_id advertiser_id,c.budget campaign_remaining,c.status campaign_status,c.teaser_enabled campaign_teaser_enabled,ch.user_id publisher_id FROM teaser_placements tp JOIN campaigns c ON c.id=tp.campaign_id JOIN channels ch ON ch.id=tp.channel_id WHERE tp.id=? FOR UPDATE`,[placementId]);
  const row=rows[0]; if(!row||row.baseline_views===null) return {ok:false,reason:"BASELINE_UNAVAILABLE"};
  if(!["active","removal_pending"].includes(String(row.status)))return{ok:false,reason:"PLACEMENT_NOT_SETTLEABLE"};
  if(String(row.campaign_status)!=="active"||!Boolean(row.campaign_teaser_enabled))return{ok:false,reason:"CAMPAIGN_INACTIVE"};
  const delta=teaserDelta(Number(row.baseline_views),Number(row.last_seen_views??row.baseline_views),currentViews); if(delta===0){if(currentViews>=Number(row.last_seen_views??0))await conn.query("UPDATE teaser_placements SET last_seen_views=? WHERE id=?",[currentViews,placementId]);return{ok:true,delta:0};}
  const units=BigInt(delta)*BigInt(Math.round(Number(row.teaser_cpm_snapshot)*1e8))/BigInt(1000); const amount=(Number(units)/1e8).toFixed(8);
  const [cap]=await conn.query<ResultSetHeader>("UPDATE campaigns SET budget=budget-?,channel_spend=channel_spend+? WHERE id=? AND budget>=?",[amount,amount,row.campaign_id,amount]); if(cap.affectedRows!==1)return{ok:false,reason:"CAMPAIGN_BUDGET_EXHAUSTED"};
  const sourceKey=`teaser:${placementId}:${currentViews}`; const debit=await claimAdvertiserDirectDebit(conn,{sourceKey,advertiserId:Number(row.advertiser_id),campaignId:Number(row.campaign_id),campaignTable:"campaigns",billingType:"teaser_impression",amount,description:`Teaser impressions placement #${placementId}`}); if(!debit.ok)return{ok:false,reason:debit.duplicate?"DUPLICATE":"INSUFFICIENT_AD_BALANCE"};
  const [settings]=await conn.query<Array<RowDataPacket & {key:string;value:string}>>("SELECT `key`,value FROM settings WHERE `key` IN ('teaser_publisher_share','teaser_platform_share','teaser_reserve_share')");const map=new Map(settings.map(r=>[r.key,Number(r.value)]));const publisherBase=Number(amount)*(map.get("teaser_publisher_share")??60)/100;const platform=Number(amount)*(map.get("teaser_platform_share")??30)/100;const quality=await getPublisherQuality(Number(row.channel_id),conn);const publisher=publisherBase*quality.qualityWeight;const holdback=publisherBase-publisher;const reserve=Number(amount)-publisher-platform;
  await creditUserLockedBalance(conn,Number(row.publisher_id),publisher);await conn.query("INSERT INTO teaser_settlements(placement_id,checkpoint_views,impression_delta,gross_amount,publisher_amount,platform_amount,reserve_amount,publisher_quality_score,publisher_quality_weight,quality_holdback,direct_debit_source_key) VALUES (?,?,?,?,?,?,?,?,?,?,?)",[placementId,currentViews,delta,amount,publisher,platform,reserve,quality.qualityScore,quality.qualityWeight,holdback,sourceKey]);await conn.query("UPDATE teaser_placements SET last_seen_views=?,settled_impressions=settled_impressions+? WHERE id=?",[currentViews,delta,placementId]);return{ok:true,delta,amount};
}
