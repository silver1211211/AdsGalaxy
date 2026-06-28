import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { normalizeAdvertiserTargeting, targetingDbParams } from "@/lib/advertiserTargeting";
import { getMiniAppPublisherCpmSettings, validateAdvertiserCpmBid } from "@/lib/miniappPublisherCpmEngine";
import { calculateCampaignQualityScore } from "@/lib/advertiserTrust";
import { publicQualityRating } from "@/lib/trafficQuality";
import { publicInventoryQuality } from "@/lib/inventoryOptimization";
import {
  displayMiniAppCategories,
  normalizeMiniAppCategories,
  requiredMiniAppCategoryCpm,
} from "@/lib/miniappCreativeCategories";
import { validatePostbackUrl } from "@/lib/conversionTracking";
import { normalizeMarketplaceType, publicSelectionMetadata, recordMarketplaceEvent, validateDirectPlacementTargets } from "@/lib/publisherMarketplace";
import { evaluateCampaignAutomation } from "@/lib/approvalAutomation";

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function cleanHexColor(value: unknown) {
  const color = cleanText(value);
  if (!color) return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new Error("Creative colors must use hex format, for example #4f46e5.");
  }
  return color;
}

function cleanCtaText(value: unknown) {
  const text = cleanText(value) || "Learn More";
  if (text.length > 40) throw new Error("CTA text must be 40 characters or fewer.");
  return text;
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

function readPngDimensions(buffer: Buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), type: "static" as const };
}

function readGifDimensions(buffer: Buffer) {
  const signature = buffer.toString("ascii", 0, 6);
  if (buffer.length < 10 || (signature !== "GIF87a" && signature !== "GIF89a")) return null;
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8), type: "gif" as const };
}

function readJpegDimensions(buffer: Buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5), type: "static" as const };
    }
    offset += 2 + length;
  }
  return null;
}

function readImageDimensions(buffer: Buffer) {
  return readPngDimensions(buffer) || readGifDimensions(buffer) || readJpegDimensions(buffer);
}

function landingReviewFlags(landingUrl: string) {
  const flags: string[] = [];
  try {
    const url = new URL(landingUrl);
    const hostname = url.hostname.toLowerCase();
    const compactHost = hostname.replace(/^www\./, "");
    const shortenedHosts = new Set(["bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "cutt.ly", "rebrand.ly", "shorturl.at"]);
    if (shortenedHosts.has(compactHost)) flags.push("shortened_url");
    if (url.protocol !== "https:") flags.push("non_https_landing");
    if (/xn--|[^a-z0-9.-]/i.test(hostname)) flags.push("suspicious_domain");
    if (!compactHost.includes(".") || compactHost.split(".").pop()!.length < 2) flags.push("unknown_domain");
  } catch {
    flags.push("invalid_landing_url");
  }
  return flags;
}

async function validateCreativeImageUrl(imageUrl: string) {
  const response = await fetch(imageUrl, { redirect: "follow" });
  if (!response.ok) throw new Error("Image URL could not be loaded for validation.");

  const contentLength = Number(response.headers.get("content-length") || 0);
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const maxPossibleSize = contentType.includes("gif") || imageUrl.toLowerCase().split("?")[0].endsWith(".gif")
    ? 2 * 1024 * 1024
    : 1 * 1024 * 1024;
  if (contentLength > maxPossibleSize) {
    throw new Error(contentType.includes("gif") ? "GIF must be square (1:1). Maximum file size: 2 MB. Supported dimensions: 240px-600px." : "Image must be square (1:1). Maximum file size: 1 MB. Supported dimensions: 240px-1024px.");
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const dimensions = readImageDimensions(buffer);
  if (!dimensions) throw new Error("Image must be a supported JPG, PNG, or GIF file.");

  const isGif = dimensions.type === "gif" || contentType.includes("gif");
  const message = isGif
    ? "GIF must be square (1:1). Maximum file size: 2 MB. Supported dimensions: 240px-600px."
    : "Image must be square (1:1). Maximum file size: 1 MB. Supported dimensions: 240px-1024px.";
  const maxSize = isGif ? 2 * 1024 * 1024 : 1 * 1024 * 1024;
  const maxDimension = isGif ? 600 : 1024;

  if (buffer.length > maxSize) throw new Error(message);
  if (dimensions.width !== dimensions.height) throw new Error(message);
  if (dimensions.width < 240 || dimensions.height < 240 || dimensions.width > maxDimension || dimensions.height > maxDimension) {
    throw new Error(message);
  }

  return {
    type: isGif ? "gif" : "static",
    width: dimensions.width,
    height: dimensions.height,
    bytes: buffer.length,
    max_bytes: maxSize,
  };
}

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const [rows] = await pool.query(
      `SELECT
        c.id,
        c.campaign_name,
        c.title,
        c.description,
        c.cta_text,
        c.title_color,
        c.body_color,
        c.categories,
        c.image_url,
        c.landing_url,
        c.postback_url,
        c.budget,
        c.remaining_budget,
        c.advertiser_cpm_bid,
        c.admin_cpm,
        c.cpm_mode,
        c.fixed_publisher_cpm,
        c.campaign_budget_mode,
        c.daily_budget_mode,
        c.target_countries,
        c.countries,
        c.languages,
        c.vpn_policy,
        c.device_policy,
        c.os_policy,
        c.start_at,
        c.end_at,
        c.daily_budget_limit,
        c.frequency_cap_per_user,
        c.status,
        c.created_at,
        c.updated_at,
        COALESCE((SELECT COUNT(*) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id), 0) as impressions,
        COALESCE((SELECT COUNT(*) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id AND i.created_at >= CURDATE()), 0) as today_impressions,
        COALESCE((SELECT COUNT(*) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id AND i.created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND i.created_at < CURDATE()), 0) as yesterday_impressions,
        COALESCE((SELECT SUM(i.cost) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id), 0) as spend,
        COALESCE((SELECT SUM(i.publisher_revenue) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id), 0) as publisher_revenue,
        COALESCE((SELECT COUNT(*) FROM ad_click_attribution ac WHERE ac.campaign_type = 'miniapp' AND ac.campaign_id = c.id), 0) as clicks,
        COALESCE((SELECT COUNT(*) FROM ad_conversions conv WHERE conv.campaign_type = 'miniapp' AND conv.campaign_id = c.id), 0) as conversions,
        COALESCE((SELECT SUM(conv.conversion_value) FROM ad_conversions conv WHERE conv.campaign_type = 'miniapp' AND conv.campaign_id = c.id), 0) as conversion_value,
        COALESCE((SELECT AVG(m.traffic_quality_score) FROM miniapp_internal_ad_impressions i JOIN miniapps m ON i.miniapp_id = m.id WHERE i.campaign_id = c.id), 60) as avg_traffic_quality,
        COALESCE((SELECT AVG(m.inventory_score) FROM miniapp_internal_ad_impressions i JOIN miniapps m ON i.miniapp_id = m.id WHERE i.campaign_id = c.id), 50) as avg_inventory_quality,
        COALESCE((SELECT SUM(i.cost) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id AND i.created_at >= CURDATE()), 0) as today_spend,
        (SELECT MAX(i.created_at) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id) as last_displayed_at
       FROM miniapp_rewarded_campaigns c
       WHERE c.advertiser_id = ?
       ORDER BY c.created_at DESC`,
      [user.id]
    );
    return NextResponse.json((rows as any[]).map((row) => ({
      ...row,
      traffic_quality_rating: publicQualityRating(row.avg_traffic_quality),
      inventory_quality_rating: publicInventoryQuality(row.avg_inventory_quality),
    })));
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
    const ctaText = cleanCtaText(body.cta_text);
    const titleColor = cleanHexColor(body.title_color);
    const bodyColor = cleanHexColor(body.body_color);
    const categories = normalizeMiniAppCategories(body.categories);
    const landingUrl = cleanText(body.landing_url);
    const postbackUrl = validatePostbackUrl(body.postback_url);
    const imageUrl = cleanText(body.image_url);
    const campaignBudgetMode = cleanText(body.campaign_budget_mode) === "unlimited" ? "unlimited" : "custom";
    const dailyBudgetMode = cleanText(body.daily_budget_mode) === "unlimited" ? "unlimited" : "custom";
    const directPlacementMode = cleanText(body.direct_placement_mode) === "direct" ? "direct" : "network";
    const directInventoryScope = cleanText(body.direct_inventory_scope) || "network";
    const directInventoryType = normalizeMarketplaceType(body.direct_inventory_type || "miniapp");
    const directInventoryIds = Array.isArray(body.direct_inventory_ids) ? body.direct_inventory_ids : [];
    const directSelectionMetadata = publicSelectionMetadata({
      direct_placement_mode: directPlacementMode,
      direct_inventory_scope: directInventoryScope,
      direct_categories: body.direct_categories,
      direct_countries: body.direct_countries,
      direct_languages: body.direct_languages,
    });
    const budget = campaignBudgetMode === "unlimited" ? 0 : toPositiveMoney(body.budget, "Budget");
    const advertiserCpmBid = toPositiveMoney(body.advertiser_cpm_bid ?? body.cpm_bid, "CPM Bid");
    const cpmSettings = await getMiniAppPublisherCpmSettings(conn);
    validateAdvertiserCpmBid(advertiserCpmBid, cpmSettings);
    const categoryCpm = await requiredMiniAppCategoryCpm(categories, conn);
    if (advertiserCpmBid < categoryCpm.required_cpm) {
      return NextResponse.json({
        error: `CPM Bid must be at least $${categoryCpm.required_cpm.toFixed(2)} for the selected categories.`,
        base_min_cpm: categoryCpm.base_min_cpm,
        category_adjustment: categoryCpm.category_adjustment,
        required_cpm: categoryCpm.required_cpm,
      }, { status: 400 });
    }
    const targeting = normalizeAdvertiserTargeting({
      countries: body.countries ?? body.target_countries,
      languages: body.languages,
      vpn_policy: body.vpn_policy,
      device_policy: body.device_policy,
      os_policy: body.os_policy,
      start_at: body.start_at,
      end_at: body.end_at,
      daily_budget_limit: dailyBudgetMode === "unlimited" ? "" : body.daily_budget_limit,
      frequency_cap_per_user: body.frequency_cap_per_user,
    }, campaignBudgetMode === "unlimited" ? Number.MAX_SAFE_INTEGER : budget);
    const targetCountries = normalizeCountries(targeting.countries);

    if (!campaignName || !title || !description || !landingUrl || !imageUrl) {
      return NextResponse.json({ error: "Campaign name, title, description, landing URL, and image URL are required" }, { status: 400 });
    }

    if (!/^https?:\/\//i.test(landingUrl) || !/^https?:\/\//i.test(imageUrl)) {
      return NextResponse.json({ error: "Landing URL and image URL must be valid http(s) URLs" }, { status: 400 });
    }
    const imageMetadata = await validateCreativeImageUrl(imageUrl);
    const landingFlags = landingReviewFlags(landingUrl);
    const directTargets = await validateDirectPlacementTargets({
      mode: directPlacementMode,
      scope: directInventoryScope,
      inventoryType: directInventoryType,
      inventoryIds: directInventoryIds,
      cpm: advertiserCpmBid,
    }, conn);

    await conn.beginTransaction();

    const [automationUserRows]: any = await conn.query(
      "SELECT advertiser_trust_level, telegram_id FROM users WHERE id = ? FOR UPDATE",
      [user.id]
    );

    const quality = await calculateCampaignQualityScore(user.id, {
      name: campaignName,
      title,
      description,
      image_url: imageUrl,
      landing_url: landingUrl,
      budget,
      cpm: advertiserCpmBid,
      cta_text: ctaText,
      categories,
      countries: targeting.countries,
      landing_review_flags: landingFlags,
      image_review_metadata: imageMetadata,
    }, conn);

    if (campaignBudgetMode === "custom") {
      const [userRows]: any = await conn.query("SELECT ad_balance FROM users WHERE id = ? FOR UPDATE", [user.id]);
      const adBalance = Number(userRows[0]?.ad_balance || 0);
      if (adBalance < budget) {
        await conn.rollback();
        return NextResponse.json({ error: "Insufficient ad balance. Please deposit funds." }, { status: 400 });
      }

      await conn.query("UPDATE users SET ad_balance = ad_balance - ? WHERE id = ?", [budget, user.id]);
    }

    const [result]: any = await conn.query(
      `INSERT INTO miniapp_rewarded_campaigns
        (
          advertiser_id, campaign_name, title, quality_score, quality_tier,
          quality_metadata, description, cta_text, title_color, body_color, categories, image_url, landing_url, postback_url,
          budget, remaining_budget, advertiser_cpm_bid, admin_cpm, required_cpm, campaign_budget_mode,
          daily_budget_mode, target_countries, countries, languages,
          vpn_policy, device_policy, os_policy, start_at, end_at, daily_budget_limit,
          frequency_cap_per_user, direct_placement_mode, direct_inventory_scope,
          direct_inventory_metadata, status, creative_review_status, landing_review_flags, image_review_metadata
        )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', ?, ?)`,
      [
        user.id,
        campaignName,
        title,
        quality.score,
        quality.tier,
        JSON.stringify(quality.metadata),
        description,
        ctaText,
        titleColor,
        bodyColor,
        JSON.stringify(categories),
        imageUrl,
        landingUrl,
        postbackUrl,
        budget,
        budget,
        advertiserCpmBid,
        advertiserCpmBid,
        categoryCpm.required_cpm,
        campaignBudgetMode,
        dailyBudgetMode,
        targetCountries || null,
        ...targetingDbParams(targeting),
        directPlacementMode,
        directInventoryScope,
        JSON.stringify({
          ...directSelectionMetadata,
          inventory_type: directInventoryType,
          required_cpm: directTargets.requiredCpm,
        }),
        JSON.stringify(landingFlags),
        JSON.stringify(imageMetadata),
      ]
    );

    for (const inventoryId of directTargets.ids) {
      await conn.query(
        "INSERT INTO campaign_direct_inventory_targets (campaign_type, campaign_id, inventory_type, inventory_id) VALUES ('miniapp', ?, ?, ?)",
        [result.insertId, directInventoryType, inventoryId]
      );
      await recordMarketplaceEvent({
        advertiserId: user.id,
        inventoryType: directInventoryType,
        inventoryId,
        eventType: "selection",
        metadata: { campaign_type: "miniapp", campaign_id: result.insertId },
      }, conn);
    }

    await evaluateCampaignAutomation({
      campaignType: "miniapp_rewarded",
      campaignId: result.insertId,
      advertiserId: user.id,
      advertiserTelegramId: automationUserRows[0]?.telegram_id,
      advertiserTrustLevel: automationUserRows[0]?.advertiser_trust_level,
      qualityScore: quality.score,
      qualityTier: quality.tier,
      categories,
      destinationUrl: landingUrl,
      creativeText: description,
    }, conn);

    if (campaignBudgetMode === "custom") {
      await conn.query(
        "INSERT INTO advertiser_transactions (user_id, amount, type, description) VALUES (?, ?, 'debit', ?)",
        [user.id, budget, `Mini App Rewarded Campaign: ${campaignName}`]
      );
    }

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
