import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { abortLock } from "@/lib/in-flight";

const CANCELLABLE_ACTIONS = [
    "sync",
    "cdn",
    "torrent:create",
    "torrent:check-cache"
] as const;

const cancelSchema = z.object({
    action: z.enum(CANCELLABLE_ACTIONS),
});

export async function POST(req: Request) {
    try {
        const session = await getSession();
        if (!session.userId) {
            return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
        }

        let body: unknown;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const parsed = cancelSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { error: `Invalid action.Must be one of: ${CANCELLABLE_ACTIONS.join(", ")}` },
                { status: 400 }
            );
        }

        const lockKey = `${session.userId}:${parsed.data.action}`;
        const aborted = abortLock(lockKey);

        if (!aborted) {
            return NextResponse.json(
                { ok: false, message: "No active request found for this action" },
                { status: 404 }
            );
        }

        return NextResponse.json({ ok: true, message: "Request cancelled" });
    } catch (error) {
        console.error("Cancel API error: ", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}