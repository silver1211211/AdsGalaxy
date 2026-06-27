import { NextResponse } from "next/server";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { forecastFromInput, getAdvertiserIntelligence, resolveIntelligenceRange } from "@/lib/advertiserIntelligence";

function flatRows(data: any) {
  return [
    ["Metric", "Value"],
    ["Impressions", data.summary.impressions],
    ["Clicks", data.summary.clicks],
    ["CTR", data.summary.ctr],
    ["Spend", data.summary.spend],
    ["Conversions", data.summary.conversions],
    ["Conversion Rate", data.summary.conversion_rate],
    ["CPA", data.summary.cpa],
    ["Estimated ROI", data.summary.estimated_roi],
    ["Health Score", data.summary.health_score],
    ["Health Tier", data.summary.health_tier],
    [],
    ["Campaign", "Type", "Impressions", "Clicks", "CTR", "Spend", "Conversions", "CPA", "ROI", "Health"],
    ...data.campaigns.map((campaign: any) => [
      campaign.name,
      campaign.type,
      campaign.impressions,
      campaign.clicks,
      campaign.ctr,
      campaign.spend,
      campaign.conversions,
      campaign.cpa,
      campaign.roi,
      campaign.health_score,
    ]),
  ];
}

function csv(data: any, delimiter = ",") {
  return flatRows(data).map((row: unknown[]) => row.map((value: unknown) => {
    const text = String(value ?? "");
    return `"${text.replace(/"/g, '""')}"`;
  }).join(delimiter)).join("\n");
}

function pdf(data: any) {
  const lines = [
    "AdsGalaxy Campaign Intelligence",
    `Range: ${data.range.label}`,
    `Impressions: ${data.summary.impressions}`,
    `Clicks: ${data.summary.clicks}`,
    `Spend: $${Number(data.summary.spend || 0).toFixed(2)}`,
    `Conversions: ${data.summary.conversions}`,
    `Health: ${data.summary.health_score} (${data.summary.health_tier})`,
    "Recommendations:",
    ...data.recommendations.slice(0, 8).map((item: any) => `- ${item.title}`),
  ];
  const content = `BT /F1 12 Tf 40 780 Td ${lines.map((line) => `(${String(line).replace(/[()\\]/g, "\\$&")}) Tj 0 -18 Td`).join(" ")} ET`;
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(body.length);
    body += `${object}\n`;
  }
  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer << /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return body;
}

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const { searchParams } = new URL(request.url);
    const range = resolveIntelligenceRange(searchParams);
    const data = await getAdvertiserIntelligence(user.id, range);
    const format = searchParams.get("export");

    if (format === "csv") {
      return new Response(csv(data), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": "attachment; filename=campaign-intelligence.csv",
        },
      });
    }
    if (format === "excel") {
      return new Response(csv(data, "\t"), {
        headers: {
          "Content-Type": "application/vnd.ms-excel; charset=utf-8",
          "Content-Disposition": "attachment; filename=campaign-intelligence.xls",
        },
      });
    }
    if (format === "pdf") {
      return new Response(pdf(data), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": "attachment; filename=campaign-intelligence.pdf",
        },
      });
    }

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load campaign intelligence" }, { status: getAuthErrorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const body = await request.json();
    const { searchParams } = new URL(request.url);
    const range = resolveIntelligenceRange(searchParams);
    const data = await getAdvertiserIntelligence(user.id, range);
    const forecast = forecastFromInput({
      budget: Number(body.budget || 0),
      cpm: Number(body.cpm || 0),
      historicalCtr: Number(data.summary.ctr || 0.01),
      historicalConversionRate: Number(data.summary.conversion_rate || 0.03),
    });

    return NextResponse.json({ forecast });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to create forecast" }, { status: getAuthErrorStatus(error) });
  }
}
