import type { PoolConnection, ResultSetHeader } from "mysql2/promise";
import { CampaignCreatePublicError } from "@/lib/campaignCreationValidation";

export async function executeCampaignCreationTransaction(input: {
  conn: PoolConnection;
  userId: number;
  budget: number;
  description: string;
  createCampaign: (conn: PoolConnection) => Promise<number>;
}) {
  const { conn } = input;
  try {
    await conn.beginTransaction();
    const [balanceResult] = await conn.query<ResultSetHeader>(
      `UPDATE users
       SET ad_balance = ad_balance - ?
       WHERE id = ? AND ad_balance >= ?`,
      [input.budget, input.userId, input.budget]
    );
    if (balanceResult.affectedRows !== 1) {
      throw new CampaignCreatePublicError(
        "INSUFFICIENT_AD_BALANCE",
        "Insufficient ad balance. Please deposit funds."
      );
    }

    const campaignId = await input.createCampaign(conn);
    await conn.query(
      "INSERT INTO advertiser_transactions (user_id, amount, type, description) VALUES (?, ?, 'debit', ?)",
      [input.userId, input.budget, input.description]
    );
    await conn.commit();
    return { success: true as const, id: campaignId };
  } catch (error) {
    await conn.rollback();
    throw error;
  }
}
