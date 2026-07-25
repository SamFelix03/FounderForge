import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@founderforge/observability";
import type { ScreencastFrame, StepResult } from "./browser.js";
import { runFfmpeg, runFfprobeDuration } from "./media.js";
import { localTempDemoPath } from "./storage.js";

const log = createLogger("apd.assemble");

export interface NarrationClip {
  stepId: number;
  text: string;
  path: string;
  duration: number;
}

function sliceFramesForStep(
  frames: ScreencastFrame[],
  startMs: number,
  endMs: number,
): ScreencastFrame[] {
  const selected = frames.filter((f) => f.ts >= startMs && f.ts < endMs);
  if (selected.length) return selected;
  const prior = frames.filter((f) => f.ts <= startMs);
  if (prior.length) return [prior[prior.length - 1]!];
  if (frames.length) {
    return [
      frames.reduce((best, f) =>
        Math.abs(f.ts - startMs) < Math.abs(best.ts - startMs) ? f : best,
      ),
    ];
  }
  return [];
}

function buildVideoFromJpegs(jpegPaths: string[], outMp4: string, fps: number): void {
  const listFile = `${outMp4}.frames.txt`;
  const duration = 1 / fps;
  const lines: string[] = [];
  for (const p of jpegPaths) {
    const escaped = path.resolve(p).replace(/\\/g, "/").replace(/'/g, "'\\''");
    lines.push(`file '${escaped}'`);
    lines.push(`duration ${duration.toFixed(6)}`);
  }
  if (jpegPaths.length) {
    const last = path
      .resolve(jpegPaths[jpegPaths.length - 1]!)
      .replace(/\\/g, "/")
      .replace(/'/g, "'\\''");
    lines.push(`file '${last}'`);
  }
  fs.writeFileSync(listFile, `${lines.join("\n")}\n`);

  runFfmpeg(
    [
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      // libx264 requires even width/height (screencast can be odd, e.g. 1920x993)
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      outMp4,
    ],
    `frames→${path.basename(outMp4)}`,
  );
}

export async function assembleDemo(
  frames: ScreencastFrame[],
  stepResults: StepResult[],
  clips: NarrationClip[],
  workDir: string,
  localOutput?: string,
): Promise<{ localPath: string; duration_seconds: number }> {
  const framesDir = path.join(workDir, "frames");
  const segmentsDir = path.join(workDir, "segments");
  fs.mkdirSync(segmentsDir, { recursive: true });

  if (
    !fs.existsSync(framesDir) ||
    fs.readdirSync(framesDir).filter((f) => f.endsWith(".jpg")).length === 0
  ) {
    fs.mkdirSync(framesDir, { recursive: true });
    frames.forEach((frame, i) => {
      fs.writeFileSync(
        path.join(framesDir, `frame_${String(i + 1).padStart(6, "0")}.jpg`),
        frame.data,
      );
    });
  }

  const clipById = Object.fromEntries(clips.map((c) => [c.stepId, c]));
  const finalSegments: string[] = [];

  for (const step of stepResults) {
    log.info(`assemble step ${step.id}`);
    const clip = clipById[step.id];
    if (!clip) throw new Error(`Missing narration clip for step ${step.id}`);

    const selected = sliceFramesForStep(frames, step.start, step.end);
    const videoDur = Math.max(step.duration || (step.end - step.start) / 1000, 1 / 30);
    if (!selected.length) {
      throw new Error(
        `No frames available to build video for step ${step.id}. Screencast may have failed.`,
      );
    }

    const stepFrameDir = path.join(workDir, "step_frames", `step_${step.id}`);
    fs.mkdirSync(stepFrameDir, { recursive: true });
    const jpegPaths = selected.map((frame, i) => {
      const p = path.join(stepFrameDir, `img_${String(i + 1).padStart(6, "0")}.jpg`);
      fs.writeFileSync(p, frame.data);
      return p;
    });

    let fps = jpegPaths.length / videoDur;
    fps = Math.max(5, Math.min(30, fps));
    log.info("step frame stats", {
      stepId: step.id,
      frames: jpegPaths.length,
      step_dur: Number(videoDur.toFixed(2)),
      audio_dur: Number(clip.duration.toFixed(2)),
      fps: Number(fps.toFixed(2)),
    });

    const rawMp4 = path.join(segmentsDir, `step_${step.id}_raw.mp4`);
    buildVideoFromJpegs(jpegPaths, rawMp4, fps);
    const rawDur = runFfprobeDuration(rawMp4);

    let paddedMp4 = path.join(segmentsDir, `step_${step.id}_padded.mp4`);
    const pad = clip.duration - rawDur;
    if (pad > 0.05) {
      log.info("padding last frame", { stepId: step.id, pad_s: Number(pad.toFixed(2)) });
      runFfmpeg(
        [
          "-i",
          rawMp4,
          "-vf",
          `tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)}`,
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          paddedMp4,
        ],
        `pad step ${step.id}`,
      );
    } else {
      paddedMp4 = rawMp4;
    }

    const finalMp4 = path.join(segmentsDir, `step_${step.id}_final.mp4`);
    runFfmpeg(
      [
        "-i",
        paddedMp4,
        "-i",
        clip.path,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        finalMp4,
      ],
      `mux step ${step.id}`,
    );
    const muxDur = runFfprobeDuration(finalMp4);
    log.info("segment ready", {
      file: path.basename(finalMp4),
      duration_s: Number(muxDur.toFixed(2)),
    });
    finalSegments.push(finalMp4);
  }

  const filelist = path.join(workDir, "filelist.txt");
  fs.writeFileSync(
    filelist,
    `${finalSegments
      .map((p) => {
        const escaped = path.resolve(p).replace(/\\/g, "/").replace(/'/g, "'\\''");
        return `file '${escaped}'`;
      })
      .join("\n")}\n`,
  );

  const localOut = localOutput || localTempDemoPath(workDir);
  log.info("concatenating segments", { count: finalSegments.length, out: localOut });
  fs.mkdirSync(path.dirname(localOut), { recursive: true });

  try {
    runFfmpeg(
      ["-f", "concat", "-safe", "0", "-i", filelist, "-c", "copy", localOut],
      "concat final (copy)",
    );
  } catch (copyErr) {
    log.warn("concat -c copy failed; re-encoding", {
      error: copyErr instanceof Error ? copyErr.message : String(copyErr),
    });
    runFfmpeg(
      [
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        filelist,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        localOut,
      ],
      "concat final (re-encode)",
    );
  }

  const finalDur = runFfprobeDuration(localOut);
  log.info("assembled locally", {
    path: localOut,
    duration_s: Number(finalDur.toFixed(2)),
  });
  return { localPath: localOut, duration_seconds: finalDur };
}
