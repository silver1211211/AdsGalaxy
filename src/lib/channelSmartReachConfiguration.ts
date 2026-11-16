import {decimalToUnits,unitsToDecimal} from "@/lib/channelAllocationMath";
import {isPhase1FinancialBackendEnabled} from "@/lib/channelPhase1FinancialPolicy";

export const SMART_REACH_POLICY_VERSION="adsgalaxy-smart-reach-v1";
export const SMART_REACH_INITIAL_CPM="0.10000000";
export const SMART_REACH_INTERNAL_FIELDS=[
  "financial_policy_version","financial_billing_mode","smart_reach_effective_cpm",
  "smart_reach_last_evaluated_at","last_dynamic_cpm_evaluated_at","current_effective_cpm",
] as const;

export function isSmartReachConfigurationEnabled(env:Record<string,string|undefined>=process.env){
  return isPhase1FinancialBackendEnabled(env)&&env.CHANNEL_SMART_REACH_CONFIG_ENABLED==="true";
}

/** The client requests a mode and maximum only; all financial state is server-selected. */
export function resolveSmartReachCreationConfiguration(input:{
  requestedMode:unknown;maximumCpm:unknown;campaignType:string;campaignKind:string;
  teaserMode:string;clientInternalFields?:readonly string[];
  env?:Record<string,string|undefined>;
}){
  if(input.clientInternalFields?.length)throw new Error("smart_reach_internal_fields_forbidden");
  const mode=String(input.requestedMode??"").trim();
  if(mode!==""&&mode!=="standard_cpc"&&mode!=="smart_reach")throw new Error("invalid_campaign_billing_mode");
  if(mode!=="smart_reach"){
    if(input.maximumCpm!==null&&input.maximumCpm!==undefined&&String(input.maximumCpm).trim()!=="")
      throw new Error("standard_cpc_cannot_set_smart_reach_maximum");
    return {smartReach:false,billingMode:null,maxCpm:null,effectiveCpm:null,
      lastEvaluatedAt:null,policyVersion:null};
  }
  if(!isSmartReachConfigurationEnabled(input.env))throw new Error("smart_reach_configuration_disabled");
  if(input.campaignType!=="clicks"||input.campaignKind!=="channel"||input.teaserMode!=="none")
    throw new Error("smart_reach_requires_standard_channel_cpc");
  if(typeof input.maximumCpm!=="string"||!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(input.maximumCpm))
    throw new Error("invalid_smart_reach_maximum_cpm");
  const maximum=decimalToUnits(input.maximumCpm);
  if(maximum<decimalToUnits("0.10")||maximum>decimalToUnits("0.50"))
    throw new Error("smart_reach_maximum_cpm_out_of_range");
  return {smartReach:true,billingMode:"smart_reach" as const,maxCpm:unitsToDecimal(maximum),
    effectiveCpm:SMART_REACH_INITIAL_CPM,lastEvaluatedAt:null,policyVersion:SMART_REACH_POLICY_VERSION};
}
