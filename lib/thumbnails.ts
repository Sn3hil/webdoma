/**
 * lib/thumbnails.ts
 * Thumbnail generation engine for "other" video files.
 * Uses ffmpeg with HTTP input against TorBox CDN URLs.
 */

import { mkdir, writeFile, rm, readdir, stat } from "fs/promises";
import { join } from "path";
import { requestCdnLink, getValidAccessToken } from "./torbox";
import {
  getFilesNeedingThumbnails,
  insertThumbnail,
  deleteOrphanedThumbnails,
} from "./db";
import { THUMBNAIL_WIDTH, THUMBNAIL_COUNT, THUMBNAIL_QUALITY } from "./constants";

const THUMBNAILS_DIR = join(process.cwd(), "data", "thumbnails");

function thumbnailDir(accountId: number, torrentId: number, fileId: number): string {
  return join(THUMBNAILS_DIR, String(accountId), String(torrentId), String(fileId));
}

function thumbnailPath(accountId: number, torrentId: number, fileId: number, position: number): string {
  return join(thumbnailDir(accountId, torrentId, fileId), `${position}.jpg`);
}

async function probeDuration(cdnUrl: string): Promise<number | null> {
  try {
    const { spawn } = await import("child_process");
    return await new Promise((resolve) => {
      const proc = spawn("ffprobe", [
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        cdnUrl,
      ], { stdio: ["ignore", "pipe", "pipe"] });

      let stdout = "";
      proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });

      const timeout = setTimeout(() => {
        proc.kill();
        resolve(null);
      }, 30_000);

      proc.on("close", () => {
        clearTimeout(timeout);
        try {
          const parsed = JSON.parse(stdout);
          const dur = parseFloat(parsed?.format?.duration);
          resolve(isFinite(dur) && dur > 0 ? dur : null);
        } catch {
          resolve(null);
        }
      });

      proc.on("error", () => {
        clearTimeout(timeout);
        resolve(null);
      });
    });
  } catch {
    return null;
  }
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

async function extractFrame(
  cdnUrl: string,
  timestamp: string,
  outputPath: string
): Promise<boolean> {
  try {
    const { spawn } = await import("child_process");
    return await new Promise((resolve) => {
      const proc = spawn("ffmpeg", [
        "-ss", timestamp,
        "-i", cdnUrl,
        "-frames:v", "1",
        "-q:v", String(THUMBNAIL_QUALITY),
        "-vf", `scale=${THUMBNAIL_WIDTH}:-2`,
        "-y",
        outputPath,
      ], { stdio: ["ignore", "pipe", "pipe"] });

      const timeout = setTimeout(() => {
        proc.kill();
        resolve(false);
      }, 60_000);

      proc.on("close", (code) => {
        clearTimeout(timeout);
        resolve(code === 0);
      });

      proc.on("error", () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  } catch {
    return false;
  }
}

export async function generateThumbnailsForFile(
  accountId: number,
  torrentId: number,
  fileId: number,
  remotePath: string,
  accessToken: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Get CDN link
    const cdnUrl = await requestCdnLink(torrentId, fileId, accessToken);
    if (!cdnUrl) {
      return { success: false, error: "Failed to get CDN link" };
    }

    // 2. Probe duration
    const duration = await probeDuration(cdnUrl);

    // 3. Calculate timestamps
    let timestamps: number[];
    if (duration && duration > 0) {
      timestamps = [0.1, 0.3, 0.5, 0.7, 0.9].map((pct) => pct * duration);
    } else {
      // Fallback: use fixed timestamps if duration unavailable
      timestamps = [30, 60, 90, 120, 150];
    }

    // 4. Create directory
    const dir = thumbnailDir(accountId, torrentId, fileId);
    await mkdir(dir, { recursive: true });

    // 5. Extract 5 frames sequentially (better for potato servers)
    const results: boolean[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const success = await extractFrame(
        cdnUrl,
        formatTimestamp(timestamps[i]),
        thumbnailPath(accountId, torrentId, fileId, i + 1)
      );
      results.push(success);
    }

    // 6. Check if all succeeded
    const allSucceeded = results.every(Boolean);

    if (allSucceeded) {
      // Insert DB rows only after all files are on disk
      for (let i = 1; i <= THUMBNAIL_COUNT; i++) {
        insertThumbnail(accountId, torrentId, fileId, i);
      }
      return { success: true };
    } else {
      // Partial failure: clean up any files that were created, leave unmarked for retry
      const failedCount = results.filter((r) => !r).length;
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {}
      return { success: false, error: `${failedCount}/${THUMBNAIL_COUNT} frames failed` };
    }
  } catch (e: any) {
    return { success: false, error: e.message || "Unknown error" };
  }
}

export async function generateAllThumbnails(
  accountId: number,
  signal?: AbortSignal
): Promise<{ generated: number; skipped: number; failed: number; errors: string[] }> {
  const files = getFilesNeedingThumbnails(accountId);
  if (files.length === 0) {
    return { generated: 0, skipped: 0, failed: 0, errors: [] };
  }

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(accountId, signal);
  } catch (e: any) {
    return { generated: 0, skipped: 0, failed: files.length, errors: [`Auth failed: ${e.message}`] };
  }

  let generated = 0;
  let failed = 0;
  const errors: string[] = [];

  // Process files one at a time (gentle on the server)
  for (const file of files) {
    if (signal?.aborted) break;

    const result = await generateThumbnailsForFile(
      accountId,
      file.torrent_id,
      file.file_id,
      file.remote_path,
      accessToken
    );

    if (result.success) {
      generated++;
    } else {
      failed++;
      if (result.error) {
        errors.push(`${file.filename}: ${result.error}`);
      }
    }
  }

  return { generated, skipped: 0, failed, errors };
}

export async function cleanupOrphanedThumbnailsFromDisk(): Promise<void> {
  try {
    // First, delete DB rows for orphaned thumbnails
    deleteOrphanedThumbnails();

    // Then clean up empty directories on disk
    const accountsDir = THUMBNAILS_DIR;
    let accountDirs;
    try {
      accountDirs = await readdir(accountsDir);
    } catch {
      return; // No thumbnails directory exists yet
    }

    for (const accountDir of accountDirs) {
      const accountPath = join(accountsDir, accountDir);
      const accountStat = await stat(accountPath).catch(() => null);
      if (!accountStat?.isDirectory()) continue;

      const torrentDirs = await readdir(accountPath);
      for (const torrentDir of torrentDirs) {
        const torrentPath = join(accountPath, torrentDir);
        const torrentStat = await stat(torrentPath).catch(() => null);
        if (!torrentStat?.isDirectory()) continue;

        const fileDirs = await readdir(torrentPath);
        for (const fileDir of fileDirs) {
          const filePath = join(torrentPath, fileDir);
          const fileStat = await stat(filePath).catch(() => null);
          if (!fileStat?.isDirectory()) continue;

          // Check if directory is empty (all thumbnails deleted)
          const remaining = await readdir(filePath);
          if (remaining.length === 0) {
            await rm(filePath, { recursive: true, force: true });
          }
        }

        // Check if torrent dir is now empty
        const remainingTorrent = await readdir(torrentPath);
        if (remainingTorrent.length === 0) {
          await rm(torrentPath, { recursive: true, force: true });
        }
      }

      // Check if account dir is now empty
      const remainingAccount = await readdir(accountPath);
      if (remainingAccount.length === 0) {
        await rm(accountPath, { recursive: true, force: true });
      }
    }
  } catch (e) {
    console.error("cleanupOrphanedThumbnailsFromDisk error:", e);
  }
}
