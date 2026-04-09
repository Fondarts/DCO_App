import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, mkdirSync } from "fs";
import { writeFile, readFile, rm, copyFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import type { TemplateManifest } from "@dco/shared";
import { getRenderOutputPath, getPreviewOutputPath } from "./storage";

const execFileAsync = promisify(execFile);

const FFMPEG_PATHS = [
  "C:\\Users\\Fede\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.0.1-full_build\\bin\\ffmpeg.exe",
];

function findFFmpeg(): string {
  for (const p of FFMPEG_PATHS) {
    if (existsSync(p)) return p;
  }
  return "ffmpeg";
}

const FFMPEG = findFFmpeg();

// --- Render lock (AE is single-instance) ---
let renderLock: Promise<void> = Promise.resolve();

async function withRenderLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = renderLock;
  let release: () => void;
  renderLock = new Promise<void>((r) => {
    release = r;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release!();
  }
}

// --- Build nexrender assets from manifest + field values ---
function buildNexrenderAssets(
  manifest: TemplateManifest,
  fieldValues: Record<string, unknown>
) {
  const assets: Record<string, unknown>[] = [];

  for (const field of manifest.fields) {
    const value = fieldValues[field.id] ?? field.default;
    if (value === null || value === undefined) continue;

    switch (field.nexrenderAsset.type) {
      case "data":
        assets.push({
          type: "data",
          layerName: field.layerName,
          property: field.nexrenderAsset.property,
          value,
          composition: manifest.composition,
        });
        break;

      case "image":
      case "footage":
      case "audio": {
        if (typeof value === "string" && value.length > 0) {
          const absPath = path.resolve(value);
          assets.push({
            type: field.nexrenderAsset.type === "footage" ? "video" : field.nexrenderAsset.type,
            src: `file:///${absPath.replace(/\\/g, "/").replace(/ /g, "%20")}`,
            layerName: field.layerName,
            composition: manifest.composition,
          });
        }
        break;
      }
    }
  }

  return assets;
}

// --- Run nexrender via child process, return path to rendered file ---
async function runNexrender(
  jobData: Record<string, unknown>,
  timeoutMs: number = 300_000
): Promise<string> {
  const tmpId = randomUUID();
  const jobPath = path.resolve(`storage/tmp/job-${tmpId}.json`);
  const resultPath = path.resolve(`storage/tmp/result-${tmpId}.json`);
  const workerScript = path.resolve("src/lib/nexrender-worker.mjs");

  mkdirSync(path.dirname(jobPath), { recursive: true });
  await writeFile(jobPath, JSON.stringify(jobData));

  try {
    console.log("[nexrender] Spawning worker...");
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [workerScript, jobPath, resultPath],
      {
        timeout: timeoutMs,
        cwd: path.resolve("."),
        windowsHide: true,
      }
    );

    if (stdout) console.log("[nexrender stdout]", stdout.slice(0, 2000));
    if (stderr) console.log("[nexrender stderr]", stderr.slice(0, 2000));

    if (!existsSync(resultPath)) {
      throw new Error("Nexrender worker did not produce a result file");
    }

    const result = JSON.parse(await readFile(resultPath, "utf-8"));

    if (result.error) {
      throw new Error(result.error);
    }

    if (!result.output || !existsSync(result.output)) {
      throw new Error(`Render completed but output not found at: ${result.output}`);
    }

    return result.output;
  } finally {
    await rm(jobPath, { force: true }).catch(() => {});
    await rm(resultPath, { force: true }).catch(() => {});
  }
}

// --- Extract a frame from video using FFmpeg ---
async function extractFrame(
  videoPath: string,
  outputPng: string,
  timeSeconds: number = 0.5
): Promise<void> {
  mkdirSync(path.dirname(outputPng), { recursive: true });

  await execFileAsync(FFMPEG, [
    "-i", videoPath,
    "-ss", String(timeSeconds),
    "-frames:v", "1",
    "-y",
    outputPng,
  ], { timeout: 30_000 });

  if (!existsSync(outputPng)) {
    throw new Error("FFmpeg frame extraction failed");
  }
}

// --- Public API ---

interface RenderOptions {
  aepFilePath: string;
  manifest: TemplateManifest;
  fieldValues: Record<string, unknown>;
  outputVariantId?: string;
  orgId: string;
}

/**
 * Render the full video with nexrender, copy to renders/ folder, return final path.
 */
export async function renderVideo(
  options: RenderOptions,
  jobId: string
): Promise<string> {
  return withRenderLock(async () => {
    const absAepPath = path.resolve(options.aepFilePath);
    if (!existsSync(absAepPath)) {
      throw new Error(`AEP file not found: ${absAepPath}`);
    }

    const assets = buildNexrenderAssets(options.manifest, options.fieldValues);

    const variant = options.outputVariantId
      ? options.manifest.outputVariants.find((v) => v.id === options.outputVariantId)
      : null;

    const encodeParams: Record<string, string> = {
      "-vcodec": "libx264",
      "-acodec": "aac",
      "-pix_fmt": "yuv420p",
      "-preset": "fast",
      "-crf": "18",
    };

    if (variant) {
      encodeParams["-vf"] =
        `scale=${variant.width}:${variant.height}:force_original_aspect_ratio=decrease,pad=${variant.width}:${variant.height}:(ow-iw)/2:(oh-ih)/2:color=black`;
    }

    const job = {
      template: {
        src: `file:///${absAepPath.replace(/\\/g, "/").replace(/ /g, "%20")}`,
        composition: options.manifest.composition,
        outputExt: "avi",
      },
      assets,
      actions: {
        postrender: [
          {
            module: "@nexrender/action-encode",
            preset: "mp4",
            output: "output.mp4",
            params: encodeParams,
          },
        ],
      },
      workpath: path.resolve("storage/tmp/nexrender"),
    };

    console.log(`[render] Starting video render for job ${jobId}...`);
    const tempOutput = await runNexrender(job, 600_000);

    // Copy to permanent renders/ folder
    const finalPath = getRenderOutputPath(options.orgId, `export-${jobId}`);
    mkdirSync(path.dirname(finalPath), { recursive: true });
    await copyFile(tempOutput, finalPath);

    // Cleanup nexrender temp
    await rm(path.dirname(tempOutput), { recursive: true, force: true }).catch(() => {});

    console.log(`[render] Video saved to: ${finalPath}`);
    return finalPath;
  });
}

/**
 * Render video with nexrender, then extract a frame as PNG preview.
 */
export async function renderPreview(
  options: RenderOptions,
  variantId: string
): Promise<string> {
  return withRenderLock(async () => {
    const absAepPath = path.resolve(options.aepFilePath);
    if (!existsSync(absAepPath)) {
      throw new Error(`AEP file not found: ${absAepPath}`);
    }

    const assets = buildNexrenderAssets(options.manifest, options.fieldValues);

    const job = {
      template: {
        src: `file:///${absAepPath.replace(/\\/g, "/").replace(/ /g, "%20")}`,
        composition: options.manifest.composition,
        outputExt: "avi",
      },
      assets,
      actions: {
        postrender: [
          {
            module: "@nexrender/action-encode",
            preset: "mp4",
            output: "output.mp4",
            params: {
              "-vcodec": "libx264",
              "-pix_fmt": "yuv420p",
              "-preset": "ultrafast",
              "-crf": "28",
            },
          },
        ],
      },
      workpath: path.resolve("storage/tmp/nexrender"),
    };

    console.log(`[preview] Rendering for preview...`);
    const tempVideo = await runNexrender(job, 120_000);

    // Extract middle frame as PNG
    const duration = options.manifest.duration || 10;
    const previewPath = getPreviewOutputPath(options.orgId, variantId);
    await extractFrame(tempVideo, previewPath, duration / 2);

    // Cleanup nexrender temp
    await rm(path.dirname(tempVideo), { recursive: true, force: true }).catch(() => {});

    console.log(`[preview] Saved to: ${previewPath}`);
    return previewPath;
  });
}

export async function cleanupTempDir(dirPath: string): Promise<void> {
  await rm(dirPath, { recursive: true, force: true }).catch(() => {});
}
