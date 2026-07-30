export type OkxActiveTask = {
  jobId: string;
  status?: string | number;
  paymentMode?: string | number;
  agentId?: string | number;
  counterpartyAgentId?: string | number;
  myRole?: string;
  description?: string;
  title?: string;
  serviceName?: string;
  raw: Record<string, unknown>;
};

const URL_RE = /https?:\/\/[^\s"'<>]+/gi;

export function extractUrls(text: string): string[] {
  const matches = text.match(URL_RE) ?? [];
  return [...new Set(matches.map((u) => u.replace(/[),.;]+$/g, "")))];
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return undefined;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

function normalizeStatus(v: unknown): string | number | undefined {
  if (typeof v === "string" || typeof v === "number") return v;
  return undefined;
}

/** Flatten active-tasks / task-in-progress CLI JSON into task rows. */
export function parseActiveTasks(payload: unknown, aspAgentId: string): OkxActiveTask[] {
  const out: OkxActiveTask[] = [];
  const seen = new Set<string>();

  const visit = (node: unknown): void => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const obj = asRecord(node);
    if (!obj) return;

    // Nested containers commonly returned by OKX CLIs
    for (const key of [
      "data",
      "list",
      "tasks",
      "providerTasks",
      "buyerTasks",
      "activeTasks",
      "items",
      "result",
    ]) {
      if (key in obj) visit(obj[key]);
    }

    const jobId = pickString(obj, [
      "jobId",
      "job_id",
      "id",
      "taskId",
      "task_id",
    ]);
    if (!jobId || seen.has(jobId)) return;

    // Prefer rows that look like task objects (have status / paymentMode / description)
    const status = normalizeStatus(obj.status ?? obj.jobStatus ?? obj.taskStatus);
    const paymentMode = normalizeStatus(
      obj.paymentMode ?? obj.payment_mode ?? obj.payMode,
    );
    const description = pickString(obj, [
      "description",
      "desc",
      "taskDescription",
      "content",
      "requirement",
      "title",
    ]);
    const myRole = pickString(obj, ["myRole", "role", "my_role"]);
    const agentId = pickString(obj, [
      "agentId",
      "agent_id",
      "providerAgentId",
      "aspAgentId",
    ]);
    const counterparty = pickString(obj, [
      "counterpartyAgentId",
      "counterparty_agent_id",
      "userAgentId",
    ]);

    const looksLikeTask =
      status !== undefined ||
      paymentMode !== undefined ||
      Boolean(description) ||
      Boolean(obj.serviceName) ||
      Boolean(obj.service_name);

    if (!looksLikeTask) return;

    // Filter to ASP provider side when role/agent metadata is present
    if (myRole && !/asp|provider/i.test(myRole)) return;
    if (agentId && agentId !== aspAgentId && counterparty !== aspAgentId) {
      // Some payloads put ASP id on counterparty when viewing as user — keep if either matches
      const raw = JSON.stringify(obj);
      if (!raw.includes(aspAgentId)) return;
    }

    seen.add(jobId);
    out.push({
      jobId,
      status,
      paymentMode,
      agentId,
      counterpartyAgentId: counterparty,
      myRole,
      description,
      title: pickString(obj, ["title", "name"]),
      serviceName: pickString(obj, ["serviceName", "service_name", "service"]),
      raw: obj,
    });
  };

  visit(payload);
  return out;
}

export function isAcceptedX402Task(task: OkxActiveTask): boolean {
  const status = task.status;
  const statusOk =
    status === 1 ||
    status === "1" ||
    (typeof status === "string" && /accepted/i.test(status));
  if (!statusOk) return false;

  const mode = task.paymentMode;
  if (mode === undefined || mode === null || mode === "") return true; // unknown → try correlate
  return (
    mode === 3 ||
    mode === "3" ||
    (typeof mode === "string" && /x402/i.test(mode))
  );
}

export function inferServiceFromText(text: string): string | undefined {
  const t = text.toLowerCase();
  if (/social[- ]?listening|reddit/.test(t)) return "social-listening";
  if (/promo[- ]?video/.test(t)) return "promo-video";
  if (/competitor/.test(t)) return "competitor-research";
  if (/product[- ]?demo|demo/.test(t)) return "automated-product-demo";
  if (/outreach/.test(t)) return "outreach";
  if (/brand[- ]?kit/.test(t)) return "brand-kit";
  return undefined;
}
