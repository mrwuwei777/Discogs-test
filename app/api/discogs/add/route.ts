import { NextRequest, NextResponse } from "next/server";
import { addReleaseToCollection, getIdentity } from "@/lib/discogs";

export async function POST(req: NextRequest) {
  try {
    const { releaseId, folderId } = await req.json();
    if (!releaseId) {
      return NextResponse.json({ error: "releaseId is required" }, { status: 400 });
    }
    const username = process.env.DISCOGS_USERNAME || (await getIdentity()).username;
    await addReleaseToCollection(username, releaseId, folderId ?? 1);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
