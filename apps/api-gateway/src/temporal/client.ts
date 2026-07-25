import { Connection, Client } from "@temporalio/client";
import { createLogger } from "@founderforge/observability";

const log = createLogger("temporal.client");

export function temporalConfig() {
  return {
    address: process.env.TEMPORAL_ADDRESS?.trim() || "localhost:7233",
    namespace: process.env.TEMPORAL_NAMESPACE?.trim() || "default",
    taskQueue: process.env.TEMPORAL_TASK_QUEUE?.trim() || "founderforge",
  };
}

let clientPromise: Promise<Client> | undefined;

export async function getTemporalClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { address, namespace } = temporalConfig();
      const connection = await Connection.connect({ address });
      const client = new Client({ connection, namespace });
      log.info("temporal client connected", { address, namespace });
      return client;
    })();
  }
  return clientPromise;
}

export async function startCompetitorResearchWorkflow(input: {
  job_id: string;
  product_name: string;
  product_url?: string;
}): Promise<string> {
  const client = await getTemporalClient();
  const { taskQueue } = temporalConfig();
  const handle = await client.workflow.start("competitorResearchWorkflow", {
    taskQueue,
    workflowId: `competitor-research:${input.job_id}`,
    args: [input],
  });
  log.info("started competitor research workflow", {
    workflow_id: handle.workflowId,
    job_id: input.job_id,
  });
  return handle.workflowId;
}

export async function startAutomatedProductDemoWorkflow(input: {
  job_id: string;
  website_url: string;
  script: string;
}): Promise<string> {
  const client = await getTemporalClient();
  const { taskQueue } = temporalConfig();
  const handle = await client.workflow.start("automatedProductDemoWorkflow", {
    taskQueue,
    workflowId: `automated-product-demo:${input.job_id}`,
    args: [input],
  });
  log.info("started automated product demo workflow", {
    workflow_id: handle.workflowId,
    job_id: input.job_id,
  });
  return handle.workflowId;
}

/** Test hook to replace client factory. */
export function resetTemporalClientForTests(): void {
  clientPromise = undefined;
}

export type StartWorkflowFn = typeof startCompetitorResearchWorkflow;

let startFn: StartWorkflowFn = startCompetitorResearchWorkflow;

export function setStartCompetitorResearchWorkflowForTests(fn: StartWorkflowFn | undefined): void {
  startFn = fn ?? startCompetitorResearchWorkflow;
}

export async function enqueueCompetitorResearch(input: {
  job_id: string;
  product_name: string;
  product_url?: string;
}): Promise<string> {
  return startFn(input);
}

export type StartAutomatedProductDemoFn = typeof startAutomatedProductDemoWorkflow;

let startApdFn: StartAutomatedProductDemoFn = startAutomatedProductDemoWorkflow;

export function setStartAutomatedProductDemoWorkflowForTests(
  fn: StartAutomatedProductDemoFn | undefined,
): void {
  startApdFn = fn ?? startAutomatedProductDemoWorkflow;
}

export async function enqueueAutomatedProductDemo(input: {
  job_id: string;
  website_url: string;
  script: string;
}): Promise<string> {
  return startApdFn(input);
}

export async function startPromoVideoWorkflow(input: {
  job_id: string;
  product_url: string;
  duration?: number;
  resolution?: string;
  max_pages?: number;
}): Promise<string> {
  const client = await getTemporalClient();
  const { taskQueue } = temporalConfig();
  const handle = await client.workflow.start("promoVideoWorkflow", {
    taskQueue,
    workflowId: `promo-video:${input.job_id}`,
    args: [input],
  });
  log.info("started promo video workflow", {
    workflow_id: handle.workflowId,
    job_id: input.job_id,
  });
  return handle.workflowId;
}

export type StartPromoVideoFn = typeof startPromoVideoWorkflow;

let startPromoFn: StartPromoVideoFn = startPromoVideoWorkflow;

export function setStartPromoVideoWorkflowForTests(
  fn: StartPromoVideoFn | undefined,
): void {
  startPromoFn = fn ?? startPromoVideoWorkflow;
}

export async function enqueuePromoVideo(input: {
  job_id: string;
  product_url: string;
  duration?: number;
  resolution?: string;
  max_pages?: number;
}): Promise<string> {
  return startPromoFn(input);
}

export async function startSocialListeningWorkflow(input: {
  job_id: string;
  product_url: string;
  live?: boolean;
  max_posts?: number;
}): Promise<string> {
  const client = await getTemporalClient();
  const { taskQueue } = temporalConfig();
  const handle = await client.workflow.start("socialListeningWorkflow", {
    taskQueue,
    workflowId: `social-listening:${input.job_id}`,
    args: [input],
  });
  log.info("started social listening workflow", {
    workflow_id: handle.workflowId,
    job_id: input.job_id,
  });
  return handle.workflowId;
}

export type StartSocialListeningFn = typeof startSocialListeningWorkflow;

let startSocialListeningFn: StartSocialListeningFn = startSocialListeningWorkflow;

export function setStartSocialListeningWorkflowForTests(
  fn: StartSocialListeningFn | undefined,
): void {
  startSocialListeningFn = fn ?? startSocialListeningWorkflow;
}

export async function enqueueSocialListening(input: {
  job_id: string;
  product_url: string;
  live?: boolean;
  max_posts?: number;
}): Promise<string> {
  return startSocialListeningFn(input);
}
