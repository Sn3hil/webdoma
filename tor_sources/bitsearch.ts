import { fetchHtml } from "./fetchHtml";
import { parseSize } from "../util/format";
import type { SearchOptions, Source, TorrentResult } from "./types";

const BASE = "https://bitsearch.to";

async function search(query: string, opts: SearchOptions = {}): Promise<TorrentResult[]> {
  const q = query.trim();
  if (!q) return [];

  const out: TorrentResult[] = [];
  const maxPages = 5;

  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE}/search?q=${encodeURIComponent(q)}&page=${page}`;
    const $ = await fetchHtml(url, opts);

    const items = $("div.bg-white").toArray();
    if (items.length === 0) break;

    for (const el of items) {
      const $el = $(el);
      const nameEl = $el.find("div.items-start a").first();
      const name = nameEl.text().trim();
      const href = nameEl.attr("href");
      if (!name || !href) continue;

      const spans = $el.find("div.items-center span.font-medium").toArray();
      const sizeStr = $(spans[0]).text().trim();
      const dateStr = $(spans[1]).text().trim();

      const statsText = $el.find("div.items-center").last().text();
      const seedsMatch = statsText.match(/(\d+)\s*Seed/i);
      const leechMatch = statsText.match(/(\d+)\s*Leech/i);

      const magnetEl = $el.find("a[href^='magnet:']").first();
      const magnet = magnetEl.attr("href");
      if (!magnet) continue;

      const infoHash = magnet.match(/urn:btih:([a-zA-Z0-9]+)/i)?.[1]?.toLowerCase();
      if (!infoHash) continue;

      let added: number | undefined;
      if (dateStr) {
        const parsed = Date.parse(dateStr);
        if (!Number.isNaN(parsed)) added = Math.floor(parsed / 1000);
      }

      out.push({
        infoHash,
        name,
        sizeBytes: parseSize(sizeStr),
        seeders: seedsMatch ? Number(seedsMatch[1]) : 0,
        leechers: leechMatch ? Number(leechMatch[1]) : 0,
        source: "bitsearch",
        magnet,
        added,
      });
    }

    if (items.length < 20) break;
    await new Promise((r) => setTimeout(r, 750));
  }

  return out;
}

export const bitsearch: Source = {
  id: "bitsearch",
  label: "Bit Search",
  homepage: BASE,
  reportsHealth: true,
  search,
};
