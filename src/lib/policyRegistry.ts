export const POLICY_VERSION = "v1" as const;
export const MINIMUM_PUBLISHER_CHANNEL_SUBSCRIBERS = 100 as const;

export type PolicyScope =
  | "publisher.general" | "publisher.channel" | "publisher.bot" | "publisher.mini-app"
  | "advertiser.general" | "advertiser.channel" | "advertiser.channel-growth"
  | "advertiser.teaser" | "advertiser.mini-app" | "advertiser.bot";

export type PolicyRule = {
  rule_key: string;
  scope: PolicyScope;
  public_number: number;
  admin_label: string;
  public_title: string;
  public_description: string;
  resolution: string;
  policy_version: typeof POLICY_VERSION;
  status: "active" | "retired";
  policy_path: string;
};

export type PolicyDefinition = { scope: PolicyScope; name: string; path: string; summary: string; rules: PolicyRule[] };
type ActiveRuleRow = [number, string, string, string, string];
type HistoricalRuleRow = [PolicyScope, string, number, string, string];

const definition = (scope: PolicyScope, name: string, path: string, summary: string, rows: ActiveRuleRow[]): PolicyDefinition => ({
  scope, name, path, summary,
  rules: rows.map(([public_number, suffix, admin_label, public_description, resolution]) => ({
    rule_key: `${scope}.${suffix}`, scope, public_number, admin_label,
    public_title: admin_label, public_description, resolution,
    policy_version: POLICY_VERSION, status: "active", policy_path: path,
  })),
});

export const POLICY_DEFINITIONS: readonly PolicyDefinition[] = [
  definition("publisher.general", "Publisher Policy", "/policy/publisher", "The shared fallback standard for every publisher property.", [
    [0, "general-review", "General Review", "The property did not pass professional review for a material concern not covered by a specific rule.", "Review the moderation feedback, correct the concern, and resubmit the property."],
  ]),
  definition("publisher.channel", "Publisher Channel Policy", "/policy/publisher/channel", "Standards for Telegram channels participating in AdsGalaxy monetization.", [
    [1, "verification-issue", "Verification Issue", "AdsGalaxy could not reliably verify the channel, its ownership, or its current Telegram state.", "Restore verifiable access and complete channel verification again."],
    [2, "fraud-artificial-engagement", "Fraud / Artificial Engagement", "The channel shows deceptive activity or artificially generated subscribers, views, clicks, or engagement.", "Remove manipulated activity and build an authentic, verifiable audience before resubmitting."],
    [3, "restricted-content", "Restricted Content", "The channel contains content or activity that AdsGalaxy does not permit for monetization.", "Remove restricted material and ensure future content follows the policy."],
    [4, "inaccessible-channel", "Inaccessible Channel", "AdsGalaxy cannot reliably access the channel for review or ad delivery.", "Restore access for the AdsGalaxy bot and verify the channel again."],
    [5, "missing-permissions", "Missing Permissions", "The channel is missing Telegram permissions required by its enabled ad formats.", "Grant the required permissions and run verification again."],
    [6, "poor-content-quality", "Poor Content Quality", "The channel does not meet AdsGalaxy standards for useful, authentic, and professionally presented content.", "Improve the quality and consistency of the channel content, then resubmit."],
  ]),
  definition("publisher.bot", "Publisher Bot Policy", "/policy/publisher/bot", "Standards for Telegram bots participating in AdsGalaxy monetization.", [
    [1, "non-functional-bot", "Non-functional Bot", "The bot or a core user flow does not work reliably.", "Repair the bot and verify its main flows before resubmitting."],
    [2, "fraud-abuse", "Fraud / Abuse", "The bot shows deceptive, fraudulent, manipulated, or abusive behavior.", "Remove the harmful behavior and provide authentic, verifiable operation."],
    [3, "restricted-content", "Restricted Content", "The bot provides or promotes content that AdsGalaxy does not permit.", "Remove restricted content and resubmit."],
    [4, "invalid-integration", "Invalid Integration", "The AdsGalaxy integration is missing, invalid, unsafe, or cannot be verified.", "Install and verify the supported server-side integration."],
    [5, "spam-misleading-rewards", "Spam / Misleading Rewards", "The bot sends spam or presents unclear, deceptive, or unfulfilled reward claims.", "Use consent-based messaging and state and honor all reward terms clearly."],
  ]),
  definition("publisher.mini-app", "Publisher Mini App Policy", "/policy/publisher/mini-app", "Standards for Telegram Mini Apps participating in AdsGalaxy monetization.", [
    [1, "non-functional-mini-app", "Non-functional Mini App", "The Mini App or a core user flow does not work reliably.", "Repair the affected flow and verify it on Telegram before resubmitting."],
    [2, "fraud-abuse", "Fraud / Abuse", "The Mini App shows deceptive, fraudulent, manipulated, or abusive behavior.", "Remove the harmful behavior and provide authentic, verifiable operation."],
    [3, "restricted-content", "Restricted Content", "The Mini App contains content or activity that AdsGalaxy does not permit.", "Remove restricted content and resubmit."],
    [4, "invalid-integration", "Invalid Integration", "The AdsGalaxy integration is missing, invalid, unsafe, or cannot be verified.", "Use the supported integration and verify it again."],
    [5, "unsafe-forced-interaction", "Unsafe / Forced Interaction", "The Mini App uses unsafe, deceptive, unrelated, or non-consensual ad interaction.", "Make interaction safe and voluntary, or clearly disclose and honor legitimate reward terms."],
  ]),
  definition("advertiser.general", "Advertiser Policy", "/policy/advertiser", "The shared fallback standard for every advertiser campaign.", [
    [0, "general-review", "General Review", "The campaign did not pass professional review for a material concern not covered by a specific rule.", "Review the moderation feedback, correct the concern, and resubmit the campaign."],
  ]),
  definition("advertiser.channel", "Advertiser Channel Campaign Policy", "/policy/advertiser/channel", "Standards for Telegram channel campaigns.", [
    [1, "invalid-destination", "Invalid Destination", "The campaign destination is invalid, inaccessible, unsafe, or unsupported.", "Use a valid, safe, supported destination."],
    [2, "restricted-content", "Restricted Content", "The campaign promotes content, goods, services, or activity that AdsGalaxy does not permit.", "Remove restricted material and submit a compliant campaign."],
    [3, "misleading-claims", "Misleading Claims", "The campaign contains inaccurate, unsupported, exaggerated, or deceptive claims.", "Use accurate, supportable claims that match the destination."],
    [4, "spam-clickbait", "Spam / Clickbait", "The campaign uses spam, sensational clickbait, or misleading engagement tactics.", "Replace it with accurate, useful, professionally presented creative."],
    [5, "creative-format-issue", "Creative / Format Issue", "The creative is incomplete, misleading, or incompatible with the selected channel format.", "Correct the creative and preview it before resubmitting."],
  ]),
  definition("advertiser.channel-growth", "Channel Growth Campaign Policy", "/policy/advertiser/channel-growth", "Standards for verified-subscriber Channel Growth campaigns.", [
    [1, "invalid-channel", "Invalid Channel", "The destination channel is invalid, inaccessible, unsupported, or cannot be verified.", "Use a valid supported channel and complete verification."],
    [2, "restricted-content", "Restricted Content", "The campaign promotes content or activity that AdsGalaxy does not permit.", "Remove restricted material and submit a compliant campaign."],
    [3, "misleading-promotion", "Misleading Promotion", "The promotion inaccurately describes the destination channel or expected subscriber experience.", "Make the promotion accurate and consistent with the destination channel."],
    [4, "campaign-quality-issue", "Campaign Quality Issue", "The campaign setup or creative does not meet Channel Growth quality standards.", "Improve the campaign setup and creative, then resubmit."],
  ]),
  definition("advertiser.teaser", "Teaser Campaign Policy", "/policy/advertiser/teaser", "Standards for compact Teaser ads delivered inside eligible channel posts.", [
    [1, "invalid-destination", "Invalid Destination", "The Teaser destination is invalid, inaccessible, unsafe, or unsupported.", "Use a valid, safe, supported destination."],
    [2, "restricted-content", "Restricted Content", "The Teaser promotes content or activity that AdsGalaxy does not permit.", "Remove restricted material and submit a compliant Teaser."],
    [3, "misleading-copy", "Misleading Copy", "The Teaser copy is inaccurate, deceptive, or does not match its destination.", "Use clear, accurate copy that matches the destination."],
    [4, "teaser-format-issue", "Teaser Format Issue", "The Teaser does not meet the supported copy, CTA, pricing, or text-only format requirements.", "Correct the Teaser configuration using the requirements shown in the campaign builder."],
  ]),
  definition("advertiser.mini-app", "Mini App Campaign Policy", "/policy/advertiser/mini-app", "Standards for campaigns delivered in Telegram Mini Apps.", [
    [1, "invalid-destination", "Invalid Destination", "The destination is invalid, inaccessible, unsafe, or unsupported.", "Use a valid, safe, supported destination."],
    [2, "restricted-content", "Restricted Content", "The campaign promotes content or activity that AdsGalaxy does not permit.", "Remove restricted material and submit a compliant campaign."],
    [3, "misleading-claims", "Misleading Claims", "The campaign contains inaccurate, unsupported, exaggerated, or deceptive claims.", "Use accurate, supportable claims that match the destination."],
    [4, "unsafe-redirect", "Unsafe Redirect", "The campaign sends users through an unsafe, deceptive, or unauthorized redirect.", "Use a direct, safe destination that matches the campaign."],
    [5, "creative-format-issue", "Creative / Format Issue", "The creative is incomplete, misleading, or incompatible with Mini App placement.", "Correct the creative and use a supported Mini App format."],
  ]),
  definition("advertiser.bot", "Bot Campaign Policy", "/policy/advertiser/bot", "Standards for campaigns delivered through Telegram bots.", [
    [1, "invalid-destination", "Invalid Destination", "The destination is invalid, inaccessible, unsafe, or unsupported.", "Use a valid, safe, supported destination."],
    [2, "restricted-content", "Restricted Content", "The campaign promotes content or activity that AdsGalaxy does not permit.", "Remove restricted material and submit a compliant campaign."],
    [3, "misleading-claims", "Misleading Claims", "The campaign contains inaccurate, unsupported, exaggerated, or deceptive claims.", "Use accurate, supportable claims that match the destination."],
    [4, "unsafe-redirect", "Unsafe Redirect", "The campaign sends users through an unsafe, deceptive, or unauthorized redirect.", "Use a direct, safe destination that matches the campaign."],
    [5, "spam-format-issue", "Spam / Format Issue", "The campaign uses spam or does not meet the supported bot delivery format.", "Remove spam tactics and correct the campaign to the supported bot format."],
  ]),
] as const;

// Retired rules stay in this same authoritative registry only so existing ledger
// rows remain understandable. They are excluded from public pages and Admin inputs.
const HISTORICAL_RULE_ROWS: HistoricalRuleRow[] = [
  ["publisher.channel","/policy/publisher/channel",0,"general-review","General Review"],
  ["publisher.channel","/policy/publisher/channel",2,"fraud","Fraud"],
  ["publisher.channel","/policy/publisher/channel",4,"inactive-channel","Inactive Channel"],
  ["publisher.channel","/policy/publisher/channel",5,"inaccessible","Inaccessible"],
  ["publisher.channel","/policy/publisher/channel",7,"artificial-engagement","Artificial Engagement"],
  ["publisher.channel","/policy/publisher/channel",8,"content-quality","Content Quality"],
  ["publisher.channel","/policy/publisher/channel",9,"low-subscribers","Low Subscribers"],
  ["publisher.bot","/policy/publisher/bot",0,"general-review","General Review"],
  ["publisher.bot","/policy/publisher/bot",1,"non-functional","Non-functional"],
  ["publisher.bot","/policy/publisher/bot",2,"fraud","Fraud"],
  ["publisher.bot","/policy/publisher/bot",5,"spam","Spam"],
  ["publisher.bot","/policy/publisher/bot",6,"misleading-rewards","Misleading Rewards"],
  ["publisher.bot","/policy/publisher/bot",7,"unsafe-redirect","Unsafe Redirect"],
  ["publisher.bot","/policy/publisher/bot",8,"placement-issue","Placement Issue"],
  ["publisher.mini-app","/policy/publisher/mini-app",0,"general-review","General Review"],
  ["publisher.mini-app","/policy/publisher/mini-app",1,"non-functional","Non-functional"],
  ["publisher.mini-app","/policy/publisher/mini-app",2,"fraud","Fraud"],
  ["publisher.mini-app","/policy/publisher/mini-app",4,"placement-issue","Placement Issue"],
  ["publisher.mini-app","/policy/publisher/mini-app",5,"forced-interaction","Forced Interaction"],
  ["publisher.mini-app","/policy/publisher/mini-app",6,"misleading-rewards","Misleading Rewards"],
  ["publisher.mini-app","/policy/publisher/mini-app",8,"unsafe-redirect","Unsafe Redirect"],
  ["advertiser.general","/policy/advertiser",1,"restricted-content","Restricted Content"],
  ["advertiser.general","/policy/advertiser",2,"fraud","Fraud"],
  ["advertiser.general","/policy/advertiser",3,"unsafe-link","Unsafe Link"],
  ["advertiser.general","/policy/advertiser",4,"content-mismatch","Content Mismatch"],
  ["advertiser.general","/policy/advertiser",5,"broken-destination","Broken Destination"],
  ["advertiser.general","/policy/advertiser",6,"unrealistic-claims","Unrealistic Claims"],
  ["advertiser.general","/policy/advertiser",7,"rights-violation","Rights Violation"],
  ["advertiser.general","/policy/advertiser",8,"spam-clickbait","Spam / Clickbait"],
  ["advertiser.general","/policy/advertiser",9,"questionable-activity","Questionable Activity"],
  ["advertiser.general","/policy/advertiser",10,"unsafe-content","Unsafe Content"],
  ["advertiser.general","/policy/advertiser",11,"harmful-software","Harmful Software"],
  ["advertiser.general","/policy/advertiser",12,"regulated-goods","Regulated Goods"],
  ["advertiser.general","/policy/advertiser",13,"format-violation","Format Violation"],
  ["advertiser.general","/policy/advertiser",14,"low-quality-destination","Low-quality Destination"],
  ["advertiser.general","/policy/advertiser",15,"circumvention","Circumvention"],
  ["advertiser.channel","/policy/advertiser/channel",0,"general-review","General Channel Review"],
  ["advertiser.channel","/policy/advertiser/channel",2,"invalid-creative","Invalid Creative"],
  ["advertiser.channel","/policy/advertiser/channel",3,"invalid-pricing","Invalid Pricing"],
  ["advertiser.channel","/policy/advertiser/channel",4,"invalid-targeting","Invalid Targeting"],
  ["advertiser.channel-growth","/policy/advertiser/channel-growth",0,"general-review","General Growth Review"],
  ["advertiser.channel-growth","/policy/advertiser/channel-growth",2,"bot-permission","Bot Permission"],
  ["advertiser.channel-growth","/policy/advertiser/channel-growth",3,"invalid-cps","Invalid CPS"],
  ["advertiser.channel-growth","/policy/advertiser/channel-growth",4,"unsupported-destination","Unsupported Destination"],
  ["advertiser.channel-growth","/policy/advertiser/channel-growth",5,"growth-format","Growth Format"],
  ["advertiser.teaser","/policy/advertiser/teaser",0,"general-review","General Teaser Review"],
  ["advertiser.teaser","/policy/advertiser/teaser",1,"invalid-copy","Invalid Copy"],
  ["advertiser.teaser","/policy/advertiser/teaser",2,"invalid-cta","Invalid CTA"],
  ["advertiser.teaser","/policy/advertiser/teaser",3,"invalid-cpm","Invalid CPM"],
  ["advertiser.teaser","/policy/advertiser/teaser",4,"invalid-format","Invalid Format"],
  ["advertiser.mini-app","/policy/advertiser/mini-app",0,"general-review","General Mini App Review"],
  ["advertiser.mini-app","/policy/advertiser/mini-app",1,"invalid-creative","Invalid Creative"],
  ["advertiser.mini-app","/policy/advertiser/mini-app",3,"unsupported-format","Unsupported Format"],
  ["advertiser.mini-app","/policy/advertiser/mini-app",4,"invalid-pricing","Invalid Pricing"],
  ["advertiser.bot","/policy/advertiser/bot",0,"general-review","General Bot Campaign Review"],
  ["advertiser.bot","/policy/advertiser/bot",1,"invalid-creative","Invalid Creative"],
  ["advertiser.bot","/policy/advertiser/bot",3,"unsupported-format","Unsupported Format"],
  ["advertiser.bot","/policy/advertiser/bot",4,"invalid-pricing","Invalid Pricing"],
];

const RETIRED_POLICY_RULES: PolicyRule[] = HISTORICAL_RULE_ROWS.map(([scope, policy_path, public_number, suffix, admin_label]) => ({
  rule_key: `${scope}.${suffix}`, scope, public_number, admin_label, public_title: admin_label,
  public_description: "This historical rule is retained only for existing moderation records.",
  resolution: "Refer to the original moderation feedback for this historical rejection.",
  policy_version: POLICY_VERSION, status: "retired", policy_path,
}));

const BY_SCOPE = new Map(POLICY_DEFINITIONS.map((item) => [item.scope, item]));
const BY_KEY = new Map([...RETIRED_POLICY_RULES, ...POLICY_DEFINITIONS.flatMap((item) => item.rules)].map((rule) => [rule.rule_key, rule]));

export function getPolicyDefinition(scope: PolicyScope) { return BY_SCOPE.get(scope); }
export function getPolicyRule(ruleKey: string) { return BY_KEY.get(ruleKey); }
export function policyRulesForScope(scope: PolicyScope) {
  const policy = getPolicyDefinition(scope);
  if (!policy) return [];
  const ownRules = policy.rules.filter((rule) => rule.status === "active");
  if (scope.endsWith(".general")) return ownRules;
  const sharedScope = scope.startsWith("publisher.") ? "publisher.general" : "advertiser.general";
  return [...(getPolicyDefinition(sharedScope)?.rules || []).filter((rule) => rule.status === "active"), ...ownRules];
}
export function activePolicyRulesForScopes(scopes: readonly PolicyScope[]) {
  const seen = new Set<string>();
  return scopes.flatMap((scope) => getPolicyDefinition(scope)?.rules || []).filter((rule) => {
    if (rule.status !== "active" || seen.has(rule.rule_key)) return false;
    seen.add(rule.rule_key);
    return true;
  });
}
export function policyRuleHref(rule: PolicyRule) { return `${rule.policy_path}#rule-${rule.public_number}`; }
export function policyRuleReference(rule: PolicyRule) {
  const policy = getPolicyDefinition(rule.scope);
  return `Rule ${rule.public_number} of ${policy?.name || "Ads Galaxy Policy"}`;
}
export function publicPolicyOrigin() {
  return String(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_ADSGALAXY_APP_URL || "https://app.adsgalaxy.online").replace(/\/$/, "");
}
export function publicPolicyUrl(rule: PolicyRule) { return `${publicPolicyOrigin()}${policyRuleHref(rule)}`; }

type CampaignPolicyClassifier = { campaign_kind?: unknown; source_campaign_kind?: unknown; type?: unknown; teaser_mode?: unknown; teaser_enabled?: unknown };

export function campaignPolicyScopes(row: CampaignPolicyClassifier): PolicyScope[] {
  const kind = String(row.source_campaign_kind || row.campaign_kind || "").toLowerCase();
  const type = String(row.type || "").toLowerCase();
  const teaserMode = String(row.teaser_mode || "none").toLowerCase();
  if (kind === "channel_growth") return ["advertiser.channel-growth"];
  if (type === "broadcast" || kind === "bot") return ["advertiser.bot"];
  if (kind === "teaser" || type === "teaser" || teaserMode === "teaser_only") return ["advertiser.teaser"];
  if (teaserMode === "standard_plus_teaser" || (row.teaser_enabled && teaserMode !== "none")) return ["advertiser.channel", "advertiser.teaser"];
  return ["advertiser.channel"];
}

export function campaignPolicyScope(row: CampaignPolicyClassifier): PolicyScope {
  return campaignPolicyScopes(row)[0];
}

export function applicablePolicyScopes(entityType: string, row: CampaignPolicyClassifier = {}): PolicyScope[] {
  if (entityType === "channel") return ["publisher.general", "publisher.channel"];
  if (entityType === "bot") return ["publisher.general", "publisher.bot"];
  if (entityType === "miniapp") return ["publisher.general", "publisher.mini-app"];
  if (entityType === "miniapp_rewarded_campaign") return ["advertiser.general", "advertiser.mini-app"];
  if (entityType === "campaign") return ["advertiser.general", ...campaignPolicyScopes(row)];
  return [];
}
