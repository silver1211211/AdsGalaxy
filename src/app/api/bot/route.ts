import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ error: "This legacy endpoint is disabled" }, { status: 410 });
}
