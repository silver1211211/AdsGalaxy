import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Legacy webhook integration is disabled; publishers must keep their own webhook" },
    { status: 410 }
  );
}
