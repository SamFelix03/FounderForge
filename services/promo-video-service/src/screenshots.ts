import fs from "node:fs";
import path from "node:path";
import { Firecrawl } from "firecrawl";
import { createLogger } from "@founderforge/observability";
import { withRetries } from "./retry.js";
import type { RuntimeConfig, ScreenshotCapture, SelectedPage } from "./types.js";
import { truncate } from "./util.js";

const log = createLogger("promo.screenshots");
const VIEWPORT = { width: 1440, height: 900 };

function safeFilename(url: string, index: number): string {
  const slug = String(url)
    .replace(/^https?:\/\//i, "")
    .replace(/[^\w]+/g, "_")
    .slice(0, 80);
  return `${String(index + 1).padStart(2, "0")}_${slug || "page"}.png`;
}

function extractScreenshotUrl(doc: unknown): string | null {
  if (!doc || typeof doc !== "object") return null;
  const d = doc as {
    screenshot?: string | { url?: string };
    data?: { screenshot?: string };
    formats?: Array<{ type?: string; screenshot?: string; url?: string }>;
  };
  if (typeof d.screenshot === "string") return d.screenshot;
  if (d.screenshot && typeof d.screenshot === "object" && d.screenshot.url) {
    return d.screenshot.url;
  }
  if (typeof d.data?.screenshot === "string") return d.data.screenshot;
  if (Array.isArray(d.formats)) {
    const shot = d.formats.find(
      (f) => f?.type === "screenshot" || f?.screenshot,
    );
    if (typeof shot?.screenshot === "string") return shot.screenshot;
    if (typeof shot?.url === "string") return shot.url;
  }
  return null;
}

async function downloadToFile(
  url: string,
  destPath: string,
): Promise<{ bytes: number; path: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Screenshot download failed (${res.status}): ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 800) {
    throw new Error(
      `Screenshot suspiciously small (${buf.length} bytes): ${url}`,
    );
  }
  fs.writeFileSync(destPath, buf);
  return { bytes: buf.length, path: destPath };
}

async function scrapeViewport(app: Firecrawl, pageUrl: string) {
  return app.scrape(pageUrl, {
    formats: [
      {
        type: "screenshot",
        fullPage: false,
        quality: 85,
        viewport: VIEWPORT,
      },
    ],
    waitFor: 2000,
  });
}

export async function captureScreenshots(
  cfg: RuntimeConfig,
  selectedPages: SelectedPage[],
): Promise<ScreenshotCapture[]> {
  const opts: { apiKey: string; apiUrl?: string } = {
    apiKey: cfg.firecrawlApiKey,
  };
  if (cfg.firecrawlApiUrl) opts.apiUrl = cfg.firecrawlApiUrl;
  const app = new Firecrawl(opts);
  const dir = path.join(cfg.workDir, "screenshots");
  fs.mkdirSync(dir, { recursive: true });

  const results: ScreenshotCapture[] = [];

  for (let i = 0; i < selectedPages.length; i++) {
    const page = selectedPages[i]!;
    const dest = path.join(dir, safeFilename(page.url, i));
    log.info(`screenshot ${i + 1}/${selectedPages.length}`, {
      url: page.url,
      viewport: `${VIEWPORT.width}x${VIEWPORT.height}`,
    });

    let lastErr: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const doc = await withRetries(() => scrapeViewport(app, page.url), {
          label: "Firecrawl viewport scrape",
          attempts: 4,
        });
        const shotUrl = extractScreenshotUrl(doc);
        if (!shotUrl) {
          throw new Error(
            `No screenshot URL in Firecrawl response: ${truncate(JSON.stringify(doc), 300)}`,
          );
        }
        const saved = await withRetries(() => downloadToFile(shotUrl, dest), {
          label: "screenshot download",
          attempts: 3,
        });
        results.push({
          url: page.url,
          reason: page.reason,
          localPath: dest,
          bytes: saved.bytes,
        });
        log.info("screenshot saved", { path: dest, bytes: saved.bytes });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        log.warn(`screenshot attempt ${attempt} failed`, {
          error: err instanceof Error ? err.message : String(err),
        });
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
      }
    }

    if (lastErr) {
      throw new Error(
        `Failed to screenshot ${page.url}: ${lastErr instanceof Error ? lastErr.message : lastErr}`,
      );
    }
  }

  return results;
}
