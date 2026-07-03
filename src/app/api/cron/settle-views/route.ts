import type { NextRequest } from "next/server";
import { GET as runChannelSettlement } from "../channel-settlement/route";

export const dynamic = "force-dynamic";

// Backward-compatible alias. All channel settlement must use the unified lock and ledger.
export async function GET(request: NextRequest) {
  return runChannelSettlement(request);
}
