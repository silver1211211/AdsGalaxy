import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { normalizeCampaignCategory } from "@/lib/campaignCategories";

export async function POST(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);

    const formData = await request.formData();
    
    const name = formData.get("name") as string;
    const parse_mode = formData.get("parse_mode") as string;
    const message_text = formData.get("message_text") as string;
    const link = formData.get("link") as string;
    const button_text = formData.get("button_text") as string;
    const type = formData.get("type") as string;
    const budget = parseFloat(formData.get("budget") as string);
    const cpm = parseFloat(formData.get("cpm") as string);
    const category = normalizeCampaignCategory(formData.get("category"));
    const continents = formData.get("continents") as string;
    const imageFile = formData.get("image") as File | null;

    // 1. Validation
    if (!name || !message_text || !link || !budget || !cpm) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (message_text.length > 1000) {
      return NextResponse.json({ error: "Message text exceeds 1000 characters" }, { status: 400 });
    }

    // Click-type restriction: No usernames or links in text
    if (type === "clicks") {
      const hasUsername = /@\w+/.test(message_text);
      const hasLink = /(https?:\/\/[^\s]+)|(\w+\.\w+)/.test(message_text);
      if (hasUsername || hasLink) {
        return NextResponse.json({ 
          error: "Click campaigns cannot contain usernames (@) or links in the message text. Use the button for your link." 
        }, { status: 400 });
      }
    }

    // 2. Check Ad Balance
    const [userRows]: any = await pool.query("SELECT ad_balance FROM users WHERE id = ?", [user.id]);
    const adBalance = parseFloat(userRows[0].ad_balance || "0");
    if (adBalance < budget) {
      return NextResponse.json({ error: "Insufficient ad balance. Please deposit funds." }, { status: 400 });
    }

    // 3. Handle Image Upload to External API
    let imageUrl = null;
    if (imageFile) {
      if (imageFile.size > 1024 * 1024) {
        return NextResponse.json({ error: "Image size cannot exceed 1MB" }, { status: 400 });
      }

      const imgApiFormData = new FormData();
      imgApiFormData.append("action", "upload");
      imgApiFormData.append("image", imageFile);

      try {
        const imgRes = await fetch(process.env.IMG_API_ENDPOINT!, {
          method: "POST",
          body: imgApiFormData,
        });
        const imgData = await imgRes.json();
        if (imgData.success) {
          imageUrl = imgData.data.url;
        } else {
          console.error("Image Upload Error:", imgData.message);
        }
      } catch (err) {
        console.error("Image API Connection Error:", err);
      }
    }

    // 4. Create Campaign (Transaction)
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Deduct from balance
      await conn.query(
        "UPDATE users SET ad_balance = ad_balance - ? WHERE id = ?",
        [budget, user.id]
      );

      // Insert campaign
      const [result]: any = await conn.query(
        `INSERT INTO campaigns (user_id, name, parse_mode, message_text, image_url, link, button_text, type, budget, cpm, category, continents, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [user.id, name, parse_mode, message_text, imageUrl, link, button_text, type, budget, cpm, category, continents]
      );

      // Create transaction record
      await conn.query(
        "INSERT INTO advertiser_transactions (user_id, amount, type, description) VALUES (?, ?, 'debit', ?)",
        [user.id, budget, `Campaign Creation: ${name}`]
      );

      await conn.commit();
      return NextResponse.json({ success: true, id: result.insertId });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

  } catch (error: any) {
    console.error("Create Campaign Error:", error);
    return NextResponse.json({ error: error.message || "Failed to create campaign" }, { status: getAuthErrorStatus(error) });
  }
}

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);

    const [rows]: any = await pool.query(
      "SELECT * FROM campaigns WHERE user_id = ? ORDER BY created_at DESC",
      [user.id]
    );

    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("Fetch Campaigns Error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch campaigns" }, { status: getAuthErrorStatus(error) });
  }
}
