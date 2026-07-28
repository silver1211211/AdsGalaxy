export type BotDiagnosticQueryable = {
  query<T>(sql: string, values: unknown[]): Promise<[T, unknown]>;
};

export async function loadOwnedBotForIntegrationDiagnostic<T extends object>(
  db: BotDiagnosticQueryable,
  botId: string | number,
  publisherId: string | number
) {
  const [bots] = await db.query<T[]>(
    `SELECT id, user_id, bot_name, bot_username, status, bot_token, bot_token_encrypted,
      integration_secret_encrypted, integration_secret_hash, integration_installed_at,
      integration_last_received_at, integration_last_error_at, integration_last_error
     FROM bots
     WHERE id = ? AND user_id = ? AND is_deleted = FALSE
     LIMIT 1`,
    [botId, publisherId]
  );
  return bots[0] ?? null;
}
