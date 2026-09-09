import * as cheerio from "cheerio";
import { fetchResilient, HttpError, USER_AGENT } from "../util/net";
import type { SearchOptions } from "./types";

export async function fetchHtml(
  url: string,
  opts: SearchOptions = {},
): Promise<cheerio.CheerioAPI> {
  const res = await fetchResilient(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: opts.signal,
    retries: 2,
  });
  if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} for ${url}`);
  const html = await res.text();
  return cheerio.load(html);
}
