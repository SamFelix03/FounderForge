import {
  getJobStore,
  getMarketplaceLinkStore,
  type MarketplaceLink,
} from "@founderforge/db";
import type { JobRecord, ServiceName } from "@founderforge/schemas";
import { createLogger } from "@founderforge/observability";
import type { BridgeConfig } from "./config.js";
import { isWalletReady, runOnchainOs, tryParseJson } from "./onchainos.js";
import {
  extractUrls,
  inferServiceFromText,
  isAcceptedX402Task,
  isEscrowPaymentMode,
  isX402PaymentMode,
  parseActiveTasks,
  type OkxActiveTask,
} from "./tasks.js";

const log = createLogger("marketplace-bridge");

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

type FfPollJob = {
  id: string;
  service: string;
  status: string;
  artifacts?: Array<{ type?: string; url?: string }>;
  error?: string;
  error_code?: string;
  marketplace_job_id?: string;
};

export class MarketplaceBridge {
  constructor(private readonly cfg: BridgeConfig) {}

  private cliEnv(): NodeJS.ProcessEnv | undefined {
    if (!this.cfg.onchainosHome) return undefined;
    return { ONCHAINOS_HOME: this.cfg.onchainosHome };
  }

  async tick(): Promise<void> {
    const walletReady = await isWalletReady(this.cfg.onchainosBin);
    if (!walletReady) {
      log.warn("onchainos wallet not ready — skipping tick (run ff-onchainos-login)", {
        onchainos_home: this.cfg.onchainosHome || null,
      });
      if (this.cfg.requireWallet) {
        throw new Error("onchainos_wallet_not_ready");
      }
      return;
    }

    const tasks = await this.fetchAcceptedTasks();
    log.info("bridge tick", { accepted: tasks.length, dry_run: this.cfg.dryRun });

    for (const task of tasks) {
      try {
        await this.handleTask(task);
      } catch (err) {
        log.warn("task handle failed", {
          okx_job_id: task.jobId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Also advance links already correlated but still pending delivery
    const pending = await getMarketplaceLinkStore().listPending();
    for (const link of pending) {
      if (tasks.some((t) => t.jobId === link.okx_job_id)) continue;
      try {
        await this.deliverIfTerminal(link);
      } catch (err) {
        log.warn("pending link deliver failed", {
          okx_job_id: link.okx_job_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private async fetchAcceptedTasks(): Promise<OkxActiveTask[]> {
    const results: OkxActiveTask[] = [];

    const tip = await runOnchainOs(
      this.cfg.onchainosBin,
      ["agent", "task-in-progress", "--agent-ids", this.cfg.aspAgentId],
      { dryRun: false, timeoutMs: 60_000, env: this.cliEnv() },
    );
    if (tip.ok) {
      const parsed = tryParseJson(tip.stdout) ?? tryParseJson(tip.stderr);
      results.push(...parseActiveTasks(parsed, this.cfg.aspAgentId));
    } else {
      log.warn("task-in-progress failed", {
        stderr: tip.stderr.slice(0, 500),
        exit: tip.exitCode,
      });
    }

    const active = await runOnchainOs(
      this.cfg.onchainosBin,
      ["agent", "active-tasks", "--role", "asp"],
      { dryRun: false, timeoutMs: 60_000, env: this.cliEnv() },
    );
    if (active.ok) {
      const parsed = tryParseJson(active.stdout) ?? tryParseJson(active.stderr);
      results.push(...parseActiveTasks(parsed, this.cfg.aspAgentId));
    } else {
      log.warn("active-tasks failed", {
        stderr: active.stderr.slice(0, 500),
        exit: active.exitCode,
      });
    }

    const byId = new Map<string, OkxActiveTask>();
    for (const t of results) {
      if (!byId.has(t.jobId)) byId.set(t.jobId, t);
    }
    return [...byId.values()].filter(isAcceptedX402Task);
  }

  private async handleTask(task: OkxActiveTask): Promise<void> {
    const links = getMarketplaceLinkStore();
    let link = await links.get(task.jobId);
    if (link?.delivery_status === "delivered" || link?.delivery_status === "skipped") {
      return;
    }

    if (!link) {
      const ffJob = await this.correlate(task);
      if (!ffJob) {
        log.info("no FounderForge job yet for OKX task", { okx_job_id: task.jobId });
        return;
      }
      link = await links.upsertLink({
        okx_job_id: task.jobId,
        founderforge_job_id: ffJob.id,
        asp_agent_id: this.cfg.aspAgentId,
      });
      log.info("correlated marketplace task", {
        okx_job_id: task.jobId,
        founderforge_job_id: ffJob.id,
        payment_mode: task.paymentMode ?? null,
      });
    }

    // x402 (FounderForge A2MCP): ASP must NOT call deliver/submit. Buyer polls FF
    // artifacts then runs `onchainos agent complete`. Escrow is the only mode that
    // supports provider deliver.
    if (isX402PaymentMode(task) && !isEscrowPaymentMode(task)) {
      const job = await this.pollFfJob(link.founderforge_job_id);
      if (!job || !TERMINAL.has(job.status)) {
        log.info("x402 task waiting for FounderForge terminal (buyer will complete)", {
          okx_job_id: task.jobId,
          founderforge_job_id: link.founderforge_job_id,
          status: job?.status ?? "unknown",
        });
        return;
      }
      await links.markSkipped(
        task.jobId,
        "x402: ASP deliver unsupported; buyer polls artifacts then agent complete",
      );
      log.info("x402 task FF terminal — skipped ASP deliver (buyer completes)", {
        okx_job_id: task.jobId,
        founderforge_job_id: job.id,
        ff_status: job.status,
      });
      return;
    }

    await this.deliverIfTerminal(link);
  }

  private async correlate(task: OkxActiveTask): Promise<JobRecord | undefined> {
    const store = getJobStore();

    const byMarketplace = await store.getByMarketplaceJobId(task.jobId);
    if (byMarketplace) return byMarketplace;

    const blob = [
      task.description ?? "",
      task.title ?? "",
      task.serviceName ?? "",
      JSON.stringify(task.raw),
    ].join("\n");
    const urls = extractUrls(blob);
    const serviceGuess =
      (inferServiceFromText(blob) as ServiceName | undefined) ?? "social-listening";

    for (const url of urls) {
      // Prefer social-listening / promo / outreach / competitor URL fields
      const hit = await store.findRecentByProductUrl({
        service: serviceGuess,
        productUrl: url,
        withinMs: this.cfg.correlateWithinMs,
      });
      if (hit) return hit;

      for (const service of [
        "social-listening",
        "promo-video",
        "outreach",
        "competitor-research",
        "automated-product-demo",
      ] as ServiceName[]) {
        if (service === serviceGuess) continue;
        const alt = await store.findRecentByProductUrl({
          service,
          productUrl: url,
          withinMs: this.cfg.correlateWithinMs,
        });
        if (alt) return alt;
      }
    }

    return undefined;
  }

  private async pollFfJob(jobId: string): Promise<FfPollJob | undefined> {
    const url = `${this.cfg.apiBase}/v1/jobs/${jobId}`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.status === 404) return undefined;
    if (!res.ok) {
      throw new Error(`ff_poll_http_${res.status}`);
    }
    return (await res.json()) as FfPollJob;
  }

  private async deliverIfTerminal(link: MarketplaceLink): Promise<void> {
    if (link.delivery_status === "delivered" || link.delivery_status === "skipped") {
      return;
    }

    const job = await this.pollFfJob(link.founderforge_job_id);
    if (!job) {
      log.warn("linked FounderForge job missing", {
        okx_job_id: link.okx_job_id,
        founderforge_job_id: link.founderforge_job_id,
      });
      return;
    }
    if (!TERMINAL.has(job.status)) {
      log.info("waiting for FounderForge terminal status", {
        okx_job_id: link.okx_job_id,
        founderforge_job_id: job.id,
        status: job.status,
      });
      return;
    }

    const text = buildDeliverableText(job);
    const message =
      job.status === "completed"
        ? "FounderForge job completed — please review artifacts"
        : `FounderForge job ${job.status} — see deliverable text for error_code`;

    const result = await runOnchainOs(
      this.cfg.onchainosBin,
      [
        "agent",
        "deliver",
        link.okx_job_id,
        "--agent-id",
        this.cfg.aspAgentId,
        "--deliverable-text",
        text,
        "--message",
        message,
      ],
      { dryRun: this.cfg.dryRun, timeoutMs: 180_000, env: this.cliEnv() },
    );

    const links = getMarketplaceLinkStore();
    if (result.ok) {
      await links.markDelivered(link.okx_job_id);
      log.info("delivered marketplace task", {
        okx_job_id: link.okx_job_id,
        founderforge_job_id: job.id,
        ff_status: job.status,
        dry_run: this.cfg.dryRun,
      });
    } else {
      const err = (result.stderr || result.stdout || "deliver_failed").slice(0, 2000);
      // If already submitted/completed on-chain, treat as success
      if (/submitted|already|completed|close/i.test(err)) {
        await links.markDelivered(link.okx_job_id);
        log.info("deliver skipped — already terminal on-chain", {
          okx_job_id: link.okx_job_id,
        });
        return;
      }
      // x402 rejects ASP deliver — mark skipped so we stop retrying
      if (/paymentMode\s*=\s*3|x402.*deliver|deliver\/submit is only supported for escrow/i.test(err)) {
        await links.markSkipped(
          link.okx_job_id,
          "x402: ASP deliver unsupported; buyer polls artifacts then agent complete",
        );
        log.info("x402 reject on deliver — marked skipped", {
          okx_job_id: link.okx_job_id,
        });
        return;
      }
      await links.markDeliveryFailed(link.okx_job_id, err);
      log.warn("deliver failed", {
        okx_job_id: link.okx_job_id,
        error: err.slice(0, 500),
        exit: result.exitCode,
      });
    }
  }
}

export function buildDeliverableText(job: FfPollJob): string {
  if (job.status === "completed") {
    const urls = (job.artifacts ?? [])
      .map((a) => a.url)
      .filter((u): u is string => Boolean(u));
    const lines = [
      `FounderForge job ${job.id} (${job.service}) completed.`,
      urls.length ? `Artifacts:` : "No artifact URLs on poll response.",
      ...urls.map((u) => `- ${u}`),
    ];
    return lines.join("\n");
  }

  return [
    `FounderForge job ${job.id} (${job.service}) ended with status=${job.status}.`,
    job.error_code ? `error_code: ${job.error_code}` : undefined,
    job.error ? `error: ${job.error}` : undefined,
    "Buyer may reject/refund; ASP delivered failure text so the task leaves accepted limbo.",
  ]
    .filter(Boolean)
    .join("\n");
}
