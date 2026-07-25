import { NextRequest, NextResponse } from "next/server";
import { identifyRecordFromImage } from "@/lib/anthropic";

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, mediaType } = await req.json();
    if (!imageBase64 || !mediaType) {
      return NextResponse.json(
        { error: "imageBase64 and mediaType are required" },
        { status: 400 },
      );
    }
    const result = await identifyRecordFromImage(imageBase64, mediaType);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
