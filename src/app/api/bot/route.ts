import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    try {
        // 1. Get and log headers (for context)
        const headersList = await headers();
        console.log('--- Incoming Telegram Header ---');
        console.log(`IP: ${headersList.get('x-forwarded-for')}`);

        // 2. Parse the RAW body from the request
        const rawUpdate = await request.json();

        // 3. Log the full JSON update to your terminal
        console.log('--- Raw Telegram Update Body ---');
        console.log(JSON.stringify(rawUpdate, null, 2));
        console.log('--------------------------------');

        // 4. Respond with 200 OK immediately
        // This tells Telegram you received it so it stops retrying
        return NextResponse.json({ ok: true }, { status: 200 });

    } catch (error) {
        console.error('Error parsing Telegram update:', error);
        // Still return 200 so Telegram doesn't spam your server with retries
        return NextResponse.json({ ok: false }, { status: 200 });
    }
}
