/* eslint-disable @typescript-eslint/no-explicit-any -- legacy Mini App campaign payloads are not schema-generated */
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { normalizeAdvertiserTargeting, targetingDbParams } from "@/lib/advertiserTargeting";
import { getMiniAppPublisherCpmSettings, validateAdvertiserCpmBid } from "@/lib/miniappPublisherCpmEngine";
import { calculateCampaignQualityScore } from "@/lib/advertiserTrust";
import {
  normalizeMiniAppCategories,
} from "@/lib/miniappCreativeCategories";
import { normalizeMiniAppCampaignCategories, validateMiniAppCampaignText } from "@/lib/miniappCampaignValidation";
import { normalizeMarketplaceType, publicSelectionMetadata, recordMarketplaceEvent, validateDirectPlacementTargets } from "@/lib/publisherMarketplace";
import { evaluateCampaignAutomation } from "@/lib/approvalAutomation";
import { replaceCampaignExclusions } from "@/lib/campaignInventoryExclusions";
import { validateTotalBudget } from "@/lib/campaignBudget";
import { safeQueueAdvertiserOnboarding } from "@/lib/supportMessages";

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

function readWebpDimensions(buffer: Buffer) {
  if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") return null;
  const format = buffer.toString("ascii", 12, 16);
  if (format === "VP8X" && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
      type: "static" as const,
    };
  }
  if (format === "VP8 " && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
      type: "static" as const,
    };
  }
  if (format === "VP8L" && buffer.length >= 25) {
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + ((b3 << 6) | (b2 >> 2) | ((b1 & 0xc0) << 6)),
      type: "static" as const,
    };
  }
  return null;
}

function readImageDimensions(buffer: Buffer) {
  return readPngDimensions(buffer) || readJpegDimensions(buffer) || readWebpDimensions(buffer);
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

async function validateCreativeImageUrl(imageUrl: string, maxSize = 1 * 1024 * 1024) {
  const response = await fetch(imageUrl, { redirect: "follow" });
  if (!response.ok) throw new Error("Image URL could not be loaded for validation.");

  const contentLength = Number(response.headers.get("content-length") || 0);
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const normalizedUrl = imageUrl.toLowerCase().split("?")[0];
  const supportedType =
    contentType.includes("png") ||
    contentType.includes("jpeg") ||
    contentType.includes("jpg") ||
    contentType.includes("webp") ||
    /\.(png|jpe?g|webp)$/.test(normalizedUrl);
  const message = `Image must be PNG, JPG, or WEBP and be ${maxSize <= 500 * 1024 ? "500 KB" : "1 MB"} or smaller.`;
  if (!supportedType) throw new Error(message);
  if (contentLength > maxSize) throw new Error(message);

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const dimensions = readImageDimensions(buffer);
  if (!dimensions) throw new Error(message);
  if (buffer.length > maxSize) throw new Error(message);
  return {
    type: "static",
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
        c.logo_url,
        c.landing_url,
        c.budget,
        c.remaining_budget,
        c.total_spend,
        c.advertiser_cpm_bid,
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
        c.creative_review_notes,
        c.requires_re_moderation,
        c.created_at,
        c.updated_at,
        COALESCE((SELECT COUNT(*) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id), 0) as impressions,
        COALESCE((SELECT COUNT(*) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id AND i.created_at >= CURDATE()), 0) as today_impressions,
        COALESCE((SELECT COUNT(*) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id AND i.created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND i.created_at < CURDATE()), 0) as yesterday_impressions,
        COALESCE((SELECT SUM(i.cost) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id), 0) as spend,
        COALESCE((SELECT COUNT(*) FROM ad_click_attribution ac WHERE ac.campaign_type = 'miniapp' AND ac.campaign_id = c.id), 0) as clicks,
        COALESCE((SELECT COUNT(*) FROM ad_conversions conv WHERE conv.campaign_type = 'miniapp' AND conv.campaign_id = c.id), 0) as conversions,
        COALESCE((SELECT SUM(conv.conversion_value) FROM ad_conversions conv WHERE conv.campaign_type = 'miniapp' AND conv.campaign_id = c.id), 0) as conversion_value,
        COALESCE((SELECT SUM(i.cost) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id AND i.created_at >= CURDATE()), 0) as today_spend,
        CASE WHEN COALESCE(c.remaining_budget, 0) <= 0 THEN TRUE ELSE FALSE END AS budget_exhausted,
        CASE WHEN COALESCE(c.daily_budget_limit, 0) > 0 AND
          COALESCE((SELECT SUM(i.advertiser_debit) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id AND i.created_at >= CURDATE()), 0) >= c.daily_budget_limit
          THEN TRUE ELSE FALSE END AS daily_cap_reached,
        CASE WHEN COALESCE((SELECT COUNT(*) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id), 0) > 0
          THEN COALESCE((SELECT COUNT(*) FROM ad_click_attribution ac WHERE ac.campaign_type = 'miniapp' AND ac.campaign_id = c.id), 0)
            / COALESCE((SELECT COUNT(*) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id), 1) * 100
          ELSE 0 END as ctr,
        CASE WHEN COALESCE((SELECT COUNT(*) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id), 0) > 0
          THEN COALESCE((SELECT SUM(i.cost) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id), 0)
            / COALESCE((SELECT COUNT(*) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id), 1) * 1000
          ELSE 0 END as average_cpm,
        CASE WHEN COALESCE((SELECT COUNT(*) FROM ad_click_attribution ac WHERE ac.campaign_type = 'miniapp' AND ac.campaign_id = c.id), 0) > 0
          THEN COALESCE((SELECT SUM(i.cost) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id), 0)
            / COALESCE((SELECT COUNT(*) FROM ad_click_attribution ac WHERE ac.campaign_type = 'miniapp' AND ac.campaign_id = c.id), 1)
          ELSE 0 END as average_cpc,
        CASE WHEN COALESCE((SELECT COUNT(*) FROM ad_click_attribution ac WHERE ac.campaign_type = 'miniapp' AND ac.campaign_id = c.id), 0) > 0
          THEN COALESCE((SELECT COUNT(*) FROM ad_conversions conv WHERE conv.campaign_type = 'miniapp' AND conv.campaign_id = c.id), 0)
            / COALESCE((SELECT COUNT(*) FROM ad_click_attribution ac WHERE ac.campaign_type = 'miniapp' AND ac.campaign_id = c.id), 1) * 100
          ELSE 0 END as conversion_rate,
        (SELECT MAX(i.created_at) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id) as last_displayed_at
       FROM miniapp_rewarded_campaigns c
       WHERE c.advertiser_id = ?
       ORDER BY c.created_at DESC`,
      [user.id]
    );
    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("Fetch Mini App Rewarded Campaigns Error:", error);
    return NextResponse.json({ error: "Unable to load campaigns right now" }, { status: getAuthErrorStatus(error) });
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
    const categories = normalizeMiniAppCampaignCategories(normalizeMiniAppCategories(body.categories));
    const landingUrl = cleanText(body.landing_url);
    const imageUrl = cleanText(body.image_url);
    const logoUrl = cleanText(body.logo_url);
    const campaignBudgetMode = "custom";
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
    const budget = validateTotalBudget(body.budget);
    const advertiserCpmBid = toPositiveMoney(body.advertiser_cpm_bid ?? body.cpm_bid, "CPM Bid");
    const cpmSettings = await getMiniAppPublisherCpmSettings(conn);
    validateAdvertiserCpmBid(advertiserCpmBid, cpmSettings);
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
    }, budget);
    const targetCountries = normalizeCountries(targeting.countries);

    if (!campaignName || !title || !description || !landingUrl || !imageUrl) {
      return NextResponse.json({ error: "Campaign name, title, description, landing URL, and image URL are required" }, { status: 400 });
    }
    validateMiniAppCampaignText({ campaignName, title, description });

    if (!/^https?:\/\//i.test(landingUrl) || !/^https?:\/\//i.test(imageUrl)) {
      return NextResponse.json({ error: "Landing URL and image URL must be valid http(s) URLs" }, { status: 400 });
    }
    const imageMetadata = await validateCreativeImageUrl(imageUrl);
    if (logoUrl) {
      const logoMetadata = await validateCreativeImageUrl(logoUrl, 500 * 1024);
      if (logoMetadata.width !== logoMetadata.height) throw new Error("Logo must be square");
    }
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

    const [result]: any = await conn.query(
      `INSERT INTO miniapp_rewarded_campaigns
        (
          advertiser_id, campaign_name, title, quality_score, quality_tier,
          quality_metadata, description, cta_text, title_color, body_color, categories, image_url, logo_url, landing_url,
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
        logoUrl || null,
        landingUrl,
        budget,
        budget,
        advertiserCpmBid,
        advertiserCpmBid,
        cpmSettings.min_cpm,
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

    await replaceCampaignExclusions(conn, {
      campaignType: "miniapp",
      campaignId: result.insertId,
      inventoryType: "miniapp",
      identifiers: body.excluded_inventory,
    });

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

    await safeQueueAdvertiserOnboarding(user.id, conn);

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
