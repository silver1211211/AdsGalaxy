import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { insertTeaserPlacement, type TeaserInsertReason } from "@/lib/teaserPlacement";
import { TEASER_MAX_RETRY_ATTEMPTS,teaserRetryDelaySeconds } from "@/lib/teaser";

type State = RowDataPacket & { id: number; job_id: number; campaign_id: number; channel_id: number; attempts:number };
type Snapshot = RowDataPacket & { id:number; channel_id:number; publisher_id:number; telegram_chat_id:number; telegram_message_id:number; message_type:string; organic_text:string; entities:unknown; caption_entities:unknown; content_hash:string };
export const TEASER_SNAPSHOT_FALLBACK_REASONS = new Set<TeaserInsertReason>(["POST_TOO_LONG","POST_UNSUPPORTED","SNAPSHOT_MESSAGE_ABSENT","SNAPSHOT_NOT_EDITABLE","SNAPSHOT_TERMINAL_TELEGRAM"]);

export async function processTeaserEmergencyJobs() {
  const [jobs] = await pool.query<Array<RowDataPacket & {id:number;campaign_id:number;cursor_channel_id:number;discovery_complete:number;override_targeting:number}>>("SELECT id,campaign_id,cursor_channel_id,discovery_complete,override_targeting FROM teaser_emergency_jobs WHERE status IN ('queued','running') AND (lease_until IS NULL OR lease_until<NOW()) ORDER BY id LIMIT 1");
  const job=jobs[0]; if(!job)return{jobs:0,processed:0};
  const [claim]=await pool.query<ResultSetHeader>("UPDATE teaser_emergency_jobs SET status='running',started_at=COALESCE(started_at,NOW()),lease_until=DATE_ADD(NOW(),INTERVAL 5 MINUTE) WHERE id=? AND (lease_until IS NULL OR lease_until<NOW())",[job.id]);
  if(!Number(claim.affectedRows))return{jobs:0,processed:0};
  // A crashed generic processing claim is recoverable only after its durable lease expires.
  await pool.query("UPDATE teaser_emergency_job_channels SET status='retrying',next_retry_at=NOW(),lease_until=NULL,reason_code='TELEGRAM_RETRYABLE' WHERE job_id=? AND status='processing' AND lease_until<NOW()",[job.id]);
  if(!job.discovery_complete){
    const[channels]=await pool.query<Array<RowDataPacket&{id:number}>>("SELECT ch.id FROM channels ch JOIN users p ON p.id=ch.user_id WHERE ch.id>? AND ch.is_deleted=0 AND ch.status IN ('active','approved') AND p.status='active' AND p.is_banned=0 ORDER BY ch.id LIMIT 25",[job.cursor_channel_id]);
    for(const ch of channels)await pool.query("INSERT IGNORE INTO teaser_emergency_job_channels(job_id,campaign_id,channel_id,status) VALUES(?,?,?,'queued')",[job.id,job.campaign_id,ch.id]);
    await pool.query("UPDATE teaser_emergency_jobs SET cursor_channel_id=?,eligible_count=eligible_count+?,queued_count=queued_count+?,discovery_complete=? WHERE id=?",[channels.length?channels.at(-1)?.id:job.cursor_channel_id,channels.length,channels.length,channels.length<25?1:0,job.id]);
  }
  const[states]=await pool.query<State[]>("SELECT * FROM teaser_emergency_job_channels WHERE job_id=? AND (status='queued' OR (status='retrying' AND (next_retry_at IS NULL OR next_retry_at<=NOW()))) ORDER BY id LIMIT 10",[job.id]);
  for(const state of states){try{
    const[stateClaim]=await pool.query<ResultSetHeader>("UPDATE teaser_emergency_job_channels SET status='processing',lease_until=DATE_ADD(NOW(),INTERVAL 5 MINUTE) WHERE id=? AND status IN ('queued','retrying')",[state.id]);
    if(!Number(stateClaim.affectedRows))continue;
    const[snapshots]=await pool.query<Snapshot[]>("SELECT id,channel_id,publisher_id,telegram_chat_id,telegram_message_id,message_type,organic_text,entities,caption_entities,content_hash FROM channel_organic_posts WHERE channel_id=? AND availability='available' AND teaser_eligible=1 ORDER BY telegram_message_id DESC LIMIT 5",[state.channel_id]);
    let out:{ok:boolean;reason?:TeaserInsertReason;placementId?:number;retryAfter?:number;errorCategory?:string}={ok:false,reason:"NO_SAFE_ORGANIC_SNAPSHOT"};
    const attemptedSnapshotIds=new Set<number>();
    for(const snapshot of snapshots){
      if(attemptedSnapshotIds.has(Number(snapshot.id)))continue;
      attemptedSnapshotIds.add(Number(snapshot.id));
      out=await insertTeaserPlacement({sourceUpdateId:-state.id,campaignId:state.campaign_id,channelId:state.channel_id,snapshot,emergencyJobId:state.job_id,overrideCampaignTargeting:Number(job.override_targeting)===1});
      if(out.ok||!out.reason||!TEASER_SNAPSHOT_FALLBACK_REASONS.has(out.reason))break;
    }
    if(!out.ok&&out.reason&&TEASER_SNAPSHOT_FALLBACK_REASONS.has(out.reason))out={ok:false,reason:"NO_SAFE_ORGANIC_SNAPSHOT"};
    if(out.ok)await pool.query("UPDATE teaser_emergency_job_channels SET status='injected',lease_until=NULL,placement_id=?,reason_code=NULL WHERE id=?",[out.placementId,state.id]);
    else if(out.reason==="TELEGRAM_RETRYABLE"){const attempt=Number(state.attempts||0)+1;if(attempt>=TEASER_MAX_RETRY_ATTEMPTS)await pool.query("UPDATE teaser_emergency_job_channels SET status='failed',lease_until=NULL,attempts=?,next_retry_at=NULL,placement_id=?,reason_code='RETRY_CEILING',last_error_category='RETRY_CEILING' WHERE id=?",[attempt,out.placementId||null,state.id]);else await pool.query("UPDATE teaser_emergency_job_channels SET status='retrying',lease_until=NULL,attempts=?,next_retry_at=DATE_ADD(NOW(),INTERVAL ? SECOND),placement_id=?,reason_code=?,last_error_category=? WHERE id=?",[attempt,teaserRetryDelaySeconds(attempt,out.retryAfter),out.placementId||null,out.reason,out.errorCategory||"RETRYABLE_NETWORK",state.id]);}
    else await pool.query("UPDATE teaser_emergency_job_channels SET status=?,lease_until=NULL,reason_code=?,last_error_category='TERMINAL' WHERE id=?",[out.reason==="TELEGRAM_TERMINAL"?"failed":"skipped",out.reason||"NO_SAFE_ORGANIC_SNAPSHOT",state.id]);
  }catch(error){const attempt=Number(state.attempts||0)+1;const terminal=attempt>=TEASER_MAX_RETRY_ATTEMPTS;await pool.query("UPDATE teaser_emergency_job_channels SET status=?,lease_until=NULL,attempts=?,next_retry_at=IF(?=1,NULL,DATE_ADD(NOW(),INTERVAL ? SECOND)),reason_code=?,last_error_category=? WHERE id=?",[terminal?"failed":"retrying",attempt,terminal?1:0,teaserRetryDelaySeconds(attempt),terminal?"RETRY_CEILING":"EMERGENCY_WORKER_ERROR",terminal?"RETRY_CEILING":"UNKNOWN",state.id]);console.error("teaser emergency item failed",{jobId:state.job_id,channelId:state.channel_id,stateId:state.id,errorCategory:error instanceof Error?error.name:"unknown",retryCount:attempt});}
  }
  const[totals]=await pool.query<Array<RowDataPacket&{queued:number;injected:number;skipped:number;failed:number;retrying:number}>>("SELECT SUM(status IN ('queued','processing')) queued,SUM(status='injected') injected,SUM(status='skipped') skipped,SUM(status='failed') failed,SUM(status='retrying') retrying FROM teaser_emergency_job_channels WHERE job_id=?",[job.id]);
  const t=totals[0];
  await pool.query("UPDATE teaser_emergency_jobs SET queued_count=?,injected_count=?,skipped_count=?,failed_count=?,retrying_count=?,status=IF(discovery_complete=1 AND ?=0 AND ?=0,'completed','running'),completed_at=IF(discovery_complete=1 AND ?=0 AND ?=0,NOW(),NULL),lease_until=NULL WHERE id=?",[t.queued||0,t.injected||0,t.skipped||0,t.failed||0,t.retrying||0,t.queued||0,t.retrying||0,t.queued||0,t.retrying||0,job.id]);
  return{jobs:1,processed:states.length};
}
