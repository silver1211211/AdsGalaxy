import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

export const DEPOSIT_BONUS_PROMOTION_SLUG = "deposit-bonus-2026-two-month";

const MONEY_SCALE = BigInt(100_000_000);

function decimalToUnits(value: unknown): bigint {
  const text = String(value ?? "0").trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error("invalid_deposit_amount");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * MONEY_SCALE + BigInt((fraction + "00000000").slice(0, 8));
}

function unitsToDecimal(units: bigint): string {
  const whole = units / MONEY_SCALE;
  const fraction = (units % MONEY_SCALE).toString().padStart(8, "0");
  return `${whole}.${fraction}`;
}

export function depositBonusRateBasisPoints(amount: unknown): number {
  const units = decimalToUnits(amount);
  if (units < BigInt(100) * MONEY_SCALE) return 0;
  if (units < BigInt(300) * MONEY_SCALE) return 500;
  if (units < BigInt(720) * MONEY_SCALE) return 750;
  if (units < BigInt(2201) * MONEY_SCALE) return 1000;
  return 1200;
}

export function calculateDepositBonus(amount: unknown) {
  const principalUnits = decimalToUnits(amount);
  const rateBasisPoints = depositBonusRateBasisPoints(amount);
  const rawNumerator = principalUnits * BigInt(rateBasisPoints);
  const rawUnits = rawNumerator / BigInt(10_000);
  const centUnits = BigInt(1_000_000);
  const bonusUnits = ((rawUnits + centUnits / BigInt(2)) / centUnits) * centUnits;
  return {
    rateBasisPoints,
    ratePercent: unitsToDecimal(BigInt(rateBasisPoints) * BigInt(10_000)),
    bonusAmount: unitsToDecimal(bonusUnits),
    totalCredited: unitsToDecimal(principalUnits + bonusUnits),
  };
}

type PromotionRow = RowDataPacket & {
  id: number;
  starts_at: Date | string;
  ends_at: Date | string;
};

export async function awardDepositBonus(
  conn: PoolConnection,
  input: {
    depositId: number;
    userId: number;
    confirmedAmount: string;
    confirmedAt: Date;
  },
) {
  const [existing] = await conn.query<Array<RowDataPacket & {
    bonus_amount: string;
    rate_basis_points: number;
  }>>(
    "SELECT bonus_amount, rate_basis_points FROM deposit_bonuses WHERE deposit_id = ? LIMIT 1",
    [input.depositId],
  );
  if (existing[0]) {
    return {
      awarded: false,
      alreadyRecorded: true,
      bonusAmount: String(existing[0].bonus_amount),
      rateBasisPoints: Number(existing[0].rate_basis_points),
    };
  }

  const [promotions] = await conn.query<PromotionRow[]>(
    `SELECT id, starts_at, ends_at
     FROM deposit_promotions
     WHERE slug = ? AND is_active = TRUE
       AND starts_at <= ? AND ? < ends_at
     LIMIT 1`,
    [DEPOSIT_BONUS_PROMOTION_SLUG, input.confirmedAt, input.confirmedAt],
  );
  const promotion = promotions[0];
  const calculation = calculateDepositBonus(input.confirmedAmount);
  if (!promotion || calculation.rateBasisPoints === 0) {
    return { awarded: false, alreadyRecorded: false, bonusAmount: "0.00000000", rateBasisPoints: 0 };
  }

  const [balanceRows] = await conn.query<Array<RowDataPacket & { ad_balance: string }>>(
    "SELECT ad_balance FROM users WHERE id = ? FOR UPDATE",
    [input.userId],
  );
  if (!balanceRows[0]) throw new Error("deposit_user_missing");

  await conn.query("UPDATE users SET ad_balance = ad_balance + ? WHERE id = ?", [
    calculation.bonusAmount,
    input.userId,
  ]);
  const [updatedRows] = await conn.query<Array<RowDataPacket & { ad_balance: string }>>(
    "SELECT ad_balance FROM users WHERE id = ?",
    [input.userId],
  );
  const resultingBalance = String(updatedRows[0].ad_balance);

  await conn.query(
    `INSERT INTO deposit_bonuses
       (deposit_id, user_id, promotion_id, confirmed_amount, rate_basis_points,
        bonus_amount, resulting_ad_balance, status, awarded_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'awarded', ?, NOW(), NOW())`,
    [
      input.depositId,
      input.userId,
      promotion.id,
      input.confirmedAmount,
      calculation.rateBasisPoints,
      calculation.bonusAmount,
      resultingBalance,
      input.confirmedAt,
    ],
  );
  await conn.query(
    `INSERT INTO advertiser_transactions (user_id, amount, type, description)
     VALUES (?, ?, 'credit', ?)`,
    [
      input.userId,
      calculation.bonusAmount,
      `Deposit bonus for deposit #${input.depositId} (${calculation.rateBasisPoints / 100}%)`,
    ],
  );
  return {
    awarded: true,
    alreadyRecorded: false,
    bonusAmount: calculation.bonusAmount,
    rateBasisPoints: calculation.rateBasisPoints,
  };
}

export async function confirmDepositCredit(
  db: Pool,
  input: {
    depositId: number;
    userId: number;
    confirmedAmount: string;
    providerTransaction: string | null;
    confirmedAt: Date;
  },
) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<Array<RowDataPacket & {
      id: number;
      user_id: number;
      order_id: string;
      status: string;
      amount: string;
    }>>(
      "SELECT id, user_id, order_id, status, amount FROM deposits WHERE id = ? AND user_id = ? FOR UPDATE",
      [input.depositId, input.userId],
    );
    const deposit = rows[0];
    if (!deposit) throw new Error("deposit_not_found");
    if (deposit.status === "paid") {
      const [bonuses] = await conn.query<Array<RowDataPacket & {
        bonus_amount: string;
        rate_basis_points: number;
      }>>(
        "SELECT bonus_amount, rate_basis_points FROM deposit_bonuses WHERE deposit_id = ? LIMIT 1",
        [deposit.id],
      );
      await conn.commit();
      return {
        credited: false,
        idempotent: true,
        principalAmount: String(deposit.amount),
        bonusAmount: String(bonuses[0]?.bonus_amount || "0.00000000"),
        rateBasisPoints: Number(bonuses[0]?.rate_basis_points || 0),
      };
    }
    if (!["pending", "waiting", "paying"].includes(deposit.status)) {
      await conn.commit();
      return {
        credited: false,
        idempotent: false,
        principalAmount: String(deposit.amount),
        bonusAmount: "0.00000000",
        rateBasisPoints: 0,
      };
    }

    const [updated] = await conn.query<import("mysql2/promise").ResultSetHeader>(
      `UPDATE deposits
       SET status = 'paid', txn_id = ?, amount = ?, currency = 'USDT', confirmed_at = ?
       WHERE id = ? AND user_id = ? AND status <> 'paid'`,
      [input.providerTransaction, input.confirmedAmount, input.confirmedAt, deposit.id, input.userId],
    );
    if (updated.affectedRows !== 1) throw new Error("deposit_confirmation_race");
    const [credited] = await conn.query<import("mysql2/promise").ResultSetHeader>(
      "UPDATE users SET ad_balance = ad_balance + ? WHERE id = ?",
      [input.confirmedAmount, input.userId],
    );
    if (credited.affectedRows !== 1) throw new Error("deposit_user_missing");
    await conn.query(
      `INSERT INTO advertiser_transactions (user_id, amount, type, description)
       VALUES (?, ?, 'credit', ?)`,
      [input.userId, input.confirmedAmount, `Deposit via OxaPay converted to USDT (Order: ${deposit.order_id})`],
    );
    const bonus = await awardDepositBonus(conn, {
      depositId: deposit.id,
      userId: input.userId,
      confirmedAmount: input.confirmedAmount,
      confirmedAt: input.confirmedAt,
    });
    await conn.commit();
    return {
      credited: true,
      idempotent: false,
      principalAmount: input.confirmedAmount,
      bonusAmount: bonus.bonusAmount,
      rateBasisPoints: bonus.rateBasisPoints,
    };
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    throw error;
  } finally {
    conn.release();
  }
}

export async function reverseDepositBonus(conn: PoolConnection, depositId: number, reversedAt = new Date()) {
  const [rows] = await conn.query<Array<RowDataPacket & {
    id: number;
    user_id: number;
    bonus_amount: string;
    reversed_amount: string;
    status: string;
  }>>(
    "SELECT id, user_id, bonus_amount, reversed_amount, status FROM deposit_bonuses WHERE deposit_id = ? FOR UPDATE",
    [depositId],
  );
  const bonus = rows[0];
  if (!bonus || bonus.status === "reversed") return { reversed: false, idempotent: true };

  const [users] = await conn.query<Array<RowDataPacket & { ad_balance: string }>>(
    "SELECT ad_balance FROM users WHERE id = ? FOR UPDATE",
    [bonus.user_id],
  );
  if (!users[0]) throw new Error("deposit_user_missing");
  const available = decimalToUnits(users[0].ad_balance);
  const awarded = decimalToUnits(bonus.bonus_amount);
  const reversible = available < awarded ? available : awarded;
  const reversedAmount = unitsToDecimal(reversible);

  if (reversible > BigInt(0)) {
    await conn.query("UPDATE users SET ad_balance = ad_balance - ? WHERE id = ?", [reversedAmount, bonus.user_id]);
    await conn.query(
      `INSERT INTO advertiser_transactions (user_id, amount, type, description)
       VALUES (?, ?, 'debit', ?)`,
      [bonus.user_id, `-${reversedAmount}`, `Deposit bonus reversal for deposit #${depositId}`],
    );
  }
  await conn.query(
    `UPDATE deposit_bonuses
     SET status = 'reversed', reversed_amount = ?, reversed_at = ?, updated_at = NOW()
     WHERE id = ? AND status = 'awarded'`,
    [reversedAmount, reversedAt, bonus.id],
  );
  return { reversed: true, idempotent: false, reversedAmount };
}
