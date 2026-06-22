import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function toPositiveMoney(value: unknown, field: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${field} must be greater than 0`);
  }
  return amount;
}

function normalizeCountries(value: unknown) {
  const countries = Array.isArray(value) ? value : String(value || "").split(",");
  const normalized = countries
    .map((country) => cleanText(country).toUpperCase())
    .filter(Boolean);

  for (const country of normalized) {
    if (!/^[A-Z]{2}$/.test(country)) {
      throw new Error("Target countries must use 2-letter country codes");
    }
  }

  return normalized.join(",");
}

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const [rows] = await pool.query(
      `SELECT
        c.*,
        COALESCE((SELECT COUNT(*) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id), 0) as impressions,
        COALESCE((SELECT SUM(i.cost) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id), 0) as spend
       FROM miniapp_rewarded_campaigns c
       WHERE c.advertiser_id = ?
       ORDER BY c.created_at DESC`,
      [user.id]
    );
    return NextResponse.json(rows);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load Mini App rewarded campaigns" }, { status: getAuthErrorStatus(error) });
  }
}

export async function POST(request: Request) {
  const conn = await pool.getConnection();

  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const body = await request.json();
    const campaignName = cleanText(body.campaign_name);
    const title = cleanText(body.title);
    const description = cleanText(body.description);
    const landingUrl = cleanText(body.landing_url);
    const imageUrl = cleanText(body.image_url);
    const budget = toPositiveMoney(body.budget, "Budget");
    const targetCountries = normalizeCountries(body.target_countries);

    if (!campaignName || !title || !description || !landingUrl || !imageUrl) {
      return NextResponse.json({ error: "Campaign name, title, description, landing URL, and image URL are required" }, { status: 400 });
    }

    if (!/^https?:\/\//i.test(landingUrl) || !/^https?:\/\//i.test(imageUrl)) {
      return NextResponse.json({ error: "Landing URL and image URL must be valid http(s) URLs" }, { status: 400 });
    }

    await conn.beginTransaction();

    const [userRows]: any = await conn.query("SELECT ad_balance FROM users WHERE id = ? FOR UPDATE", [user.id]);
    const adBalance = Number(userRows[0]?.ad_balance || 0);
    if (adBalance < budget) {
      await conn.rollback();
      return NextResponse.json({ error: "Insufficient ad balance. Please deposit funds." }, { status: 400 });
    }

    await conn.query("UPDATE users SET ad_balance = ad_balance - ? WHERE id = ?", [budget, user.id]);

    const [result]: any = await conn.query(
      `INSERT INTO miniapp_rewarded_campaigns
        (advertiser_id, campaign_name, title, description, image_url, landing_url, budget, remaining_budget, target_countries, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [user.id, campaignName, title, description, imageUrl, landingUrl, budget, budget, targetCountries || null]
    );

    await conn.query(
      "INSERT INTO advertiser_transactions (user_id, amount, type, description) VALUES (?, ?, 'debit', ?)",
      [user.id, budget, `Mini App Rewarded Campaign: ${campaignName}`]
    );

    await conn.commit();
    return NextResponse.json({ success: true, id: result.insertId });
  } catch (error: any) {
    try {
      await conn.rollback();
    } catch {
      // Transaction may not have started.
    }
    return NextResponse.json({ error: error.message || "Failed to create Mini App rewarded campaign" }, { status: getAuthErrorStatus(error) });
  } finally {
    conn.release();
  }
}
