import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { channelUnitPriceSql } from "@/lib/channelBilling";
import { getChannelDailySpend } from "@/lib/channelDailySpend";
import { channelCampaignMatchesInventory } from "@/lib/channelAudience";
import { campaignExcludesChannel, loadCampaignExclusions } from "@/lib/campaignInventoryExclusions";
import { silverCampaignDeliverySql, silverChannelEligibilitySql } from "@/lib/silverCampaignControl";

/** Shared eligibility for automatic Channel recovery; never funds a wallet. */
export async function resumeAutomaticallyPausedChannel(conn: PoolConnection, campaignId: number) {
  const [[campaign]] = await conn.query<RowDataPacket[]>(
    `SELECT c.*,u.ad_balance,(${channelUnitPriceSql()}) unit_price
     FROM campaigns c JOIN users u ON u.id=c.user_id
     WHERE c.id=? AND c.type IN ('views','clicks') AND COALESCE(c.teaser_mode,'none')='none'
       AND (c.status='budget_exhausted' OR (c.status='paused' AND c.pause_reason='insufficient_balance')
         OR (c.status='daily_cap_reached' AND c.pause_reason='daily_budget_limit'))
       AND COALESCE(c.pause_reason,'') NOT IN ('advertiser_paused','admin_paused','manual')
       AND (c.status<>'budget_exhausted' OR c.auto_reactivate=1)
       AND (c.start_at IS NULL OR c.start_at<=UTC_TIMESTAMP())
       AND (c.end_at IS NULL OR c.end_at>UTC_TIMESTAMP())
       AND COALESCE(u.advertiser_trust_level,'new')<>'restricted'
       AND (c.campaign_kind<>'channel_growth' OR (c.destination_chat_id IS NOT NULL AND c.growth_tracking_status='ready'))
       AND ${silverCampaignDeliverySql("c")} FOR UPDATE`, [campaignId]);
  if (!campaign) return false;
  const unit = Number(campaign.unit_price);
  if (!(unit > 0) || Number(campaign.budget)+1e-10 < unit || Number(campaign.ad_balance)+1e-10 < unit) return false;
  const spent = await getChannelDailySpend(conn, campaignId);
  if (Number(campaign.daily_budget_limit)>0 && spent+unit>Number(campaign.daily_budget_limit)+1e-10) return false;
  const exclusions = await loadCampaignExclusions(conn, "campaign", [campaignId], "channel");
  const [channels] = await conn.query<Array<RowDataPacket & { username?: unknown; invite_link_hash?: unknown }>>(
    `SELECT ch.*,g.authoritative_country_code,g.authoritative_language_code
     FROM channels ch JOIN campaigns c ON c.id=?
     LEFT JOIN channel_geo_classifications g ON g.channel_id=ch.id
     WHERE ch.status='active' AND ch.is_deleted=FALSE AND ch.user_id<>c.user_id
       AND ${silverChannelEligibilitySql("c", "ch")}`, [campaignId]);
  const eligible = channels.some(ch => !campaignExcludesChannel(exclusions,campaignId,ch) && channelCampaignMatchesInventory({
    campaignCategory:campaign.category,campaignAudience:campaign.continents,
    campaignCountries:campaign.countries,campaignLanguages:campaign.languages,
    channelCategories:ch.categories,channelAudience:ch.audience_continents,
    channelCountry:ch.authoritative_country_code,channelLanguage:ch.authoritative_language_code,
  }));
  if (!eligible) return false;
  await conn.query(`UPDATE campaigns SET status='active',pause_reason=NULL,paused_at=NULL,
    budget_exhausted_at=NULL,daily_cap_reached_at=NULL,daily_cap_billing_date=NULL,
    channel_delivery_generation=channel_delivery_generation+1 WHERE id=?`, [campaignId]);
  return true;
}
