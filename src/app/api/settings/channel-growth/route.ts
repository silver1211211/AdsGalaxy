import { NextResponse } from "next/server";
import { getGrowthSettings } from "@/lib/channelGrowth";
export async function GET(){const settings=await getGrowthSettings();return NextResponse.json({min_cps:settings.min,recommended_cps:settings.recommended,max_cps:settings.max,seed_cap:settings.seedCap});}
