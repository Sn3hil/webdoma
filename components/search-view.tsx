"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Search,
  HardDrive,
  Loader2,
  XCircle,
  CheckCircle2,
  Plus,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AccountSelectDialog } from "@/components/account-select-dialog";
import { useFileStore } from "@/lib/store";
import { parseInput } from "@/tor_sources/magnet";
import { formatBytes } from "@/lib/utils";
import { toast } from "sonner";

// --- Types ---

interface CachedFileInfo {
  id: number;
  name: string;
  size: number;
  short_name: string;
  mimetype: string;
}

interface CachedTorrentResult {
  name: string;
  size: number;
  hash: string;
  files: CachedFileInfo[];
}

interface SearchResult {
  infoHash: string;
  name: string;
  sizeBytes: number;
  seeders: number;
  leechers: number;
  numFiles?: number;
  source: string;
  magnet: string;
  added?: number;
  reportsHealth: boolean;
}

type SearchStatus = "idle" | "searching" | "results" | "error";
type CacheStatus = "idle" | "checking" | "cached" | "not-cached";

// --- Helpers ---

function isMagnetInput(value: string): boolean {
  const s = value.trim();
  if (/^magnet:\?/i.test(s)) return true;
  if (/^[a-f0-9]{40}$/i.test(s)) return true;
  if (/^[a-z2-7]{32}$/i.test(s)) return true;
  return false;
}

// --- Component ---

interface SearchViewProps {
  accounts: any[];
  hasAccounts: boolean;
  availableSources?: { id: string; label: string }[];
}

export function SearchView({ accounts, hasAccounts, availableSources = [] }: SearchViewProps) {
  const { activeAccountId } = useFileStore();

  // Search state
  const [query, setQuery] = useState("");
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchErrors, setSearchErrors] = useState<{ sourceId: string; error: string }[]>([]);

  // Source selection
  const [enabledSources, setEnabledSources] = useState<string[]>([]);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("enabledSearchSources");
      if (saved) {
        setEnabledSources(JSON.parse(saved));
      } else if (availableSources.length > 0) {
        setEnabledSources(availableSources.map((s) => s.id));
      }
    } catch {
      if (availableSources.length > 0) {
        setEnabledSources(availableSources.map((s) => s.id));
      }
    }
    setSourcesLoaded(true);
  }, [availableSources]);

  const toggleSource = (id: string) => {
    setEnabledSources((prev) => {
      const next = prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id];
      localStorage.setItem("enabledSearchSources", JSON.stringify(next));
      return next;
    });
  };

  const selectAllSources = () => {
    const all = availableSources.map((s) => s.id);
    setEnabledSources(all);
    localStorage.setItem("enabledSearchSources", JSON.stringify(all));
  };

  const clearAllSources = () => {
    setEnabledSources([]);
    localStorage.setItem("enabledSearchSources", JSON.stringify([]));
  };

  // Magnet detection
  const isMagnet = useMemo(() => isMagnetInput(query), [query]);

  // Cache check state (per-result)
  const [cacheStatuses, setCacheStatuses] = useState<Map<string, CacheStatus>>(new Map());
  const [cacheResults, setCacheResults] = useState<Map<string, CachedTorrentResult>>(new Map());

  // Add state
  const [addedHashes, setAddedHashes] = useState<Set<string>>(new Set());

  // Account dialog state
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [pendingMagnet, setPendingMagnet] = useState<{
    hash: string;
    magnet: string;
    cachedFiles: CachedFileInfo[];
  } | null>(null);

  // --- Handlers ---

  const handleSearch = async () => {
    if (!query.trim() || isMagnet) return;
    setSearchStatus("searching");
    setCacheStatuses(new Map());
    setCacheResults(new Map());
    setAddedHashes(new Set());

    try {
      let url = `/api/search?q=${encodeURIComponent(query.trim())}`;
      if (sourcesLoaded) {
        url += `&sources=${enabledSources.join(",")}`;
      }
      const res = await fetch(url);
      if (res.status === 401) { window.location.href = "/login"; return; }
      if (!res.ok) throw new Error("Search failed");

      const data = await res.json();
      setResults(data.results || []);
      setSearchErrors(data.errors || []);
      setSearchStatus("results");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Search failed");
      setSearchStatus("error");
    }
  };

  const handleCheckMagnet = async () => {
    if (!isMagnet) return;
    const parsed = parseInput(query.trim());
    if (!parsed) { toast.error("Invalid magnet link or hash"); return; }

    const { infoHash, magnet } = parsed;
    setCacheStatuses(new Map([[infoHash, "checking"]]));
    setCacheResults(new Map());
    setAddedHashes(new Set());
    setResults([{
      infoHash,
      name: parsed.name,
      sizeBytes: 0,
      seeders: 0,
      leechers: 0,
      source: "manual",
      magnet,
      reportsHealth: false,
    }]);
    setSearchStatus("results");

    try {
      const params = new URLSearchParams({ hash: infoHash });
      const res = await fetch(`/api/torrent/check-cache?${params}`);
      if (res.status === 401) { window.location.href = "/login"; return; }

      const data = await res.json();
      const cached = data.data?.[infoHash] || null;

      setCacheStatuses(new Map([[infoHash, cached ? "cached" : "not-cached"]]));
      if (cached) {
        setCacheResults(new Map([[infoHash, cached]]));
      }
    } catch {
      setCacheStatuses(new Map([[infoHash, "not-cached"]]));
      toast.error("Failed to check cache");
    }
  };

  const handleCheckCache = async (result: SearchResult) => {
    const hash = result.infoHash;
    setCacheStatuses((prev) => new Map(prev).set(hash, "checking"));

    try {
      const params = new URLSearchParams({ hash });
      const res = await fetch(`/api/torrent/check-cache?${params}`);
      if (res.status === 401) { window.location.href = "/login"; return; }

      const data = await res.json();
      const cached = data.data?.[hash] || null;

      setCacheStatuses((prev) => new Map(prev).set(hash, cached ? "cached" : "not-cached"));
      if (cached) {
        setCacheResults((prev) => new Map(prev).set(hash, cached));
      }
    } catch {
      setCacheStatuses((prev) => new Map(prev).set(hash, "not-cached"));
    }
  };

  const handleAddClick = (result: SearchResult) => {
    const cached = cacheResults.get(result.infoHash);
    if (!cached) return;

    setPendingMagnet({
      hash: result.infoHash,
      magnet: result.magnet,
      cachedFiles: cached.files,
    });
    setAccountDialogOpen(true);
  };

  const handleAccountConfirm = async (selectedAccountIds: number[]) => {
    if (!pendingMagnet || selectedAccountIds.length === 0) return;

    try {
      let totalInserted = 0;
      for (const accountId of selectedAccountIds) {
        const res = await fetch("/api/torrent/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            magnet: pendingMagnet.magnet,
            account_id: accountId,
            cached_files: pendingMagnet.cachedFiles,
            torrent_hash: pendingMagnet.hash,
          }),
        });

        if (res.status === 401) { window.location.href = "/login"; return; }
        const data = await res.json();
        if (res.status === 409) {
          toast.error(data.error || "A torrent is already being added");
          return;
        }
        if (!res.ok || !data.success) {
          throw new Error(data.error || `Failed to add to account ${accountId}`);
        }
        totalInserted += data.files_inserted || 0;
      }

      setAddedHashes((prev) => new Set(prev).add(pendingMagnet.hash));
      setAccountDialogOpen(false);
      setPendingMagnet(null);

      if (totalInserted > 0) {
        toast.success(`Torrent added! ${totalInserted} file${totalInserted > 1 ? "s" : ""} indexed.`);
      } else {
        toast.success("Torrent added to selected accounts!");
      }

      window.dispatchEvent(new CustomEvent("torrent-files-updated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add torrent");
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="px-6 pt-6 pb-2">
        <div className="relative max-w-2xl mx-auto flex items-center gap-2">
          <div className="relative flex-1">
            {isMagnet ? (
              <HardDrive size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            ) : (
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            )}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  isMagnet ? handleCheckMagnet() : handleSearch();
                }
              }}
              placeholder={isMagnet ? "Magnet link detected — click Check Cache" : "Search torrents or paste a magnet link..."}
              className="w-full pl-10 pr-32 py-3 rounded-xl bg-muted/30 border border-border/50 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
              autoFocus
            />
            <Button
              onClick={isMagnet ? handleCheckMagnet : handleSearch}
              disabled={!query.trim() || searchStatus === "searching"}
              className="absolute right-2 top-1/2 -translate-y-1/2 gap-1.5"
              size="sm"
            >
              {searchStatus === "searching" ? (
                <Loader2 size={16} className="animate-spin" />
              ) : isMagnet ? (
                <><HardDrive size={16} /> Check Cache</>
              ) : (
                <><Search size={16} /> Search</>
              )}
            </Button>
          </div>
          {availableSources.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="shrink-0 h-[46px] w-[46px] rounded-xl border-border/50 bg-muted/30 hover:bg-muted/50">
                  <Filter size={18} className="text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 max-h-[60vh] overflow-y-auto">
                <div className="flex items-center justify-between px-2.5 py-1.5 text-xs border-b border-border/50 mb-1">
                  <span className="font-semibold text-foreground">Sources</span>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        selectAllSources();
                      }}
                      className="hover:text-primary transition-colors cursor-pointer"
                    >
                      All
                    </button>
                    <span>•</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        clearAllSources();
                      }}
                      className="hover:text-primary transition-colors cursor-pointer"
                    >
                      None
                    </button>
                  </div>
                </div>
                {availableSources.map((source) => (
                  <DropdownMenuCheckboxItem
                    key={source.id}
                    checked={enabledSources.includes(source.id)}
                    onCheckedChange={() => toggleSource(source.id)}
                  >
                    {source.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Partial source failure warnings */}
      {searchErrors.length > 0 && searchStatus === "results" && (
        <div className="px-6 pb-2">
          <div className="max-w-2xl mx-auto">
            <p className="text-xs text-amber-500/80">
              {searchErrors.length} source{searchErrors.length > 1 ? "s" : ""} failed:{" "}
              {searchErrors.map((e) => e.sourceId).join(", ")}
            </p>
          </div>
        </div>
      )}

      {/* Idle state */}
      {searchStatus === "idle" && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <Search size={48} className="mx-auto mb-4 opacity-20" />
            <p className="text-sm">Search across 10 torrent sources</p>
            <p className="text-xs mt-1">or paste a magnet link to check its cache status</p>
          </div>
        </div>
      )}

      {/* Loading state */}
      {searchStatus === "searching" && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={32} className="animate-spin text-primary" />
        </div>
      )}

      {/* Results list */}
      {searchStatus === "results" && (
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {results.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-muted-foreground">
                <XCircle size={48} className="mx-auto mb-4 opacity-20" />
                <p className="text-sm">No results found</p>
                <p className="text-xs mt-1">Try different search terms</p>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-4">
              <div className="text-sm font-medium text-muted-foreground mb-4">
                Found {results.length} result{results.length !== 1 ? "s" : ""}
              </div>
              {results.map((result) => {
                const status = cacheStatuses.get(result.infoHash) ?? "idle";

                return (
                  <div
                    key={result.infoHash}
                    className="flex items-center gap-4 p-4 rounded-2xl border border-border/50 bg-card/50 hover:bg-muted/20 transition-all shadow-sm"
                  >
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold whitespace-normal break-words leading-snug">
                        {result.name}
                      </p>
                      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-muted-foreground">
                        <span>{result.source}</span>
                        {result.sizeBytes > 0 && (
                          <span>{formatBytes(result.sizeBytes)}</span>
                        )}
                      </div>
                    </div>

                    {/* Action */}
                    <div className="shrink-0">
                      {status === "idle" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCheckCache(result)}
                        >
                          Check Cache
                        </Button>
                      )}
                      {status === "checking" && (
                        <Loader2
                          size={16}
                          className="animate-spin text-muted-foreground"
                        />
                      )}
                      {status === "not-cached" && (
                        <span className="flex items-center gap-1 text-xs text-red-400">
                          <XCircle size={14} /> Not cached
                        </span>
                      )}
                      {status === "cached" &&
                        !addedHashes.has(result.infoHash) && (
                          <Button
                            size="sm"
                            onClick={() => handleAddClick(result)}
                            className="gap-1"
                          >
                            <Plus size={13} /> Add
                          </Button>
                        )}
                      {addedHashes.has(result.infoHash) && (
                        <span className="flex items-center gap-1 text-xs text-emerald-500">
                          <CheckCircle2 size={14} /> Added
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Error state */}
      {searchStatus === "error" && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <XCircle size={48} className="mx-auto mb-4 opacity-20 text-red-400" />
            <p className="text-sm">Search failed</p>
            <p className="text-xs mt-1">Please try again</p>
          </div>
        </div>
      )}

      {/* Account selection dialog */}
      {hasAccounts && (
        <AccountSelectDialog
          open={accountDialogOpen}
          onOpenChange={setAccountDialogOpen}
          accounts={accounts}
          activeAccountId={activeAccountId}
          torrentName={
            pendingMagnet
              ? results.find((r) => r.infoHash === pendingMagnet.hash)?.name ||
                pendingMagnet.hash
              : ""
          }
          onConfirm={handleAccountConfirm}
        />
      )}
    </div>
  );
}
