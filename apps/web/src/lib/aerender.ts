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

// --- Build nexrender assets for AEP templates ---
function buildAepAssets(
  manifest: TemplateManifest,
  fieldValues: Record<string, unknown>
) {
  const assets: Record<string, unknown>[] = [];

  for (const field of manifest.fields) {
    const value = fieldValues[field.id] ?? field.default;
    if (value === null || value === undefined) continue;
    if (!field.nexrenderAsset) continue;

    const comp = field.composition || manifest.composition;

    switch (field.nexrenderAsset.type) {
      case "data": {
        if (!field.nexrenderAsset.property) continue;

        let dataValue: unknown = value;
        if (field.type === "text") {
          if (typeof value === "object" && value !== null && "text" in (value as Record<string, unknown>)) {
            dataValue = (value as Record<string, unknown>).text;
          }
        }

        assets.push({
          type: "data",
          layerName: field.layerName,
          property: field.nexrenderAsset.property,
          value: dataValue,
          composition: comp,
        });
        break;
      }

      case "image":
      case "footage":
      case "audio": {
        if (typeof value === "string" && value.length > 0) {
          const absPath = path.resolve(value);
          assets.push({
            type: field.nexrenderAsset.type === "footage" ? "video" : field.nexrenderAsset.type,
            src: `file:///${absPath.replace(/\\/g, "/").replace(/ /g, "%20")}`,
            layerName: field.layerName,
            composition: comp,
          });
        }
        break;
      }
    }
  }

  return assets;
}

// Local MOGRT action module path (replaces nexrender-action-mogrt-template)
const MOGRT_ACTION_PATH = path.resolve("src/lib/nexrender-mogrt-action.cjs");

// --- Build MOGRT job config (uses local nexrender action for extraction) ---
function buildMogrtJobConfig(
  mogrtPath: string,
  manifest: TemplateManifest,
  fieldValues: Record<string, unknown>
) {
  const essentialParameters: Record<string, unknown> = {};
  const mediaAssets: Record<string, unknown>[] = [];

  for (const field of manifest.fields) {
    const value = fieldValues[field.id] ?? field.default;
    if (value === null || value === undefined) continue;

    if (field.type === "image" || field.type === "video" || field.type === "audio") {
      if (typeof value === "string" && value.length > 0 && field.layerName) {
        const absPath = path.resolve(value);
        mediaAssets.push({
          type: field.type === "video" ? "video" : field.type,
          src: `file:///${absPath.replace(/\\/g, "/").replace(/ /g, "%20")}`,
          layerName: field.layerName,
        });
      }
    } else {
      const paramName = field.parameterName || field.id;
      let paramValue: unknown = value;
      if (field.type === "text" && typeof value === "object" && value !== null && "text" in (value as Record<string, unknown>)) {
        paramValue = (value as Record<string, unknown>).text;
      }

      if (paramName.includes("|") && Array.isArray(paramValue)) {
        const [xParam, yParam] = paramName.split("|");
        essentialParameters[xParam] = paramValue[0];
        essentialParameters[yParam] = paramValue[1];
      } else {
        essentialParameters[paramName] = paramValue;
      }
    }
  }

  const absMogrt = path.resolve(mogrtPath);

  return {
    template: {
      src: `file:///${absMogrt.replace(/\\/g, "/").replace(/ /g, "%20")}`,
      composition: "mogrt", // will be replaced by action
      outputExt: "avi",
    },
    assets: mediaAssets,
    predownload: [
      {
        module: MOGRT_ACTION_PATH,
        essentialParameters,
      },
    ],
  };
}

// --- Run nexrender via child process ---
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
    console.log("[nexrender] Job:", JSON.stringify(jobData).slice(0, 500));

    let stdout = "", stderr = "";
    try {
      const r = await execFileAsync(
        process.execPath,
        [workerScript, jobPath, resultPath],
        {
          timeout: timeoutMs,
          cwd: path.resolve("."),
          windowsHide: true,
          maxBuffer: 10 * 1024 * 1024,
        }
      );
      stdout = r.stdout || "";
      stderr = r.stderr || "";
    } catch (execErr: unknown) {
      const e = execErr as { stdout?: string; stderr?: string; message?: string; code?: string };
      stdout = e.stdout || "";
      stderr = e.stderr || "";
      // Write full output to a debug file
      const debugPath = path.resolve(`storage/tmp/render-debug-${tmpId}.txt`);
      await writeFile(debugPath, `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}\n\nERROR: ${e.message}\nCODE: ${e.code}`);
      console.error("[nexrender] Worker failed. Debug:", debugPath);
      console.error("[nexrender] STDOUT (last 3000):", stdout.slice(-3000));
      console.error("[nexrender] STDERR (last 2000):", stderr.slice(-2000));

      // Check if result file was written despite error
      if (!existsSync(resultPath)) {
        throw new Error(`Command failed: ${e.message}\nSTDOUT: ${stdout.slice(-500)}\nSTDERR: ${stderr.slice(-500)}`);
      }
    }

    if (stdout) console.log("[nexrender stdout]", stdout.slice(-3000));
    if (stderr) console.log("[nexrender stderr]", stderr.slice(-1000));

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
  templateFilePath: string;
  manifest: TemplateManifest;
  fieldValues: Record<string, unknown>;
  outputVariantId?: string;
  orgId: string;
}

function resolveComposition(options: RenderOptions): string {
  if (options.outputVariantId) {
    const variant = options.manifest.outputVariants.find((v) => v.id === options.outputVariantId);
    if (variant?.composition) return variant.composition;
  }
  return options.manifest.composition;
}

function buildJob(options: RenderOptions): { isMogrt: boolean } & Record<string, unknown> {
  const isMogrt = options.manifest.format === "mogrt";

  if (isMogrt) {
    const config = buildMogrtJobConfig(options.templateFilePath, options.manifest, options.fieldValues);
    return { ...config, isMogrt: true };
  }

  // AEP path
  const absAepPath = path.resolve(options.templateFilePath);
  if (!existsSync(absAepPath)) {
    throw new Error(`AEP file not found: ${absAepPath}`);
  }

  const assets = buildAepAssets(options.manifest, options.fieldValues);
  const composition = resolveComposition(options);

  return {
    isMogrt: false,
    template: {
      src: `file:///${absAepPath.replace(/\\/g, "/").replace(/ /g, "%20")}`,
      composition,
      outputExt: "avi",
    },
    assets,
  };
}

/**
 * Render the full video with nexrender, copy to renders/ folder, return final path.
 */
export async function renderVideo(
  options: RenderOptions,
  jobId: string
): Promise<string> {
  return withRenderLock(async () => {
    const baseJob = buildJob(options);
    const { isMogrt, ...jobData } = baseJob;

    const actions: Record<string, unknown[]> = {};

    // MOGRT: predownload action for extraction + essential params
    if (isMogrt && jobData.predownload) {
      actions.predownload = jobData.predownload as unknown[];
      delete jobData.predownload;
    }

    // Both formats output AVI → need encode
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

    if (variant && !variant.composition) {
      encodeParams["-vf"] =
        `scale=${variant.width}:${variant.height}:force_original_aspect_ratio=decrease,pad=${variant.width}:${variant.height}:(ow-iw)/2:(oh-ih)/2:color=black`;
    }

    actions.postrender = [
      {
        module: "@nexrender/action-encode",
        preset: "mp4",
        output: "output.mp4",
        params: encodeParams,
      },
    ];

    const job = {
      ...jobData,
      actions,
      workpath: path.resolve("storage/tmp/nexrender"),
    };

    console.log(`[render] Starting video render for job ${jobId} (${isMogrt ? "MOGRT" : "AEP"})...`);

    const tempOutput = await runNexrender(job as Record<string, unknown>, 600_000);

    const finalPath = getRenderOutputPath(options.orgId, `export-${jobId}`);
    mkdirSync(path.dirname(finalPath), { recursive: true });
    await copyFile(tempOutput, finalPath);

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
    const baseJob = buildJob(options);
    const { isMogrt, ...jobData } = baseJob;

    const actions: Record<string, unknown[]> = {};

    // MOGRT: predownload action for extraction + essential params
    if (isMogrt && jobData.predownload) {
      actions.predownload = jobData.predownload as unknown[];
      delete jobData.predownload;
    }

    // Both formats output AVI → need encode for preview
    actions.postrender = [
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
    ];

    const job = {
      ...jobData,
      actions,
      workpath: path.resolve("storage/tmp/nexrender"),
    };

    console.log(`[preview] Rendering for preview (${isMogrt ? "MOGRT" : "AEP"})...`);

    const tempVideo = await runNexrender(job as Record<string, unknown>, 600_000);

    const previewPath = getPreviewOutputPath(options.orgId, variantId);
    await extractFrame(tempVideo, previewPath, 0.5);

    await rm(path.dirname(tempVideo), { recursive: true, force: true }).catch(() => {});

    console.log(`[preview] Saved to: ${previewPath}`);
    return previewPath;
  });
}

export async function cleanupTempDir(dirPath: string): Promise<void> {
  await rm(dirPath, { recursive: true, force: true }).catch(() => {});
}
