import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { checkAdminAuth } from "@/lib/adminAuth";

export async function GET() {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [rows] = await pool.query("SELECT * FROM faqs ORDER BY id DESC");
    return NextResponse.json({ faqs: rows });
  } catch (error) {
    console.error("Admin FAQs GET Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { question, answer, type } = await request.json();
    if (!question || !answer || !type) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const [result]: any = await pool.query(
      "INSERT INTO faqs (question, answer, type) VALUES (?, ?, ?)",
      [question, answer, type]
    );

    return NextResponse.json({ success: true, id: result.insertId });
  } catch (error) {
    console.error("Admin FAQs POST Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id, question, answer, type } = await request.json();
    if (!id || !question || !answer || !type) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    await pool.query(
      "UPDATE faqs SET question = ?, answer = ?, type = ? WHERE id = ?",
      [question, answer, type, id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin FAQs PUT Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    await pool.query("DELETE FROM faqs WHERE id = ?", [id]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin FAQs DELETE Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
