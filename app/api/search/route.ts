import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { SOURCES } from "@/tor_sources/registry";
import { cachedSearch } from "@/tor_sources/cache";
import type { TorrentResult } from "@/tor_sources/types";
import { acquireLock, releaseLock, abortLock } from "@/lib/in-flight";

export const dynamic = "force-dynamic";

interface SearchResult extends TorrentResult {
  reportsHealth: boolean;
}

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");
    const sourcesParam = searchParams.get("sources");

    if (!query || query.trim().length === 0) {
      return NextResponse.json({ error: "Missing 'q' parameter" }, { status: 400 });
    }

    const activeSources = sourcesParam
      ? SOURCES.filter((s) => sourcesParam.split(",").includes(s.id))
      : SOURCES;

    if (activeSources.length === 0) {
      return NextResponse.json({ results: [], errors: [] });
    }

    const lockKey = `${session.userId}:search`;
    abortLock(lockKey); // Cancel any previous running search
    const controller = acquireLock(lockKey);
    
    if (!controller) {
      return NextResponse.json({ error: "Could not acquire search lock" }, { status: 409 });
    }

    const timeout = setTimeout(() => controller.abort(), 15_000);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controllerStream) {
        const sendEvent = (event: string, data: any) => {
          try {
            controllerStream.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch (e) {
            // Stream might be closed
          }
        };

        const queryTokens = query.trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

        try {
          const promises = activeSources.map(async (source) => {
            try {
              const rawResults = await cachedSearch(source, query.trim(), { signal: controller.signal });
              
              const resultsByHash = new Map<string, SearchResult>();

              for (const result of rawResults) {
                if (queryTokens.length > 0) {
                  const nameLower = result.name.toLowerCase().replace(/[^a-z0-9]+/g, " ");
                  const matches = queryTokens.every(token => nameLower.includes(token));
                  if (!matches) continue;
                }

                const existing = resultsByHash.get(result.infoHash);
                if (!existing || result.seeders > existing.seeders) {
                  resultsByHash.set(result.infoHash, {
                    ...result,
                    reportsHealth: source.reportsHealth,
                  });
                }
              }

              sendEvent("source", {
                sourceId: source.id,
                results: Array.from(resultsByHash.values()),
                error: null
              });
            } catch (error) {
              if (error instanceof DOMException && error.name === "AbortError") {
                return; // Silently ignore aborts
              }
              sendEvent("source", {
                sourceId: source.id,
                results: [],
                error: error instanceof Error ? error.message : "Unknown error"
              });
            }
          });

          await Promise.allSettled(promises);
          
          sendEvent("done", { totalSources: activeSources.length });
        } finally {
          clearTimeout(timeout);
          releaseLock(lockKey, controller);
          try {
            controllerStream.close();
          } catch (e) {}
        }
      },
      cancel() {
        clearTimeout(timeout);
        controller.abort();
        releaseLock(lockKey, controller);
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
      },
    });

  } catch (error) {
    console.error("Search API setup error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search failed" },
      { status: 500 }
    );
  }
}
