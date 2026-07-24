import { getJobStore } from "@founderforge/db";
import type { CostLine, JobArtifact, JobRecord } from "@founderforge/schemas";
import { createLogger } from "@founderforge/observability";

const log = createLogger("activities.jobs");

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

async function notifyCallback(job: JobRecord): Promise<void> {
  if (!job.callback_url) return;
  try {
    const res = await fetch(job.callback_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        job_id: job.id,
        service: job.service,
        status: job.status,
        artifacts: job.artifacts,
        cost_breakdown: job.cost_breakdown,
        error: job.error,
        list_price_usd: job.list_price_usd,
      }),
    });
    if (!res.ok) {
      log.warn("callback_url returned non-2xx", { job_id: job.id, status: res.status });
    }
  } catch (err) {
    log.warn("callback_url failed", {
      job_id: job.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
