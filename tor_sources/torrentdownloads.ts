import { fetchHtml } from "./fetchHtml";
import { parseSize } from "../util/format";
import type { SearchOptions, Source, TorrentResult } from "./types";

const BASE = "https://torrentdownloads.pro";

async function search(query: string, opts: SearchOptions = {}): Promise<TorrentResult[]> {
  const q = query.trim().replace(/\s+/g, "+");
  if (!q) return [];

  const out: TorrentResult[] = [];
  const maxPages = 5;

  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE}/search/?new=1&s_cat=0&search=${encodeURIComponent(q)}&page=${page}`;
    const $ = await fetchHtml(url, opts);

    const rows = $("div.grey_bar3").toArray();
    if (rows.length === 0) break;

    const detailPromises = rows.map(async (row) => {
      const $row = $(row);
      const nameLink = $row.find("p a").first();
      const name = nameLink.text().trim();
      const href = nameLink.attr("href");
      if (!name || !href || !href.startsWith("/torrent/")) return null;

      const descLink = `${BASE}${href}`;
      const spans = $row.find("span").toArray();
      const leechStr = $(spans[1]).text().trim();
      const seedsStr = $(spans[2]).text().trim();
      const sizeStr = $(spans[3]).text().trim();

      try {
        const detail$ = await fetchHtml(descLink, opts);
        const magnet = detail$('a[href^="magnet:"]').first().attr("href");
        if (!magnet) return null;

        const infoHash = magnet.match(/urn:btih:([a-zA-Z0-9]+)/i)?.[1]?.toLowerCase();
        if (!infoHash) return null;

        return {
          infoHash,
          name,
          sizeBytes: parseSize(sizeStr),
          seeders: Number(seedsStr) || 0,
          leechers: Number(leechStr) || 0,
          source: "torrentdownloads" as const,
          magnet,
        };
      } catch {
        return null;
      }
    });

    const results = await Promise.all(detailPromises);
    for (const r of results) {
      if (r) out.push(r);
    }

    const nextExists = $('a:contains(">>")').length > 0;
    if (!nextExists || rows.length < 20) break;
  }

  return out;
}

export const torrentdownloads: Source = {
  id: "torrentdownloads",
  label: "Torrent Downloads",
  groups: ["Movies", "TV", "Games", "Anime"],
  homepage: BASE,
  reportsHealth: true,
  search,
};
