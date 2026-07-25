import { NextRequest, NextResponse } from "next/server";
import { getCollectionInstanceCount, getIdentity } from "@/lib/discogs";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const releaseIds = (searchParams.get("releaseIds") ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));

    if (releaseIds.length === 0) {
      return NextResponse.json({ owned: {} });
    }

    const username = process.env.DISCOGS_USERNAME || (await getIdentity()).username;

    const entries = await Promise.all(
      releaseIds.map(async (id) => {
        try {
          const count = await getCollectionInstanceCount(username, id);
          return [id, count] as const;
        } catch {
          return [id, 0] as const;
        }
      }),
    );

    return NextResponse.json({ owned: Object.fromEntries(entries) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
