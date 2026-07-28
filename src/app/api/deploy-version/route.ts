import { NextResponse } from "next/server";
import { deployVersion } from "@/lib/deploy-version";

// Always reflect the CURRENT deployment — never cached. After a redeploy this
// route is served by the new deployment and returns the new id, so an
// already-open page (holding the old id) detects the change. See
// DeployStaleBanner + lib/deploy-version.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { version: deployVersion() },
    { headers: { "cache-control": "no-store" } },
  );
}
