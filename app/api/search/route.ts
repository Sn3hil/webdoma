import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { SOURCES } from "@/tor_sources/registry";
import { cachedSearch } from "@/tor_sources/cache";
import type { TorrentResult } from "@/tor_sources/types";

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

    // 15-second timeout for the entire search
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      // Search all sources in parallel; partial failures don't block others
      const settled = await Promise.allSettled(
        activeSources.map((source) =>
          cachedSearch(source, query.trim(), { signal: controller.signal })
        )
      );

      // Deduplicate by infoHash — keep the result with more seeders
      const resultsByHash = new Map<string, SearchResult>();
      const errors: { sourceId: string; error: string }[] = [];
      const queryTokens = query.trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

      for (let i = 0; i < settled.length; i++) {
        const outcome = settled[i]!;
        const source = activeSources[i]!;
        if (outcome.status === "fulfilled") {
          for (const result of outcome.value) {
            // Global fuzzy filter: require all query words to be present in the result name
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
        } else {
          errors.push({
            sourceId: source.id,
            error: outcome.reason instanceof Error
              ? outcome.reason.message
              : "Unknown error",
          });
        }
      }

      // Sort by seeders descending for a useful default order
      const results = Array.from(resultsByHash.values()).sort(
        (a, b) => b.seeders - a.seeders
      );

      return NextResponse.json({ results, errors });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search failed" },
      { status: 500 }
    );
  }
}
