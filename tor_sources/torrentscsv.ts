import { fetchResilient, HttpError, USER_AGENT } from "../util/net";
import { buildMagnet } from "./magnet";
import type { SearchOptions, Source, TorrentResult } from "./types";

const BASE = "https://torrents-csv.com";

interface CsvTorrent {
  name?: string;
  infohash?: string;
  size_bytes?: number;
  seeders?: number;
  leechers?: number;
  created_unix?: number;
}

interface CsvResponse {
  torrents?: CsvTorrent[];
}

async function search(query: string, opts: SearchOptions = {}): Promise<TorrentResult[]> {
  const q = query.trim();
  if (!q) return [];

  const url = `${BASE}/service/search?size=100&q=${encodeURIComponent(q)}`;
  const res = await fetchResilient(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: opts.signal,
    retries: 1,
  });
  if (!res.ok) throw new HttpError(res.status, `torrents-csv returned ${res.status}`);

  const json = (await res.json()) as CsvResponse;
  const out: TorrentResult[] = [];

  for (const t of json.torrents ?? []) {
    const infoHash = t.infohash?.toLowerCase();
    if (!infoHash || !t.name) continue;
    out.push({
      infoHash,
      name: t.name,
      sizeBytes: t.size_bytes ?? 0,
      seeders: t.seeders ?? 0,
      leechers: t.leechers ?? 0,
      source: "torrents-csv",
      magnet: buildMagnet(infoHash, t.name),
      added: t.created_unix,
    });
  }
  return out;
}

export const torrentscsv: Source = {
  id: "torrents-csv",
  label: "Torrents.csv",
  groups: ["Movies", "TV", "Games", "Anime"],
  homepage: BASE,
  reportsHealth: true,
  search,
};
