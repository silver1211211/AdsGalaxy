import type {Pool,RowDataPacket} from "mysql2/promise";
import {smartReachCpm} from "@/lib/channelPhase1FinancialPolicy";
import {unitsToDecimal} from "@/lib/channelAllocationMath";
import {SMART_REACH_POLICY_VERSION} from "@/lib/channelSmartReachConfiguration";

type Row=RowDataPacket&Record<string,any>;
/** Uses only billed qualified views and settled, validated click counts. */
export async function evaluateSmartReachDynamicCpm(pool:Pool,campaignId:number){
  if(process.env.CHANNEL_SMART_REACH_DYNAMIC_CPM_ENABLED!=="true")return {status:"disabled" as const};
  if(!Number.isSafeInteger(campaignId)||campaignId<=0)throw new Error("invalid_smart_reach_cpm_campaign");
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    const [[c]]=await conn.query<Row[]>(`SELECT financial_policy_version,financial_billing_mode,status,
      smart_reach_effective_cpm,smart_reach_max_cpm,smart_reach_last_evaluated_at
      FROM campaigns WHERE id=? FOR UPDATE`,[campaignId]);
    if(!c||c.financial_policy_version!==SMART_REACH_POLICY_VERSION||c.financial_billing_mode!=="smart_reach")
      throw new Error("smart_reach_dynamic_policy_mismatch");
    if(c.status!=="active"){await conn.commit();return {status:"paused" as const};}
    const [[clock]]=await conn.query<Row[]>(`SELECT UTC_TIMESTAMP(6) now_utc,
      FLOOR(UNIX_TIMESTAMP(UTC_TIMESTAMP())/1800) evaluation_slot`);
    const now=new Date(clock.now_utc);
    const minutesSinceLast=c.smart_reach_last_evaluated_at
      ?Math.floor((now.getTime()-new Date(c.smart_reach_last_evaluated_at).getTime())/60000):null;
    if(minutesSinceLast!==null&&minutesSinceLast<30){await conn.commit();return {status:"too_soon" as const};}
    const [[views]]=await conn.query<Row[]>(`SELECT COALESCE(SUM(billable_views),0) total,
      MIN(created_at) first_at FROM channel_smart_reach_impression_billings WHERE campaign_id=?`,[campaignId]);
    const [[clicks]]=await conn.query<Row[]>(`SELECT COALESCE(SUM(settled_clicks),0) total
      FROM campaign_posts WHERE campaign_id=?`,[campaignId]);
    const observed=views.first_at?Math.max(0,Math.floor((now.getTime()-new Date(views.first_at).getTime())/60000)):0;
    const result=smartReachCpm({selectedMaximum:String(c.smart_reach_max_cpm),
      activeCpm:String(c.smart_reach_effective_cpm),qualifiedImpressions:BigInt(views.total),
      settledClicks:BigInt(clicks.total),observedMinutes:BigInt(observed),
      minutesSinceLastReprice:BigInt(minutesSinceLast??observed)});
    await conn.query(`INSERT INTO channel_smart_reach_cpm_evaluations
      (campaign_id,evaluation_slot,qualified_impressions,settled_clicks,previous_cpm,next_cpm,
       ceiling_cpm,observed_minutes) VALUES(?,?,?,?,?,?,?,?)`,
      [campaignId,clock.evaluation_slot,String(views.total),String(clicks.total),
        c.smart_reach_effective_cpm,result.nextDecimal,
        unitsToDecimal(result.ceilingUnits),observed]);
    await conn.query(`UPDATE campaigns SET smart_reach_effective_cpm=?,
      smart_reach_last_evaluated_at=? WHERE id=?`,[result.nextDecimal,clock.now_utc,campaignId]);
    await conn.commit();
    return {status:"evaluated" as const,previousCpm:String(c.smart_reach_effective_cpm),
      nextCpm:result.nextDecimal,qualifiedImpressions:String(views.total),settledClicks:String(clicks.total)};
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
}
