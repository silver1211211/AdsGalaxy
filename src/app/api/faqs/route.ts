import { NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET() {
  try {
    const [rows]: any = await pool.query("SELECT * FROM faqs ORDER BY id ASC");
    
    // Group FAQs by type
    const publisherFaqs = rows.filter((faq: any) => faq.type === 'publisher');
    const advertiserFaqs = rows.filter((faq: any) => faq.type === 'advertiser');

    return NextResponse.json({
      publisher: publisherFaqs,
      advertiser: advertiserFaqs
    });
  } catch (error: any) {
    console.error("FAQs API Error:", error);
    return NextResponse.json({ error: "Failed to fetch FAQs" }, { status: 500 });
  }
}
