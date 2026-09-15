import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { audienceForCountryCode } from "@/lib/channelAudience";

export const CHANNEL_TARGETING_AUTHORITY = {
  countryMinEvents: 20,
  countryDominance: 0.6,
  languageMinSamples: 3,
  languageDominance: 0.6,
  maxChannelsPerRun: 20,
  maxLanguagePosts: 20,
} as const;

const STOP = new Set(["the","and","with","for","this","that","you","your","как","что","это","для","или","все","the","und","die","der","les","des","para","que","una","los"]);
export function normalizeAuthorityCountry(value: unknown) { const code=String(value||"").trim().toUpperCase(); return /^[A-Z]{2}$/.test(code)?code:null; }
export function normalizeAuthorityLanguage(value: unknown) { const code=String(value||"").trim().toLowerCase().split("-")[0]; return /^[a-z]{2,3}$/.test(code)?code:null; }
export function detectOrganicLanguage(text: unknown) {
  const value=String(text||"").replace(/https?:\/\/\S+|t\.me\/\S+/giu,"").replace(/[^\p{L}\s]/gu," ").trim();
  if(value.length<24) return null;
  const cyr=(value.match(/[\u0400-\u04FF]/g)||[]).length, latin=(value.match(/[A-Za-z]/g)||[]).length, arabic=(value.match(/[\u0600-\u06FF]/g)||[]).length;
  if(cyr>=latin&&cyr>=arabic&&cyr/value.length>.25) return "ru";
  if(arabic>=latin&&arabic/value.length>.25) return "ar";
  if(latin/value.length>.35) {
    const words=value.toLowerCase().split(/\s+/).filter(word=>word.length>2);
    const score=(items:string[])=>items.reduce((n,item)=>n+(STOP.has(item)?1:0),0);
    if(score(words.slice(0,20))>0) return "en";
    return "en";
  }
  return null;
}
function dominant<T extends string>(values:T[],minimum:number,share:number) { if(values.length<minimum)return null; const counts=new Map<T,number>(); for(const value of values)counts.set(value,(counts.get(value)||0)+1); const top=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0]; if(!top)return null; const [value,count]=top; return count/values.length>=share?{value,confidence:count/values.length,samples:values.length}:null; }
export async function classifyChannelTargetingBatch() {
  // Older channels can predate geo classification. Seed only a bounded slice;
  // this is an additive metadata row and never changes campaign or financial data.
  await pool.query(`INSERT IGNORE INTO channel_geo_classifications
    (channel_id,confidence,source,reason,status,classified_at)
    SELECT c.id,'unknown','targeting_classifier','Pending country/language classification','current',UTC_TIMESTAMP()
    FROM channels c LEFT JOIN channel_geo_classifications g ON g.channel_id=c.id
    WHERE c.is_deleted=0 AND g.channel_id IS NULL ORDER BY c.id ASC LIMIT ${CHANNEL_TARGETING_AUTHORITY.maxChannelsPerRun}`);
  const [channels]=await pool.query<Array<RowDataPacket&{channel_id:number;authoritative_region:string|null;country_source:string|null;language_source:string|null}>>(`SELECT channel_id,authoritative_region,country_source,language_source FROM channel_geo_classifications WHERE status='current' AND (country_source IS NULL OR country_source<>'manual_admin' OR language_source IS NULL OR language_source<>'manual_admin') ORDER BY updated_at ASC LIMIT ${CHANNEL_TARGETING_AUTHORITY.maxChannelsPerRun}`);
  for(const channel of channels) {
    const id=Number(channel.channel_id);
    if(channel.country_source!=="manual_admin") {
      const [events]=await pool.query<Array<RowDataPacket&{country_code:string}>>("SELECT country_code FROM channel_traffic_events WHERE channel_id=? AND country_code IS NOT NULL AND duplicate_event=0 AND rapid_burst=0 AND concentration_alert=0 AND created_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 90 DAY) ORDER BY created_at DESC LIMIT 500",[id]);
      const country=dominant(events.map(row=>normalizeAuthorityCountry(row.country_code)).filter(Boolean) as string[],CHANNEL_TARGETING_AUTHORITY.countryMinEvents,CHANNEL_TARGETING_AUTHORITY.countryDominance);
      const regionOk=!country||!channel.authoritative_region||audienceForCountryCode(country.value)===channel.authoritative_region;
      if(country&&regionOk)await pool.query("UPDATE channel_geo_classifications SET authoritative_country_code=?,country_confidence=?,country_source='trusted_traffic',country_classified_at=UTC_TIMESTAMP() WHERE channel_id=? AND country_source<>'manual_admin'",[country.value,country.confidence,id]);
    }
    if(channel.language_source!=="manual_admin") {
      const [posts]=await pool.query<Array<RowDataPacket&{organic_text:string}>>("SELECT organic_text FROM channel_organic_posts WHERE channel_id=? AND availability='available' AND teaser_eligible=1 AND organic_text IS NOT NULL AND organic_text<>'' ORDER BY telegram_message_id DESC LIMIT ?",[id,CHANNEL_TARGETING_AUTHORITY.maxLanguagePosts]);
      const language=dominant(posts.map(row=>detectOrganicLanguage(row.organic_text)).filter(Boolean) as string[],CHANNEL_TARGETING_AUTHORITY.languageMinSamples,CHANNEL_TARGETING_AUTHORITY.languageDominance);
      if(language)await pool.query("UPDATE channel_geo_classifications SET authoritative_language_code=?,language_confidence=?,language_source='organic_content',language_classified_at=UTC_TIMESTAMP() WHERE channel_id=? AND language_source<>'manual_admin'",[language.value,language.confidence,id]);
    }
    // Move inconclusive rows behind the rest of the bounded work queue.
    await pool.query("UPDATE channel_geo_classifications SET updated_at=UTC_TIMESTAMP() WHERE channel_id=?",[id]);
  }
  return { processed: channels.length };
}
