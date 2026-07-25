import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let cached: { ffmpeg: string; ffprobe: string } | null = null;

function resolveFromPath(name: string): string | null {
  const probe = spawnSync(name, ["-version"], { encoding: "utf8" });
  if (!probe.error && probe.status === 0) return name;
  return null;
}

function resolveStatic(pkgName: string): string | null {
  try {
    const mod = require(pkgName) as string | { path?: string };
    const bin = typeof mod === "string" ? mod : mod?.path;
    if (!bin) return null;
    const probe = spawnSync(bin, ["-version"], { encoding: "utf8" });
    if (!probe.error && probe.status === 0) return bin;
  } catch {
    // package missing or binary unavailable for this platform
  }
  return null;
}

/** Resolve ffmpeg/ffprobe: system PATH first, then bundled static binaries. */
export function getMediaBins(): { ffmpeg: string; ffprobe: string } {
  if (cached) return cached;

  const ffmpeg = resolveFromPath("ffmpeg") || resolveStatic("ffmpeg-static");
  const ffprobe = resolveFromPath("ffprobe") || resolveStatic("ffprobe-static");

  if (!ffmpeg || !ffprobe) {
    const missing = [!ffmpeg ? "ffmpeg" : null, !ffprobe ? "ffprobe" : null].filter(
      Boolean,
    );
    throw new Error(
      `${missing.join(" and ")} not available. ` +
        `Install system ffmpeg, or run: pnpm add ffmpeg-static ffprobe-static`,
    );
  }

  cached = { ffmpeg, ffprobe };
  return cached;
}

export function requireMediaBins(
  log: (msg: string) => void = console.error,
): { ffmpeg: string; ffprobe: string } {
  const bins = getMediaBins();
  for (const [name, bin] of Object.entries(bins)) {
    const probe = spawnSync(bin, ["-version"], { encoding: "utf8" });
    const first = (probe.stdout || probe.stderr || "").split(/\r?\n/)[0];
    log(`Found ${name}: ${first || bin}`);
    if (bin !== name) log(`  (bundled) ${bin}`);
  }
  return bins;
}

export function runFfprobeDuration(filePath: string): number {
  const { ffprobe } = getMediaBins();
  const proc = spawnSync(
    ffprobe,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ],
    { encoding: "utf8" },
  );
  if (proc.status !== 0) {
    throw new Error(
      `ffprobe failed for ${filePath}:\n${proc.stderr || proc.stdout || ""}`,
    );
  }
  return Number.parseFloat(String(proc.stdout).trim());
}

export function runFfmpeg(
  args: string[],
  label: string,
  log: (msg: string) => void = console.error,
): void {
  const { ffmpeg } = getMediaBins();
  const cmd = [ffmpeg, "-y", ...args];
  log(`ffmpeg (${label}): ${cmd.join(" ")}`);
  const proc = spawnSync(ffmpeg, ["-y", ...args], { encoding: "utf8" });
  if (proc.status !== 0) {
    const err = (proc.stderr || proc.stdout || "").trim();
    const tail = err.split(/\r?\n/).slice(-40).join("\n");
    throw new Error(`ffmpeg failed (${label}):\n${tail}`);
  }
}
