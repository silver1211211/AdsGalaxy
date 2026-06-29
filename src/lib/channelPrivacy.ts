import crypto from "crypto";
import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import {
  isValidPrivateInviteLink,
  normalizePrivateInviteLink,
  normalizePublicChannelUsername,
} from "@/lib/telegramChannelInput";

export {
  isValidPrivateInviteLink,
  normalizePrivateInviteLink,
  normalizePublicChannelUsername,
} from "@/lib/telegramChannelInput";

export type ChannelType = "public" | "private";

const CHANNEL_PRIVACY_COLUMNS = [
  "channel_type",
  "invite_link_hash",
  "private_invite_link_encrypted",
  "view_tracking_status",
  "tracking_account_status",
  "tracking_account",
  "tracking_account_member_status",
  "tracking_account_assigned_at",
  "tracking_account_last_success_at",
  "tracking_account_last_failure_at",
  "tracking_account_failure_reason",
] as const;

export type ChannelPrivacySchema = {
  hasChannelType: boolean;
  hasInviteLinkHash: boolean;
  hasPrivateInviteLinkEncrypted: boolean;
  hasViewTrackingStatus: boolean;
  hasTrackingAccountStatus: boolean;
  hasTrackingAccount: boolean;
  hasTrackingAccountMemberStatus: boolean;
  hasTrackingAccountAssignedAt: boolean;
  hasTrackingAccountLastSuccessAt: boolean;
  hasTrackingAccountLastFailureAt: boolean;
  hasTrackingAccountFailureReason: boolean;
};

export function normalizeChannelType(value: unknown): ChannelType {
  return String(value || "").toLowerCase() === "private" ? "private" : "public";
}

export function parseChannelType(value: unknown): ChannelType | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "private" || normalized === "public") return normalized;
  return null;
}

export function normalizeInviteLink(value: unknown) {
  return normalizePrivateInviteLink(value) || String(value || "").trim();
}

export function looksLikePrivateInviteLink(value: unknown) {
  return normalizePrivateInviteLink(value) !== null;
}

export function inferChannelType(input: { channelType?: unknown; inviteLink?: unknown; username?: unknown }): ChannelType | null {
  const explicit = parseChannelType(input.channelType);
  if (explicit === "private") return "private";

  const normalizedUsername = normalizePublicChannelUsername(input.username);
  const inviteLink = normalizeInviteLink(input.inviteLink);
  if (inviteLink || looksLikePrivateInviteLink(inviteLink)) return "private";

  if (explicit === "public") {
    return normalizedUsername ? "public" : null;
  }

  return normalizedUsername ? "public" : null;
}

export function hashInviteLink(value: unknown) {
  const normalized = normalizeInviteLink(value);
  if (!normalized) return null;

  const secret = process.env.INVITE_LINK_HASH_SECRET || process.env.AUTH_SECRET || process.env.BOT_TOKEN || "adsgalaxy-local";
  return crypto.createHmac("sha256", secret).update(normalized).digest("hex");
}

export async function getChannelPrivacySchema(): Promise<ChannelPrivacySchema> {
  const [rows] = await pool.query<Array<RowDataPacket & { COLUMN_NAME: string }>>(
    `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'channels'
      AND COLUMN_NAME IN (?)
    `,
    [CHANNEL_PRIVACY_COLUMNS]
  );

  const columns = new Set(rows.map((row) => row.COLUMN_NAME));
  return {
    hasChannelType: columns.has("channel_type"),
    hasInviteLinkHash: columns.has("invite_link_hash"),
    hasPrivateInviteLinkEncrypted: columns.has("private_invite_link_encrypted"),
    hasViewTrackingStatus: columns.has("view_tracking_status"),
    hasTrackingAccountStatus: columns.has("tracking_account_status"),
    hasTrackingAccount: columns.has("tracking_account"),
    hasTrackingAccountMemberStatus: columns.has("tracking_account_member_status"),
    hasTrackingAccountAssignedAt: columns.has("tracking_account_assigned_at"),
    hasTrackingAccountLastSuccessAt: columns.has("tracking_account_last_success_at"),
    hasTrackingAccountLastFailureAt: columns.has("tracking_account_last_failure_at"),
    hasTrackingAccountFailureReason: columns.has("tracking_account_failure_reason"),
  };
}
