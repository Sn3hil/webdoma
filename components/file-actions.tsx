"use client";

import { Copy, Play, Download, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useState, useCallback, useRef } from "react";
import { LOCAL_DAEMON_PLAYERS } from "@/lib/constants";
import { launchPlayback } from "@/lib/client-play";

interface FileActionsProps {
  torrentId: number;
  fileId: number;
  fileName: string;
  isMedia: boolean;
  playerProtocol: string;
  accountId: number;
}

export function FileActions({
  torrentId,
  fileId,
  fileName,
  isMedia,
  playerProtocol,
  accountId,
}: FileActionsProps) {
  const [isCopying, setIsCopying] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSyncplaying, setIsSyncplaying] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  /**
   * Single ref guarding all CDN-link actions on this file-row.
   * All four handlers (copy, stream, syncplay, download) hit /api/cdn-link,
   * which the backend protects with a single userId:cdn lock. This ref prevents
   * two actions from racing before React re-renders to disable the other buttons.
   */
  const cdnInFlight = useRef(false);

  const getCdnLink = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch("/api/cdn-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          torrent_id: torrentId,
          file_id: fileId,
          account_id: accountId,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.url) {
        const message =
          res.status === 409
            ? (data as { error?: string }).error || "A CDN request is already in progress"
            : (data as { error?: string }).error || "Failed to get CDN link";
        toast.error(message);
        return null;
      }

      return data.url;
    } catch {
      toast.error("Network error");
      return null;
    }
  }, [torrentId, fileId, accountId]);

  const handleCopyLink = useCallback(async () => {
    if (cdnInFlight.current) return;
    cdnInFlight.current = true;
    setIsCopying(true);
    try {
      const cdnUrl = await getCdnLink();
      if (!cdnUrl) return;
      await navigator.clipboard.writeText(cdnUrl);
      toast.success("CDN link copied to clipboard");
    } catch {
      toast.error("Failed to copy link");
    } finally {
      cdnInFlight.current = false;
      setIsCopying(false);
    }
  }, [getCdnLink]);

  const handleSyncplay = useCallback(async () => {
    if (!LOCAL_DAEMON_PLAYERS.includes(playerProtocol)) {
      toast.error("Syncplay requires a local daemon player (mpv, vlc, iina)");
      return;
    }
    if (cdnInFlight.current) return;
    cdnInFlight.current = true;
    setIsSyncplaying(true);
    try {
      const cdnUrl = await getCdnLink();
      if (!cdnUrl) return;

      try {
        const daemonRes = await fetch("http://localhost:9070/syncplay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ player: playerProtocol, url: cdnUrl }),
        });

        if (daemonRes.ok) {
          const data = await daemonRes.json();
          toast.success(`Syncplay launched via ${playerProtocol.toUpperCase()}`, {
            description: `Joined room: ${data.room || "unknown"}`,
          });
          return;
        }
        const errData = await daemonRes.json().catch(() => ({}));
        throw new Error((errData as { error?: string }).error || "Daemon returned error status");
      } catch (e: any) {
        toast.error("Syncplay launch failed", {
          description: e.message || "Ensure Aemond is running and syncplay.conf is configured.",
        });
      }
    } catch {
      toast.error("Failed to start Syncplay");
    } finally {
      cdnInFlight.current = false;
      setIsSyncplaying(false);
    }
  }, [getCdnLink, playerProtocol]);

  const handleStream = useCallback(async () => {
    if (cdnInFlight.current) return;
    cdnInFlight.current = true;
    setIsStreaming(true);
    try {
      await launchPlayback({ torrentId, fileId, accountId, playerProtocol });
    } finally {
      cdnInFlight.current = false;
      setIsStreaming(false);
    }
  }, [torrentId, fileId, accountId, playerProtocol]);

  const handleDownload = useCallback(async () => {
    if (cdnInFlight.current) return;
    cdnInFlight.current = true;
    setIsDownloading(true);
    try {
      const cdnUrl = await getCdnLink();
      if (!cdnUrl) return;
      window.open(cdnUrl, "_blank");
      toast.success("Download started", { description: fileName });
    } finally {
      cdnInFlight.current = false;
      setIsDownloading(false);
    }
  }, [getCdnLink, fileName]);

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              handleCopyLink();
            }}
            disabled={isCopying || isStreaming || isSyncplaying || isDownloading}
            className="h-8 w-8 hover:bg-primary/10 hover:text-primary"
            id={`copy-link-${fileName}`}
          >
            {isCopying ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <Copy size={16} />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Copy CDN link</TooltipContent>
      </Tooltip>

      {isMedia && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  handleStream();
                }}
                disabled={isStreaming || isCopying || isSyncplaying || isDownloading}
                className="h-8 w-8 hover:bg-violet-500/10 hover:text-violet-400"
                id={`stream-${fileName}`}
              >
                {isStreaming ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Play size={16} />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Stream in player</TooltipContent>
          </Tooltip>

          {LOCAL_DAEMON_PLAYERS.includes(playerProtocol) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSyncplay();
                  }}
                  disabled={isSyncplaying || isCopying || isStreaming || isDownloading}
                  className="h-8 w-8 hover:bg-amber-500/10 hover:text-amber-400"
                  id={`syncplay-${fileName}`}
                >
                  {isSyncplaying ? (
                    <Loader2 className="animate-spin" size={16} />
                  ) : (
                    <Users size={16} />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Syncplay with friends</TooltipContent>
            </Tooltip>
          )}
        </>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              handleDownload();
            }}
            disabled={isDownloading || isCopying || isStreaming || isSyncplaying}
            className="h-8 w-8 hover:bg-emerald-500/10 hover:text-emerald-400"
            id={`download-${fileName}`}
          >
            {isDownloading ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <Download size={16} />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Download file</TooltipContent>
      </Tooltip>
    </div>
  );
}
