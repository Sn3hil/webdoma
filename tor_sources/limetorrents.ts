import { fetchHtml } from "./fetchHtml";
import { parseSize } from "../util/format";
import { buildMagnet } from "./magnet";
import { unescapeEntities } from "./rss";
import type { SearchOptions, Source, TorrentResult } from "./types";

const MIRRORS = ["https://www.limetorrents.fun", "https://www.limetorrents.lol"];

const DATE_PATTERNS: { re: RegExp; calc: (m: RegExpMatchArray) => number }[] = [
  { re: /^yesterday/i, calc: () => Math.floor(Date.now() / 1000) - 86400 },
  { re: /^last\s+month/i, calc: () => Math.floor(Date.now() / 1000) - 30 * 86400 },
  { re: /^(\d+)\s+years?(\+)?(\s+ago)?/i, calc: (m) => Math.floor(Date.now() / 1000) - Number(m[1]) * 365 * 86400 },
  { re: /^(\d+)\s+months?(\+)?(\s+ago)?/i, calc: (m) => Math.floor(Date.now() / 1000) - Number(m[1]) * 30 * 86400 },
  { re: /^(\d+)\s+days?(\+)?(\s+ago)?/i, calc: (m) => Math.floor(Date.now() / 1000) - Number(m[1]) * 86400 },
  { re: /^(\d+)\s+hours?(\+)?(\s+ago)?/i, calc: (m) => Math.floor(Date.now() / 1000) - Number(m[1]) * 3600 },
  { re: /^(\d+)\s+minutes?(\+)?(\s+ago)?/i, calc: (m) => Math.floor(Date.now() / 1000) - Number(m[1]) * 60 },
];

function parseRelativeDate(raw: string): number {
  const cleaned = raw.split(" - in ")[0]?.trim() ?? raw.trim();
  for (const { re, calc } of DATE_PATTERNS) {
    const m = cleaned.match(re);
    if (m) return calc(m);
  }
  return -1;
}

async function search(query: string, opts: SearchOptions = {}): Promise<TorrentResult[]> {
  const q = query.trim().replace(/[\/\\?#&]+/g, " ").trim().replace(/\s+/g, "-");
  if (!q) return [];

  const out: TorrentResult[] = [];
  const maxPages = 2;

  for (const base of MIRRORS) {
    try {
      for (let page = 1; page <= maxPages; page++) {
        const url = `${base}/search/all/${encodeURIComponent(q)}/seeds/${page}/`;
        const $ = await fetchHtml(url, opts);

        const rows = $("table.table2 tr").toArray();
        let addedThisPage = 0;

        for (const row of rows) {
          const cells = $(row).find("td").toArray();
          if (cells.length < 5) continue;

          // Find the torrent title link (not the download icon)
          const titleLink = $(cells[0])
            .find(".tt-name a")
            .filter((_, el) => !$(el).hasClass("csprite_dl14"))
            .first();
          const name = unescapeEntities(titleLink.text().trim());
          if (!name) continue;

          // Find infohash from .torrent download link
          const torrentLink = $(cells[0]).find("a[href*='.torrent']").first();
          const torrentHref = torrentLink.attr("href") || "";
          const hashMatch = torrentHref.match(/([a-fA-F0-9]{40})\.torrent/i);
          const infoHash = hashMatch ? hashMatch[1]!.toLowerCase() : null;
          if (!infoHash) continue;

          const pubDateRaw = $(cells[1]).text().trim();
          const sizeRaw = $(cells[2]).text().trim().replace(/,/g, "");
          const seedsRaw = $(cells[3]).text().trim().replace(/,/g, "");
          const leechRaw = $(cells[4]).text().trim().replace(/,/g, "");

          out.push({
            infoHash,
            name,
            sizeBytes: parseSize(sizeRaw),
            seeders: Number(seedsRaw) || 0,
            leechers: Number(leechRaw) || 0,
            source: "limetorrents",
            magnet: buildMagnet(infoHash, name),
            added: parseRelativeDate(pubDateRaw) || undefined,
          });
          addedThisPage++;
        }

        // If page had fewer than 20 items, there are no more pages
        if (addedThisPage < 20) break;
      }

      // If we found results from this mirror, no need to query next mirror
      if (out.length > 0) break;
    } catch {
      // Try next mirror
      continue;
    }
  }

  return out;
}

export const limetorrents: Source = {
  id: "limetorrents",
  label: "LimeTorrents",
  groups: ["Movies", "TV", "Anime", "Games"],
  homepage: MIRRORS[0]!,
  reportsHealth: true,
  search,
};
