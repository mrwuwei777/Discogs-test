import { NextRequest, NextResponse } from "next/server";
import { getPriceStats } from "@/lib/discogs";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const releaseIds = (searchParams.get("releaseIds") ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));

    if (releaseIds.length === 0) {
      return NextResponse.json({ prices: {} });
    }

    const entries = await Promise.all(
      releaseIds.map(async (id) => {
        try {
          const stats = await getPriceStats(id);
          return [id, stats] as const;
        } catch {
          return [id, null] as const;
        }
      }),
    );

    return NextResponse.json({ prices: Object.fromEntries(entries) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
