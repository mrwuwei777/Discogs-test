import { NextResponse } from "next/server";
import { getFolders, getIdentity } from "@/lib/discogs";

export async function GET() {
  try {
    const username = process.env.DISCOGS_USERNAME || (await getIdentity()).username;
    const folders = await getFolders(username);
    return NextResponse.json({ username, folders });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
