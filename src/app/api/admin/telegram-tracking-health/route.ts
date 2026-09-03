import {NextResponse} from "next/server";
import pool from "@/lib/db";
import {requireAdminPermission} from "@/lib/adminAuth";
export async function GET(){const {response}=await requireAdminPermission("read");if(response)return response;const [rows]:any=await pool.query("SELECT account_key,status,last_success_at,last_auth_failure_at,last_error_code,manual_reauthorization_required,updated_at FROM telegram_tracking_account_health ORDER BY account_key");return NextResponse.json({accounts:rows.map((r:any)=>({...r,account_key:String(r.account_key).replace(/account_(\d+)/,'Tracking account $1')}))});}
