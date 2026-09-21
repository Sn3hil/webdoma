import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getTorrentInfo, verifyUserAccountAccess } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get("account_id");
    const torrentId = searchParams.get("torrent_id");

    if (!accountId || !torrentId) {
      return NextResponse.json({ error: "account_id and torrent_id are required" }, { status: 400 });
    }

    const accountIdNum = parseInt(accountId, 10);
    const torrentIdNum = parseInt(torrentId, 10);

    if (isNaN(accountIdNum) || isNaN(torrentIdNum)) {
      return NextResponse.json({ error: "Invalid account_id or torrent_id" }, { status: 400 });
    }

    // Verify the user owns this account
    if (!verifyUserAccountAccess(session.userId, accountIdNum)) {
      return NextResponse.json({ error: "Account access denied" }, { status: 403 });
    }

    const info = getTorrentInfo(accountIdNum, torrentIdNum);

    if (!info) {
      return NextResponse.json({ error: "Torrent not found" }, { status: 404 });
    }

    return NextResponse.json(info);
  } catch (error) {
    console.error("Torrent info API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
