import { bitsearch } from "./bitsearch";
import { bittorrented } from "./bittorrented";
import { eztv } from "./eztv";
import { fitgirl } from "./fitgirl";
import { limetorrents } from "./limetorrents";
import { nyaa } from "./nyaa";
import { solidtorrents } from "./solidtorrents";
import { subsplease } from "./subsplease";
import { tpbMovies, tpbTv } from "./piratebay";
import { torrentdownloads } from "./torrentdownloads";
import { torrentscsv } from "./torrentscsv";
import { x1337Movies, x1337Tv } from "./x1337";
import { yts } from "./yts";
import type { Source, SourceGroup, SourceId } from "./types";

export const SOURCES: readonly Source[] = [
  fitgirl,
  yts,
  tpbMovies,
  x1337Movies,
  eztv,
  tpbTv,
  x1337Tv,
  nyaa,
  subsplease,
  bittorrented,
  bitsearch,
  limetorrents,
  solidtorrents,
  torrentdownloads,
  torrentscsv,
];

export const DEFAULT_SOURCE: Source = SOURCES[0]!;

export function getSource(id: SourceId): Source {
  return SOURCES.find((s) => s.id === id) ?? DEFAULT_SOURCE;
}

const GROUP_ORDER: readonly SourceGroup[] = ["Games", "Movies", "TV", "Anime"];

export function sourcesByGroup(): { group: SourceGroup; sources: Source[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    sources: SOURCES.filter((s) => s.groups?.includes(group)),
  })).filter((g) => g.sources.length > 0);
}
