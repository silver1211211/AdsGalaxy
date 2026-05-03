import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);

    // Get basic referral info
    let [userRows]: any = await pool.query(
      "SELECT referral_code, total_referral_earnings FROM users WHERE id = ?",
      [user.id]
    );

    if (userRows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    let { referral_code, total_referral_earnings } = userRows[0];

    // If no referral code, generate one
    if (!referral_code) {
      referral_code = `REF${user.id}${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
      await pool.query(
        "UPDATE users SET referral_code = ? WHERE id = ?",
        [referral_code, user.id]
      );
    }

    // Get list of referred users
    const [referralRows]: any = await pool.query(
      `SELECT u.first_name, u.last_name, u.username, u.photo_url, u.created_at 
       FROM referrals r
       JOIN users u ON r.user_id = u.id
       WHERE r.invited_by = ?
       ORDER BY r.created_at DESC`,
      [user.id]
    );

    const botUsername = process.env.NEXT_PUBLIC_BOT_USERNAME || "AdsFusion_Bot";
    const referralLink = `https://t.me/${botUsername}?startapp=${referral_code}`;

    return NextResponse.json({
      referral_code,
      referral_link: referralLink,
      total_earnings: total_referral_earnings,
      referrals: referralRows
    });
  } catch (error: any) {
    console.error("Referrals Fetch Error:", error);
    return NextResponse.json({ error: "Failed to fetch referral data" }, { status: 500 });
  }
}
