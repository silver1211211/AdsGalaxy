import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { sendTelegramMessage } from "@/lib/telegram";
import { markCampaignBudgetExhausted } from "@/lib/campaignLifecycle";
import { getAdvertiserTrustMultipliers, normalizeAdvertiserTrustLevel, qualityMultiplier } from "@/lib/advertiserTrust";
import {
  calculateAdvertiserPerformanceScore,
  calculateCampaignPriorityScore,
  getDeliveryOptimizationSettings,
  rankInventoryForDelivery
} from "@/lib/inventoryOptimization";
import {
  autoPauseBot,
  checkBotHealth,
  classifyBotTokenFailure,
  markBotUserDeliverySuccess,
  markBotUserInactive,
  recordBotBroadcastSuccess,
  sendWithRetries,
} from "@/lib/botLifecycle";
import { createSystemLog, upsertBroadcastHourlyLog } from "@/lib/systemLogs";
import { requireAdServingAllowed, upsertAdminAlert } from "@/lib/productionSafety";
import { processBoundedQueue } from "@/lib/concurrency";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";
import { isBotEncryptionError, loadBotToken } from "@/lib/botIntegration";
import { campaignExcludesIdentifier, loadCampaignExclusions } from "@/lib/campaignInventoryExclusions";
import { botUserBroadcastEligibleCondition } from "@/lib/botAudience";
import { composeCampaignCreativeText } from "@/lib/campaignCreative";
import { campaignCategoryMatches } from "@/lib/campaignCategories";

export const dynamic = 'force-dynamic';

function getClockHourPeriod(date = new Date()) {
  const start = new Date(date);
  start.setMinutes(0, 0, 0);
  const end = new Date(start);
  end.setMinutes(59, 59, 999);
  const format = (value: Date) => {
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  };
  return {
    periodStart: format(start),
    periodEnd: format(end),
  };
}

function normalizeFailureReason(value?: string) {
  const text = String(value || "").toLowerCase();
  if (text.includes("blocked")) return "user_blocked_bot";
  if (text.includes("user not found")) return "user_not_found";
  if (text.includes("chat not found")) return "chat_not_found";
  if (text.includes("forbidden") || text.includes("initiate conversation")) return "forbidden";
  if (text.includes("token") || text.includes("unauthorized")) return "bot_token_invalid";
  if (text.includes("timeout")) return "telegram_timeout";
  if (text.includes("paused")) return "bot_paused";
  if (text.includes("error")) return "system_error";
  return "unknown_error";
}

async function reserveBroadcastDelivery(input: { campaign: any; bot: any; user: any; cost: number }) {
  if (!Number.isFinite(input.cost) || input.cost <= 0) {
    return { ok: false as const, reason: "invalid_campaign_cost" };
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [campaignRows]: any = await conn.query(
      "SELECT budget, status, daily_budget_limit FROM campaigns WHERE id = ? FOR UPDATE",
      [input.campaign.id]
    );
    const lockedCampaign = campaignRows[0];
    if (!lockedCampaign || lockedCampaign.status !== "active") {
      await conn.rollback();
      return { ok: false as const, reason: "campaign_budget_exhausted" };
    }
    if (Number(lockedCampaign.budget || 0) + 1e-10 < input.cost) {
      await conn.query(
        "UPDATE campaigns SET status = 'paused', pause_reason = 'insufficient_budget_for_delivery', paused_at = NOW() WHERE id = ? AND status = 'active'",
        [input.campaign.id]
      );
      await conn.commit();
      return { ok: false as const, reason: "campaign_budget_exhausted" };
    }

    if (Number(lockedCampaign.daily_budget_limit || 0) > 0) {
      const [[dailySpendRow]]: any = await conn.query(
        "SELECT COALESCE(SUM(cost), 0) as spend FROM broadcast_deliveries WHERE campaign_id = ? AND created_at >= CURDATE() AND status IN ('pending', 'sent')",
        [input.campaign.id]
      );
      if (Number(dailySpendRow?.spend || 0) + input.cost > Number(lockedCampaign.daily_budget_limit)) {
        await conn.rollback();
        return { ok: false as const, reason: "daily_budget_limit" };
      }
    }

    const [budgetResult]: any = await conn.query(
      "UPDATE campaigns SET budget = budget - ? WHERE id = ? AND budget >= ? AND status = 'active'",
      [input.cost, input.campaign.id, input.cost]
    );
    if (budgetResult.affectedRows !== 1) {
      await conn.rollback();
      return { ok: false as const, reason: "campaign_budget_race" };
    }

    const [deliveryResult]: any = await conn.query(
      `INSERT INTO broadcast_deliveries
        (campaign_id, bot_id, user_id, chat_id, cost, publisher_reward, status, retry_count)
       VALUES (?, ?, ?, ?, ?, 0, 'pending', 0)`,
      [input.campaign.id, input.bot.id, input.user.id, input.user.chat_id, input.cost]
    );
    const [[updatedCampaign]]: any = await conn.query("SELECT budget FROM campaigns WHERE id = ?", [input.campaign.id]);
    await conn.commit();
    return {
      ok: true as const,
      deliveryId: Number(deliveryResult.insertId),
      remainingBudget: Number(updatedCampaign?.budget || 0),
    };
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    throw error;
  } finally {
    conn.release();
  }
}

async function finalizeBroadcastDelivery(input: {
  deliveryId: number;
  campaign: any;
  bot: any;
  user: any;
  reward: number;
  attempts: number;
}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[delivery]]: any = await conn.query(
      "SELECT status FROM broadcast_deliveries WHERE id = ? FOR UPDATE",
      [input.deliveryId]
    );
    if (!delivery) throw new Error("broadcast_reservation_missing");
    if (delivery.status === "sent") {
      await conn.commit();
      return { idempotent: true };
    }
    if (delivery.status !== "pending") throw new Error("broadcast_reservation_not_pending");

    const [deliveryUpdate]: any = await conn.query(
      `UPDATE broadcast_deliveries
       SET publisher_reward = ?, status = 'sent', retry_count = ?, last_success_at = NOW(),
           failure_reason = NULL, telegram_error = NULL
       WHERE id = ? AND status = 'pending'`,
      [input.reward, input.attempts, input.deliveryId]
    );
    if (deliveryUpdate.affectedRows !== 1) throw new Error("broadcast_finalize_race");
    await conn.query("UPDATE bot_users SET last_broadcast_at = NOW() WHERE id = ?", [input.user.id]);
    await markBotUserDeliverySuccess(input.user.id, conn);
    await recordBotBroadcastSuccess(input.bot.id, conn);
    await conn.commit();
    return { idempotent: false };
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    throw error;
  } finally {
    conn.release();
  }
}

async function refundBroadcastReservation(input: {
  deliveryId: number;
  campaignId: number;
  failureReason: string;
  telegramError: string;
  attempts: number;
}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[delivery]]: any = await conn.query(
      "SELECT status, cost FROM broadcast_deliveries WHERE id = ? FOR UPDATE",
      [input.deliveryId]
    );
    if (!delivery || delivery.status !== "pending") {
      await conn.commit();
      return { refunded: false, idempotent: true };
    }
    const reservedCost = Number(delivery.cost || 0);
    const [refundResult]: any = await conn.query("UPDATE campaigns SET budget = budget + ? WHERE id = ?", [reservedCost, input.campaignId]);
    if (refundResult.affectedRows !== 1) throw new Error("broadcast_refund_campaign_missing");
    const [deliveryUpdate]: any = await conn.query(
      `UPDATE broadcast_deliveries
       SET cost = 0, publisher_reward = 0, status = 'failed', failure_reason = ?, telegram_error = ?,
           retry_count = ?, last_failure_at = NOW()
       WHERE id = ? AND status = 'pending'`,
      [input.failureReason, input.telegramError.slice(0, 500), input.attempts, input.deliveryId]
    );
    if (deliveryUpdate.affectedRows !== 1) throw new Error("broadcast_refund_race");
    await conn.commit();
    return { refunded: true, idempotent: false };
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    throw error;
  } finally {
    conn.release();
  }
}

export async function GET(req: NextRequest) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  const lock = await acquireCronLock("process-broadcast", 900);
  if (!lock) {
    return NextResponse.json({ success: false, message: "Broadcast cron is already running" }, { status: 409 });
  }

  try {
    const blocked = await requireAdServingAllowed();
    if (blocked) return blocked;

    const isDev = process.env.MODE === "DEV";
    const now = Date.now();
    const intervalMinutes = parseInt(process.env.CRON_BROADCAST_INTERVAL || "1"); // Default to 1 min if not set
    const intervalMs = intervalMinutes * 60 * 1000;

    const [throttleResult]: any = await pool.query(
      `UPDATE settings
       SET value = ?
       WHERE \`key\` = 'last_broadcast_cron_run'
         AND (CAST(value AS UNSIGNED) <= ? OR ? = 1)`,
      [now.toString(), String(now - intervalMs), isDev ? 1 : 0]
    );

    if (throttleResult.affectedRows !== 1) {
      return NextResponse.json({ success: false, message: "Too early" }, { status: 429 });
    }

    // Get reward percentage
    const [rewardSetting]: any = await pool.query("SELECT value FROM settings WHERE \`key\` = 'broadcast_ad_reward_percentage'");
    const rewardPercentage = parseFloat(rewardSetting[0]?.value || "50") / 100;

    // 1. Find active broadcast campaigns with budget
    const trustMultipliers = await getAdvertiserTrustMultipliers();
    const deliverySettings = await getDeliveryOptimizationSettings();
    const hourlyLogPeriod = getClockHourPeriod();
    const failureReasons: Record<string, number> = {};
    let pausedBotsSkipped = 0;
    let failedBots = 0;
    const encryptionFailedBotIds = new Set<number>();
    const incrementFailure = (reason: string) => {
      failureReasons[reason] = (failureReasons[reason] || 0) + 1;
    };

    const [campaignRows]: any = await pool.query(`
      SELECT c.*, COALESCE(u.advertiser_trust_level, 'new') as advertiser_trust_level
      FROM campaigns c
      JOIN users u ON c.user_id = u.id
      WHERE c.type = 'broadcast' AND c.status = 'active' AND c.budget > 0
        AND COALESCE(u.advertiser_trust_level, 'new') != 'restricted'
        AND (c.start_at IS NULL OR c.start_at <= NOW())
        AND (c.end_at IS NULL OR c.end_at >= NOW())
        AND (
          c.daily_budget_limit IS NULL
          OR c.daily_budget_limit <= 0
          OR COALESCE((
            SELECT SUM(bd.cost)
            FROM broadcast_deliveries bd
            WHERE bd.campaign_id = c.id
              AND bd.created_at >= CURDATE()
          ), 0) < c.daily_budget_limit
        )
      ORDER BY c.cpm DESC
    `);
    const campaigns = campaignRows.map((campaign: any) => {
      const trustMultiplier = trustMultipliers[normalizeAdvertiserTrustLevel(campaign.advertiser_trust_level)] || 1;
      const advertiserPerformance = calculateAdvertiserPerformanceScore({
        trustLevel: campaign.advertiser_trust_level,
        campaignQuality: campaign.quality_score,
        spend: campaign.budget,
        approvedCampaigns: 1,
      });
      return {
        ...campaign,
        advertiser_performance_score: advertiserPerformance,
        campaign_priority_score: calculateCampaignPriorityScore({
          advertiserTrustMultiplier: trustMultiplier,
          campaignQuality: campaign.quality_score,
          cpmBid: campaign.cpm,
          historicalPerformance: 50,
          advertiserPerformance,
        }),
      };
    }).sort((a: any, b: any) => {
      const aTrust = trustMultipliers[normalizeAdvertiserTrustLevel(a.advertiser_trust_level)] || 1;
      const bTrust = trustMultipliers[normalizeAdvertiserTrustLevel(b.advertiser_trust_level)] || 1;
      const aScore = (Number(a.cpm || 0) || 0) * aTrust * qualityMultiplier(a.quality_score) * (Number(a.campaign_priority_score || 50) / 50);
      const bScore = (Number(b.cpm || 0) || 0) * bTrust * qualityMultiplier(b.quality_score) * (Number(b.campaign_priority_score || 50) / 50);
      return bScore - aScore;
    });

    let totalDispatched = 0;
    const limit = 20;
    const dispatches = [];
    const botExclusions = await loadCampaignExclusions(pool, "campaign", campaigns.map((campaign: { id: number | string }) => Number(campaign.id)), "bot");

    for (const campaign of campaigns) {
      if (totalDispatched >= limit) break;

      // Find suitable bots
      const [bots]: any = await pool.query(`
        SELECT * FROM bots
        WHERE status = 'active' AND is_deleted = FALSE
        AND COALESCE(health_status, 'active') = 'active'
        AND user_id != ?
      `, [campaign.user_id]);

      const healthyBots = [];
      for (const bot of bots) {
        if (campaignExcludesIdentifier(botExclusions, Number(campaign.id), bot.bot_username)) continue;
        if (encryptionFailedBotIds.has(Number(bot.id))) continue;
        try {
          bot.bot_token = await loadBotToken(pool, bot);
        } catch (error: unknown) {
          if (!isBotEncryptionError(error)) throw error;
          encryptionFailedBotIds.add(Number(bot.id));
          pausedBotsSkipped++;
          failedBots++;
          incrementFailure(error.code);
          console.error("Broadcast bot credential decryption skipped", { bot_id: bot.id, code: error.code });
          await createSystemLog({
            logType: "system_error",
            status: "failed",
            title: "Bot credential decryption failed",
            summary: "Bot was skipped because its encrypted token could not be decrypted. The bot was not paused.",
            failedCount: 1,
            skippedCount: 1,
            failureReasons: { [error.code]: 1 },
            affectedEntities: [{ bot_id: bot.id }],
            metadata: { route: "/api/cron/process-broadcast", bot_id: bot.id, code: error.code },
          });
          continue;
        }
        const health = await checkBotHealth({ id: bot.id, bot_token: bot.bot_token });
        if (health.ok) {
          healthyBots.push(bot);
        } else {
          pausedBotsSkipped++;
          failedBots++;
          incrementFailure(normalizeFailureReason(health.reason || health.status));
        }
      }

      const suitableBots = rankInventoryForDelivery(healthyBots.filter((bot: any) => {
        // Category match
        const botCats = bot.categories ? (typeof bot.categories === 'string' ? JSON.parse(bot.categories) : bot.categories) : [];
        if (!campaignCategoryMatches(campaign.category, botCats)) return false;

        // Continent match
        const campConts = campaign.continents ? (typeof campaign.continents === 'string' ? JSON.parse(campaign.continents) : campaign.continents) : [];
        const botConts = bot.continents ? (typeof bot.continents === 'string' ? JSON.parse(bot.continents) : bot.continents) : [];
        if (campConts.length > 0) {
          const hasMatch = campConts.some((c: string) => botConts.includes(c) || botConts.includes("Global"));
          if (!hasMatch) return false;
        }
        return true;
      }), deliverySettings, Number(campaign.campaign_priority_score || 50)) as any[];

      for (const bot of suitableBots) {
        if (totalDispatched >= limit) break;

        // Find users for this bot that are eligible
        // posts_per_day logic:
        // 1: last_broadcast_at < 24h ago
        // 2: last_broadcast_at < 6h ago AND count in 24h < 2
        // Generalizing: last_broadcast_at < (24/posts_per_day) hours ago AND count in 24h < posts_per_day
        
        const hoursInterval = 24 / bot.posts_per_day;
        
        const [users]: any = await pool.query(`
          SELECT bu.* 
          FROM bot_users bu
          JOIN bots delivery_bot ON delivery_bot.id = bu.bot_id
          WHERE bu.bot_id = ?
          AND ${botUserBroadcastEligibleCondition("bu", "delivery_bot")}
          AND (bu.last_broadcast_at IS NULL OR bu.last_broadcast_at < NOW() - INTERVAL ? HOUR)
          AND (
            SELECT COUNT(*) FROM broadcast_deliveries bd 
            WHERE bd.user_id = bu.id AND bd.created_at > NOW() - INTERVAL 1 DAY
          ) < ?
          AND (
            ? IS NULL
            OR (
              SELECT COUNT(*) FROM broadcast_deliveries bd
              WHERE bd.campaign_id = ?
                AND bd.user_id = bu.id
                AND bd.created_at >= CURDATE()
            ) < ?
          )
          ORDER BY CASE WHEN bu.status='active' THEN 0 ELSE 1 END, bu.id
          LIMIT ?
        `, [
          bot.id,
          hoursInterval,
          bot.posts_per_day,
          campaign.frequency_cap_per_user || null,
          campaign.id,
          campaign.frequency_cap_per_user || null,
          limit - totalDispatched
        ]);

        for (const user of users) {
          dispatches.push({ campaign, bot, user });
          totalDispatched++;
        }
      }
    }

    if (dispatches.length === 0) {
      await upsertBroadcastHourlyLog({
        ...hourlyLogPeriod,
        summary: "Broadcast cron ran with no eligible users to send.",
        attemptedCount: 0,
        successCount: 0,
        failedCount: 0,
        skippedCount: 0,
        inactiveUsersCount: 0,
        pausedBotsCount: pausedBotsSkipped,
        failedBotsCount: failedBots,
        failureReasons,
        metadata: {
          eligible_campaigns_count: campaigns.length,
          selected_dispatches_count: 0,
        },
      });
      return NextResponse.json({ success: true, processed: 0 });
    }

    // Execute dispatches "together"
    const requestedWorkerCount = Math.max(1, parseInt(process.env.CRON_BROADCAST_WORKERS || "3", 10) || 3);
    const maxWorkerCount = Math.max(1, parseInt(process.env.CRON_BROADCAST_WORKER_MAX || "5", 10) || 5);
    const workerCount = Math.min(requestedWorkerCount, maxWorkerCount);
    const results = await processBoundedQueue(dispatches, workerCount, async ({ campaign, bot, user }) => {
      try {
        const parseModeMap: any = { 'html': 'HTML', 'markdown': 'MarkdownV2', 'none': undefined };
        const parseMode = parseModeMap[campaign.parse_mode] || 'HTML';
        
        const replyMarkup = {
          inline_keyboard: [[
            { text: campaign.button_text, url: campaign.link }
          ]]
        };

        const cost = parseFloat(campaign.cpm) / 1000;
        const reward = cost * rewardPercentage;
        const reservation = await reserveBroadcastDelivery({ campaign, bot, user, cost });
        if (!reservation.ok) {
          return {
            status: 'skipped', user: user.id, campaign_id: campaign.id, campaign_name: campaign.name,
            error: reservation.reason === "daily_budget_limit" ? "Daily budget limit reached" : "Campaign budget exhausted",
            failure_reason: reservation.reason,
          };
        }

        let sendResult;
        try {
          sendResult = await sendWithRetries(() => sendTelegramMessage(user.chat_id, composeCampaignCreativeText(campaign.campaign_title, campaign.message_text), {
            photo: campaign.image_url,
            parse_mode: parseMode,
            reply_markup: replyMarkup,
            token: bot.bot_token
          }));
        } catch (sendError) {
          const message = sendError instanceof Error ? sendError.message : "Telegram send failed";
          await refundBroadcastReservation({
            deliveryId: reservation.deliveryId, campaignId: campaign.id,
            failureReason: normalizeFailureReason(message), telegramError: message, attempts: 1,
          });
          throw sendError;
        }
        const res = sendResult.result;

        if (sendResult.ok && res && res.ok) {
          await finalizeBroadcastDelivery({
            deliveryId: reservation.deliveryId, campaign, bot, user, reward, attempts: sendResult.attempts || 1,
          });
          const remainingBudget = reservation.remainingBudget;
          const budgetExhausted = remainingBudget <= 0;
          if (budgetExhausted) {
            await markCampaignBudgetExhausted(campaign.id);
          }

          if (budgetExhausted) {
              try {
                const [advertiser]: any = await pool.query("SELECT chat_id FROM users WHERE id = ?", [campaign.user_id]);
                if (advertiser[0]?.chat_id) {
                  await sendTelegramMessage(advertiser[0].chat_id, `Campaign Budget Exhausted\n\nYour broadcast campaign "${campaign.name || 'Untitled'}" has exhausted its budget.\n\nPlease top up your budget to resume the broadcast.`, {
                    parse_mode: 'Markdown'
                  });
                }
              } catch (notifyErr) {
                console.error("Failed to notify advertiser:", notifyErr);
              }
          }

          return {
            status: 'success', user: user.id, campaign_id: campaign.id, campaign_name: campaign.name,
            cost, remaining_budget: remainingBudget,
          };
        }

        const failureMessage = String(res?.description || sendResult.failure?.reason || "Unknown error");
        await refundBroadcastReservation({
          deliveryId: reservation.deliveryId, campaignId: campaign.id,
          failureReason: normalizeFailureReason(failureMessage), telegramError: failureMessage,
          attempts: sendResult.attempts || 1,
        });
        if (!res?.ok) {
          let botFailure = null;
          if (sendResult.failure) {
            botFailure = classifyBotTokenFailure(res?.description);
            if (botFailure) {
              await autoPauseBot(bot.id, botFailure);
            } else {
              await markBotUserInactive(user.id, sendResult.failure);
            }
          }
          return { 
            status: 'failed', 
            user: user.id, 
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            error: res?.description || 'Unknown error',
            inactive_detected: !botFailure,
            bot_failed: Boolean(botFailure),
            failure_reason: normalizeFailureReason(res?.description || sendResult.failure?.reason)
          };
        }
        return { status: 'failed', user: user.id, campaign_id: campaign.id, campaign_name: campaign.name, error: 'Unknown error', failure_reason: "unknown_error" };
      } catch (err: any) {
        return { 
          status: 'error', 
          user: user.id, 
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          error: err.message,
          failure_reason: normalizeFailureReason(err.message)
        };
      }
    });

    for (const result of results) {
      if (result.status !== "success") {
        incrementFailure(result.failure_reason || normalizeFailureReason(result.error));
      }
    }

    const successCount = results.filter((result: any) => result.status === "success").length;
    const failedCount = results.filter((result: any) => result.status === "failed" || result.status === "error").length;
    const skippedCount = results.filter((result: any) => result.status === "skipped").length;
    const inactiveUsers = results.filter((result: any) => result.inactive_detected).length;
    const failedBotSends = results.filter((result: any) => result.bot_failed).length;

    await upsertBroadcastHourlyLog({
      ...hourlyLogPeriod,
      summary: `Broadcast hour ${hourlyLogPeriod.periodStart} attempted ${dispatches.length} sends.`,
      attemptedCount: dispatches.length,
      successCount,
      failedCount,
      skippedCount,
      inactiveUsersCount: inactiveUsers,
      pausedBotsCount: pausedBotsSkipped,
      failedBotsCount: failedBots + failedBotSends,
      failureReasons,
      metadata: {
        eligible_campaigns_count: campaigns.length,
        selected_dispatches_count: dispatches.length,
      },
    });

    return NextResponse.json({
      success: true,
      processed: results.length,
      details: results
    });

  } catch (error: any) {
    console.error("Broadcast Cron Error:", error);
    await upsertAdminAlert({
      alertType: "broadcast_failed",
      severity: "high",
      title: "Bot broadcasts failed",
      details: error?.message || "Broadcast cron failed.",
      metadata: { route: "/api/cron/process-broadcast" },
    });
    await createSystemLog({
      logType: "system_error",
      status: "failed",
      title: "Bot broadcast cron failed",
      summary: error?.message || "Broadcast cron failed.",
      failedCount: 1,
      failureReasons: { system_error: 1 },
      metadata: { route: "/api/cron/process-broadcast" },
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
