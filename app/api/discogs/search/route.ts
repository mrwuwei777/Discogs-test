import { NextRequest, NextResponse } from "next/server";
import { searchByBarcode, searchByQuery } from "@/lib/discogs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const barcode = searchParams.get("barcode");
  const q = searchParams.get("q");
  const artist = searchParams.get("artist");
  const releaseTitle = searchParams.get("release_title");

  try {
    const results = barcode
      ? await searchByBarcode(barcode)
      : await searchByQuery({
          q: q ?? undefined,
          artist: artist ?? undefined,
          release_title: releaseTitle ?? undefined,
        });
    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
