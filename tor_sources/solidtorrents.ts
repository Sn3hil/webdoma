import { fetchHtml } from "./fetchHtml";
import { parseSize } from "../util/format";
import type { SearchOptions, Source, TorrentResult } from "./types";

const BASE = "https://solidtorrents.to";

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseDate(raw: string): number {
  try {
    const parts = raw.replace(",", "").trim().split(/\s+/);
    if (parts.length < 3) return -1;
    const month = MONTHS[parts[0]!.toLowerCase()];
    if (month === undefined) return -1;
    const day = Number(parts[1]);
    const year = Number(parts[2]);
    return Math.floor(new Date(year, month, day).getTime() / 1000);
  } catch {
    return -1;
  }
}

async function search(query: string, opts: SearchOptions = {}): Promise<TorrentResult[]> {
  const q = query.trim();
  if (!q) return [];

  const out: TorrentResult[] = [];
  const maxPages = 4;

  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE}/search?q=${encodeURIComponent(q)}&category=all&sort=seeders&sort=desc&page=${page}`;
    const $ = await fetchHtml(url, opts);

    const items = $("div.search-result").toArray();
    if (items.length === 0) break;

    for (const el of items) {
      const $el = $(el);
      const titleEl = $el.find("h5.title a").first();
      const name = titleEl.text().trim();
      const href = titleEl.attr("href");
      if (!name || !href) continue;

      const statsEl = $el.find("div.stats").first();
      const divs = statsEl.find("div").toArray();
      const sizeStr = $(divs[2]).text().trim();
      const seedsStr = $(divs[3]).find("font").first().text().trim();
      const leechStr = $(divs[4]).find("font").first().text().trim();
      const dateStr = $(divs[5]).text().trim();

      const magnetEl = $el.find("a.dl-magnet").first();
      const magnet = magnetEl.attr("href");
      if (!magnet) continue;

      const infoHash = magnet.match(/urn:btih:([a-zA-Z0-9]+)/i)?.[1]?.toLowerCase();
      if (!infoHash) continue;

      out.push({
        infoHash,
        name,
        sizeBytes: parseSize(sizeStr),
        seeders: Number(seedsStr) || 0,
        leechers: Number(leechStr) || 0,
        source: "solidtorrents",
        magnet,
        added: parseDate(dateStr) || undefined,
      });
    }

    if (items.length < 15) break;
  }

  return out;
}

export const solidtorrents: Source = {
  id: "solidtorrents",
  label: "Solid Torrents",
  groups: ["Movies", "TV"],
  homepage: BASE,
  reportsHealth: true,
  search,
};
