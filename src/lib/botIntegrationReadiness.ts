export type BotIntegrationDiagnosticStatus = "success" | "warning" | "failure";

export type BotIntegrationDiagnosticCheck = {
  key: string;
  status: BotIntegrationDiagnosticStatus;
};

const REQUIRED_SUCCESS_CHECKS = [
  "bot_approved",
  "encryption_config",
  "bot_token_storage",
  "integration_secret",
  "telegram_getme",
  "sdk_connected",
  "sdk_callback",
  "database_registration",
  "connection_state",
] as const;

export function evaluateBotIntegrationReadiness(checks: BotIntegrationDiagnosticCheck[]) {
  const byKey = new Map(checks.map((item) => [item.key, item.status]));
  const failedRequirements: string[] = REQUIRED_SUCCESS_CHECKS.filter((key) => byKey.get(key) !== "success");
  if (byKey.get("telegram_webhook") === "failure") failedRequirements.push("telegram_webhook");
  return { ready: failedRequirements.length === 0, failedRequirements };
}
