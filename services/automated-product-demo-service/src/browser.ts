import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type CDPSession } from "playwright";
import Firecrawl from "firecrawl";
import { createLogger } from "@founderforge/observability";
import { pick, sleep, truncate } from "./util.js";

const log = createLogger("apd.browser");

export interface ScreencastFrame {
  ts: number;
  data: Buffer;
}

export interface StepResult {
  id: number;
  instruction: string;
  start: number;
  end: number;
  output: string;
  success: boolean;
  liveViewUrl: string | null;
  error: string | null;
  duration: number;
}

/** Firecrawl can 404 "Job not found" right after scrape (DB replica lag). */
function isTransientInteractError(err: unknown): boolean {
  const e = err as {
    message?: string;
    statusCode?: number;
    status?: number;
    response?: { status?: number };
  };
  const msg = String(e?.message || err || "");
  const status = e?.statusCode ?? e?.status ?? e?.response?.status;
  if (status === 404 || status === 409) return true;
  return /job not found|not found|replay context unavailable|try again/i.test(msg);
}

export class ScreencastRecorder {
  frames: ScreencastFrame[] = [];
  browser: Browser | null = null;
  cdp: CDPSession | null = null;
  running = false;

  async start(cdpUrl: string): Promise<void> {
    log.info("connecting Playwright over CDP", { cdpUrl: truncate(cdpUrl, 80) });
    this.browser = await chromium.connectOverCDP(cdpUrl);
    const context = this.browser.contexts()[0];
    if (!context) throw new Error("CDP browser has no contexts");
    const page = context.pages()[0];
    if (!page) throw new Error("CDP browser context has no pages");
    log.info("attached page", { url: page.url() });

    this.cdp = await context.newCDPSession(page);
    this.running = true;

    this.cdp.on("Page.screencastFrame", async (frame: { data: string; sessionId?: number }) => {
      if (!this.running) return;
      try {
        const data = Buffer.from(frame.data, "base64");
        this.frames.push({ ts: Date.now(), data });
        if (frame.sessionId !== undefined && this.cdp) {
          await this.cdp.send("Page.screencastFrameAck", {
            sessionId: frame.sessionId,
          });
        }
      } catch (err) {
        log.warn("screencast frame error", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 90,
      everyNthFrame: 1,
    });
    log.info("CDP screencast started");
  }

  async stop(): Promise<ScreencastFrame[]> {
    this.running = false;
    try {
      if (this.cdp) {
        try {
          await this.cdp.send("Page.stopScreencast");
        } catch (err) {
          log.warn("stopScreencast warning", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } finally {
      try {
        if (this.browser) await this.browser.close();
      } catch (err) {
        log.warn("browser.close warning", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.cdp = null;
      this.browser = null;
    }
    log.info("screencast stopped", { frames: this.frames.length });
    return this.frames;
  }
}

export class BrowserExecutor {
  static WARMUP_PROMPT =
    "Confirm the page has fully loaded and is interactive. Do not click, type, scroll, or navigate. Reply briefly when ready.";

  private app: Firecrawl;
  recorder = new ScreencastRecorder();
  scrapeId: string | null = null;
  private interactionStopped = false;
  session: {
    scrapeId: string | null;
    cdpUrl: string | null;
    liveViewUrl: string | null;
    frames: ScreencastFrame[];
    steps: StepResult[];
  } = {
    scrapeId: null,
    cdpUrl: null,
    liveViewUrl: null,
    frames: [],
    steps: [],
  };

  constructor(apiKey: string) {
    this.app = new Firecrawl({ apiKey });
  }

  async scrape(url: string): Promise<string> {
    log.info("Firecrawl scrape", { url });
    const t0 = Date.now();
    const result = (await this.app.scrape(url, { formats: ["markdown"] })) as Record<
      string,
      unknown
    >;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

    const metadata = (result?.metadata || result?.metadata_typed || {}) as Record<
      string,
      unknown
    >;
    const scrapeId =
      pick(metadata, "scrapeId", "scrape_id") ||
      pick(result, "id", "scrapeId", "scrape_id");
    if (!scrapeId) {
      throw new Error(
        "Scrape response missing metadata.scrapeId — cannot start interact session",
      );
    }

    this.scrapeId = String(scrapeId);
    this.session.scrapeId = this.scrapeId;
    this.interactionStopped = false;
    const title = pick(metadata, "title") || "";
    const source =
      pick(metadata, "sourceURL", "sourceUrl", "source_url", "url") || url;

    log.info("scrape OK", {
      elapsed_s: elapsed,
      scrapeId: this.scrapeId,
      title: truncate(String(title), 100),
      source: String(source),
    });
    return this.scrapeId;
  }

  async interactWithRetry(
    prompt: string,
    { label = "interact", attempts = 6 }: { label?: string; attempts?: number } = {},
  ): Promise<Record<string, unknown>> {
    if (!this.scrapeId) throw new Error("Call scrape() before interact");
    let lastErr: unknown = null;
    for (let i = 1; i <= attempts; i++) {
      try {
        if (i > 1) {
          const delayMs = Math.min(8000, 1000 * 2 ** (i - 2));
          log.warn(`${label} retry`, { attempt: i, attempts, delayMs });
          await sleep(delayMs);
        }
        return (await this.app.interact(this.scrapeId, { prompt })) as Record<
          string,
          unknown
        >;
      } catch (err) {
        lastErr = err;
        if (!isTransientInteractError(err) || i === attempts) break;
        log.warn(`${label} transient error`, {
          error: truncate(String((err as Error)?.message || err), 160),
        });
      }
    }
    throw lastErr;
  }

  async warmup(): Promise<string> {
    if (!this.scrapeId) throw new Error("Call scrape() before warmup()");
    log.info("warm-up interact");
    log.info("waiting for scrape job visibility", { delay_ms: 2000 });
    await sleep(2000);
    const t0 = Date.now();
    const response = await this.interactWithRetry(BrowserExecutor.WARMUP_PROMPT, {
      label: "warm-up",
      attempts: 6,
    });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

    const cdpUrl = pick(response, "cdpUrl", "cdp_url");
    const liveViewUrl = pick(response, "liveViewUrl", "live_view_url");
    const output = pick(response, "output") || "";
    const success = pick(response, "success") !== false;

    if (!cdpUrl) {
      throw new Error(
        "Warm-up interact did not return cdpUrl — cannot attach screencast recorder",
      );
    }

    this.session.cdpUrl = String(cdpUrl);
    this.session.liveViewUrl = liveViewUrl ? String(liveViewUrl) : null;

    log.info("warm-up OK", {
      elapsed_s: elapsed,
      success,
      cdpUrl: truncate(String(cdpUrl), 90),
      output: truncate(String(output)),
    });
    return String(cdpUrl);
  }

  async startRecording(cdpUrl: string): Promise<void> {
    await this.recorder.start(cdpUrl);
    await sleep(750);
  }

  async runSteps(
    steps: Array<{ id: number; instruction: string }>,
  ): Promise<StepResult[]> {
    if (!this.scrapeId) throw new Error("Call scrape() before runSteps()");
    const results: StepResult[] = [];

    for (const step of steps) {
      const stepId = Number(step.id);
      const instruction = String(step.instruction);
      log.info(`step ${stepId} interact`, { instruction });

      const start = Date.now();
      let error: string | null = null;
      let output = "";
      let success = false;
      let liveViewUrl: string | null = null;

      try {
        const response = await this.interactWithRetry(instruction, {
          label: `step ${stepId}`,
          attempts: 4,
        });
        const end = Date.now();
        output = String(pick(response, "output") || "");
        success = pick(response, "success") !== false;
        liveViewUrl = (pick(response, "liveViewUrl", "live_view_url") as string) || null;
        const err = pick(response, "error");
        if (err) error = String(err);

        log.info(`step ${stepId} done`, {
          elapsed_s: ((end - start) / 1000).toFixed(2),
          success,
          frames: this.recorder.frames.length,
          output: truncate(output, 320),
        });

        const result: StepResult = {
          id: stepId,
          instruction,
          start,
          end,
          output,
          success: success && !error,
          liveViewUrl: liveViewUrl ? String(liveViewUrl) : null,
          error,
          duration: (end - start) / 1000,
        };
        results.push(result);
        this.session.steps.push(result);
      } catch (exc) {
        const end = Date.now();
        error = String((exc as Error)?.message || exc);
        log.error(`step ${stepId} failed`, { error, elapsed_s: ((end - start) / 1000).toFixed(2) });
        const result: StepResult = {
          id: stepId,
          instruction,
          start,
          end,
          output: "",
          success: false,
          liveViewUrl: null,
          error,
          duration: (end - start) / 1000,
        };
        results.push(result);
        this.session.steps.push(result);
      }
    }

    return results;
  }

  async stopRecording(): Promise<ScreencastFrame[]> {
    const frames = await this.recorder.stop();
    this.session.frames = frames;
    return frames;
  }

  async closeSession(reason = "cleanup"): Promise<void> {
    log.info("closing browser session", {
      reason,
      scrapeId: this.scrapeId ?? "(none)",
    });

    try {
      if (this.recorder.running || this.recorder.browser) {
        await this.stopRecording();
      }
    } catch (err) {
      log.warn("recorder stop warning", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await this.stopInteraction();
  }

  async stopInteraction(): Promise<void> {
    if (!this.scrapeId || this.interactionStopped) {
      return;
    }

    log.info("stopInteraction", { scrapeId: this.scrapeId });
    try {
      const result = (await this.app.stopInteraction(this.scrapeId)) as Record<
        string,
        unknown
      >;
      this.interactionStopped = true;
      log.info("interaction session stopped", {
        credits: result?.creditsBilled ?? result?.credits_billed,
        durationMs: result?.sessionDurationMs ?? result?.session_duration_ms,
      });
    } catch (err) {
      const msg = String((err as Error)?.message || err);
      if (/not found|404|already|no.*session/i.test(msg)) {
        this.interactionStopped = true;
        log.info("session already closed", { detail: truncate(msg, 160) });
        return;
      }
      try {
        log.warn("stopInteraction retry");
        await this.app.stopInteraction(this.scrapeId);
        this.interactionStopped = true;
        log.info("interaction session stopped (retry)");
      } catch (err2) {
        log.error("stopInteraction FAILED", {
          error: truncate(String((err2 as Error)?.message || err2), 240),
        });
      }
    }
  }

  saveFrames(framesDir: string): string[] {
    fs.mkdirSync(framesDir, { recursive: true });
    const paths: string[] = [];
    this.session.frames.forEach((frame, i) => {
      const filePath = path.join(
        framesDir,
        `frame_${String(i + 1).padStart(6, "0")}.jpg`,
      );
      fs.writeFileSync(filePath, frame.data);
      paths.push(filePath);
    });
    const meta = this.session.frames.map((f, i) => ({
      index: i + 1,
      ts: f.ts,
      path: path.basename(paths[i]!),
    }));
    fs.writeFileSync(
      path.join(path.dirname(framesDir), "frames_meta.json"),
      JSON.stringify(meta, null, 2),
    );
    log.info("wrote JPEG frames", { count: paths.length, dir: framesDir });
    return paths;
  }

  saveStepLog(filePath: string): void {
    const payload = {
      scrapeId: this.session.scrapeId,
      cdpUrl: this.session.cdpUrl,
      liveViewUrl: this.session.liveViewUrl,
      frameCount: this.session.frames.length,
      steps: this.session.steps,
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
    log.info("wrote step_log", { path: filePath });
  }
}
