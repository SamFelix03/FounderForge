import { spawn } from "node:child_process";

export type OnchainOsResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export async function runOnchainOs(
  bin: string,
  args: string[],
  opts: {
    timeoutMs?: number;
    dryRun?: boolean;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<OnchainOsResult> {
  if (opts.dryRun) {
    return {
      ok: true,
      exitCode: 0,
      stdout: JSON.stringify({ dry_run: true, args }),
      stderr: "",
    };
  }

  const timeoutMs = opts.timeoutMs ?? 120_000;
  const env = { ...process.env, ...(opts.env ?? {}) };
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({
        ok: false,
        exitCode: null,
        stdout,
        stderr: stderr || "onchainos_timeout",
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        exitCode: null,
        stdout,
        stderr: err.message,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        exitCode: code,
        stdout,
        stderr,
      });
    });
  });
}

/** Returns true when `onchainos wallet status` reports ok. */
export async function isWalletReady(bin: string): Promise<boolean> {
  const result = await runOnchainOs(bin, ["wallet", "status"], { timeoutMs: 30_000 });
  const blob = `${result.stdout}\n${result.stderr}`;
  return /"ok"\s*:\s*true/.test(blob);
}

export function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.lastIndexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    const aStart = trimmed.lastIndexOf("[");
    const aEnd = trimmed.lastIndexOf("]");
    if (aStart >= 0 && aEnd > aStart) {
      try {
        return JSON.parse(trimmed.slice(aStart, aEnd + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
