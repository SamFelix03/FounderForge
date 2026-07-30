import { getJobStore } from "@founderforge/db";
import type { CostLine, JobArtifact, JobRecord } from "@founderforge/schemas";
import { createLogger } from "@founderforge/observability";

const log = createLogger("activities.jobs");

const CALLBACK_TIMEOUT_MS = Number(process.env.CALLBACK_TIMEOUT_MS ?? 10_000);
const CALLBACK_MAX_ATTEMPTS = Number(process.env.CALLBACK_MAX_ATTEMPTS ?? 3);

export async function markJobRunning(jobId: string): Promise<void> {
  await getJobStore().setStatus(jobId, "running");
}

export async function setJobStep(jobId: string, step: string): Promise<void> {
  await getJobStore().setStep(jobId, step);
}

export async function completeJob(
  jobId: string,
  result: { artifacts: JobArtifact[]; cost_breakdown: CostLine[] },
): Promise<void> {
  const store = getJobStore();
  await store.update(jobId, {
    status: "completed",
    artifacts: result.artifacts,
    cost_breakdown: result.cost_breakdown,
    error: null,
    step: "done",
  });
  const job = await store.get(jobId);
  if (job) await notifyCallback(job);
}

export async function failJob(jobId: string, error: string): Promise<void> {
  const store = getJobStore();
  await store.setStatus(jobId, "failed", error);
  const job = await store.get(jobId);
  if (job) await notifyCallback(job);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function callbackPayload(job: JobRecord) {
  return {
    job_id: job.id,
    service: job.service,
    status: job.status,
    artifacts: job.artifacts,
    cost_breakdown: job.cost_breakdown,
    error: job.error,
    error_code: job.error_code,
    list_price_usd: job.list_price_usd,
    ...(job.marketplace_job_id
      ? { marketplace_job_id: job.marketplace_job_id }
      : {}),
    ...(job.marketplace_agent_id
      ? { marketplace_agent_id: job.marketplace_agent_id }
      : {}),
  };
}

async function notifyCallback(job: JobRecord): Promise<void> {
  if (!job.callback_url) return;

  const body = JSON.stringify(callbackPayload(job));
  let lastError = "";

  for (let attempt = 1; attempt <= CALLBACK_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CALLBACK_TIMEOUT_MS);
    try {
      const res = await fetch(job.callback_url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: controller.signal,
      });
      if (res.ok) {
        if (attempt > 1) {
          log.info("callback_url succeeded after retry", {
            job_id: job.id,
            attempt,
          });
        }
        return;
      }
      lastError = `http_${res.status}`;
      log.warn("callback_url returned non-2xx", {
        job_id: job.id,
        status: res.status,
        attempt,
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      log.warn("callback_url failed", {
        job_id: job.id,
        error: lastError,
        attempt,
      });
    } finally {
      clearTimeout(timer);
    }

    if (attempt < CALLBACK_MAX_ATTEMPTS) {
      await sleep(250 * 2 ** (attempt - 1));
    }
  }

  log.warn("callback_url exhausted retries", {
    job_id: job.id,
    attempts: CALLBACK_MAX_ATTEMPTS,
    error: lastError,
  });
}
