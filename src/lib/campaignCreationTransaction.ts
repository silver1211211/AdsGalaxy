import type { PoolConnection } from "mysql2/promise";

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
    const campaignId = await input.createCampaign(conn);
    await conn.commit();
    return { success: true as const, id: campaignId };
  } catch (error) {
    await conn.rollback();
    throw error;
  }
}
