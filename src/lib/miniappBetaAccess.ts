import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";

type AccessRow = RowDataPacket & {
  miniapp_beta_access?: number | boolean;
};

type Executor = typeof pool | PoolConnection;

export class MiniAppBetaAccessError extends Error {
  statusCode = 403;

  constructor() {
    super("Mini Apps are not available for this account yet.");
    this.name = "MiniAppBetaAccessError";
  }
}

export function hasMiniAppBetaAccess(user: { miniapp_beta_access?: unknown }) {
  return user.miniapp_beta_access === true || Number(user.miniapp_beta_access || 0) === 1;
}

export function getMiniAppBetaAccessStatus(error: unknown) {
  return error instanceof MiniAppBetaAccessError ? error.statusCode : 500;
}

export async function assertMiniAppBetaAccess(user: { miniapp_beta_access?: unknown }) {
  if (!hasMiniAppBetaAccess(user)) {
    throw new MiniAppBetaAccessError();
  }
}

export async function assertMiniAppOwnerBetaAccess(miniappId: number | string, conn?: PoolConnection) {
  const executor: Executor = conn || pool;
  const [rows] = await executor.query<AccessRow[]>(`
    SELECT u.miniapp_beta_access
    FROM miniapps m
    JOIN users u ON m.user_id = u.id
    WHERE m.id = ?
      AND m.is_deleted = FALSE
    LIMIT 1
  `, [miniappId]);

  if (rows.length === 0) {
    throw new Error("Mini App not found");
  }

  if (!hasMiniAppBetaAccess(rows[0])) {
    throw new MiniAppBetaAccessError();
  }
}
