/**
 * Worker Render Engine
 * Self-contained render orchestration that takes a RenderJobPayload
 * and produces a rendered video. Uses nexrender + aerender + ffmpeg.
 *
 * All paths are configurable via env vars or constructor options.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, mkdirSync, readdirSync } from "fs";
import { writeFile, readFile, rm, copyFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import type { TemplateManifest, StorageProvider } from "@dco/shared";
import { getStorageProvider } from "@dco/shared";

const execFileAsync = promisify(execFile);

export interface RenderEngineConfig {
  /** Root directory where template files are stored (local mode) */
  storageRoot: string;
  /** Temp working directory for nexrender */
  workdir: string;
  /** Path to aerender.exe (optional, auto-detected if not set) */
  aerenderPath?: string;
  /** Path to ffmpeg.exe (optional, auto-detected if not set) */
  ffmpegPath?: string;
  /** Storage provider for downloading templates (optional, uses local by default) */
  storage?: StorageProvider;
}

export interface RenderRequest {
  templateFilePath: string;
  manifest: TemplateManifest;
  fieldValues: Record<string, unknown>;
  outputVariantId?: string;
  jobId: string;
}

export interface RenderProgress {
  phase: "RENDERING" | "ENCODING" | "COMPLETED" | "FAILED";
  progress: number;
  message?: string;
  outputPath?: string;
  error?: string;
}

type ProgressCallback = (progress: RenderProgress) => void;

// --- Path auto-detection ---

const DEFAULT_AERENDER_PATHS = [
  "C:\\Program Files\\Adobe\\Adobe After Effects 2025\\Support Files\\aerender.exe",
  "C:\\Program Files\\Adobe\\Adobe After Effects 2026\\Support Files\\aerender.exe",
  "C:\\Program Files\\Adobe\\Adobe After Effects 2024\\Support Files\\aerender.exe",
  "C:\\Program Files\\Adobe\\Adobe After Effects (Beta)\\Support Files\\aerender.exe",
];

const DEFAULT_FFMPEG_PATHS = [
  "C:\\Users\\Fede\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.0.1-full_build\\bin\\ffmpeg.exe",
];

function findBinary(envVar: string, defaults: string[]): string {
  const envPath = process.env[envVar];
  if (envPath && existsSync(envPath)) return envPath;
  for (const p of defaults) {
    if (existsSync(p)) return p;
  }
  return defaults[0]; // fallback, will fail at runtime
}

// --- Job building ---

function buildMogrtJobConfig(
  mogrtPath: string,
  manifest: TemplateManifest,
  fieldValues: Record<string, unknown>,
  mogrtActionPath: string
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
      composition: "mogrt",
      outputExt: "avi",
    },
    assets: mediaAssets,
    predownload: [
      {
        module: mogrtActionPath,
        essentialParameters,
      },
    ],
  };
}

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

// --- Main render engine ---

export class RenderEngine {
  private config: RenderEngineConfig;
  private aerenderPath: string;
  private ffmpegPath: string;
  private mogrtActionPath: string;
  private mogrtJsxPath: string;
  private storage: StorageProvider;

  constructor(config?: Partial<RenderEngineConfig>) {
    this.config = {
      storageRoot: config?.storageRoot || process.env.STORAGE_ROOT || "./storage",
      workdir: config?.workdir || process.env.WORKER_WORKDIR || "./storage/tmp/nexrender",
      aerenderPath: config?.aerenderPath,
      ffmpegPath: config?.ffmpegPath,
    };
    this.storage = config?.storage || getStorageProvider();

    this.aerenderPath = this.config.aerenderPath || findBinary("AERENDER_PATH", DEFAULT_AERENDER_PATHS);
    this.ffmpegPath = this.config.ffmpegPath || findBinary("FFMPEG_PATH", DEFAULT_FFMPEG_PATHS);
    this.mogrtActionPath = path.resolve(__dirname, "nexrender-mogrt-action.cjs");
    this.mogrtJsxPath = path.resolve(__dirname, "mogrt-apply-essential.jsx");
  }

  /**
   * Render a video from a RenderJobPayload.
   * Returns the path to the rendered MP4 file.
   */
  async render(
    request: RenderRequest,
    onProgress?: ProgressCallback
  ): Promise<string> {
    const { manifest, fieldValues, jobId } = request;
    const isMogrt = manifest.format === "mogrt";

    // Resolve template file to a local path
    // Supports: absolute paths, storage keys, and relative paths
    let templatePath = await this.resolveFile(request.templateFilePath);

    // Check for variant-specific MOGRT
    if (isMogrt && request.outputVariantId) {
      const variant = manifest.outputVariants.find((v) => v.id === request.outputVariantId);
      const variantMogrt = (variant as Record<string, unknown> | undefined)?.mogrtPath as string | undefined;
      if (variantMogrt) {
        try {
          templatePath = await this.resolveFile(variantMogrt);
        } catch {
          // Variant MOGRT not found, use main template
        }
      }
    }

    if (!existsSync(templatePath)) {
      throw new Error(`Template file not found: ${templatePath}`);
    }

    onProgress?.({ phase: "RENDERING", progress: 10, message: "Building job..." });

    // Build job config
    let jobData: Record<string, unknown>;

    if (isMogrt) {
      const config = buildMogrtJobConfig(templatePath, manifest, fieldValues, this.mogrtActionPath);
      jobData = {
        template: config.template,
        assets: config.assets,
        actions: {
          predownload: config.predownload,
          postrender: [],
        },
        workpath: path.resolve(this.config.workdir),
      };
    } else {
      const assets = buildAepAssets(manifest, fieldValues);
      let composition = manifest.composition;
      if (request.outputVariantId) {
        const variant = manifest.outputVariants.find((v) => v.id === request.outputVariantId);
        if (variant?.composition) composition = variant.composition;
      }
      const absAep = path.resolve(templatePath);
      jobData = {
        template: {
          src: `file:///${absAep.replace(/\\/g, "/").replace(/ /g, "%20")}`,
          composition,
          outputExt: "avi",
        },
        assets,
        actions: { postrender: [] },
        workpath: path.resolve(this.config.workdir),
      };
    }

    // Add FFmpeg encode action
    const encodeParams: Record<string, string> = {
      "-vcodec": "libx264",
      "-acodec": "aac",
      "-pix_fmt": "yuv420p",
      "-preset": "fast",
      "-crf": "18",
    };

    // Scale if variant needs different dimensions and no native comp/MOGRT
    if (request.outputVariantId) {
      const variant = manifest.outputVariants.find((v) => v.id === request.outputVariantId);
      const variantMogrt = (variant as Record<string, unknown> | undefined)?.mogrtPath;
      if (variant && !variant.composition && !variantMogrt) {
        encodeParams["-vf"] =
          `scale=${variant.width}:${variant.height}:force_original_aspect_ratio=decrease,pad=${variant.width}:${variant.height}:(ow-iw)/2:(oh-ih)/2:color=black`;
      }
    }

    (jobData.actions as Record<string, unknown[]>).postrender = [
      {
        module: "@nexrender/action-encode",
        preset: "mp4",
        output: "output.mp4",
        params: encodeParams,
      },
    ];

    onProgress?.({ phase: "RENDERING", progress: 20, message: "Spawning nexrender..." });

    // Execute nexrender via child process
    const tempVideo = await this.runNexrender(jobData, onProgress);

    onProgress?.({ phase: "ENCODING", progress: 85, message: "Copying output..." });

    // Copy to final output location
    const outputDir = path.resolve(this.config.storageRoot, "renders");
    mkdirSync(outputDir, { recursive: true });
    const finalPath = path.join(outputDir, `${jobId}.mp4`);
    await copyFile(tempVideo, finalPath);

    // Clean up temp
    await rm(path.dirname(tempVideo), { recursive: true, force: true }).catch(() => {});

    onProgress?.({ phase: "COMPLETED", progress: 100, outputPath: finalPath });

    return finalPath;
  }

  /**
   * Render and extract a single frame as PNG preview.
   */
  async renderPreview(
    request: RenderRequest,
    previewOutputPath: string,
    onProgress?: ProgressCallback
  ): Promise<string> {
    // Render video first (with fast settings)
    const tempVideo = await this.render(request, onProgress);

    // Extract frame
    mkdirSync(path.dirname(previewOutputPath), { recursive: true });
    await execFileAsync(this.ffmpegPath, [
      "-i", tempVideo,
      "-ss", "0.5",
      "-frames:v", "1",
      "-y",
      previewOutputPath,
    ], { timeout: 30_000 });

    // Clean up temp video
    await rm(tempVideo, { force: true }).catch(() => {});

    return previewOutputPath;
  }

  /**
   * Resolve a file path or storage key to a local path.
   * If it's a storage key (not an absolute path), download from storage to temp.
   */
  private async resolveFile(filePathOrKey: string): Promise<string> {
    // Already an absolute local path
    if (path.isAbsolute(filePathOrKey) && existsSync(filePathOrKey)) {
      return filePathOrKey;
    }

    // Try resolving relative to storage root (local provider)
    const localResolved = path.resolve(this.config.storageRoot, filePathOrKey);
    if (existsSync(localResolved)) {
      return localResolved;
    }

    // Try as a storage key — download from provider
    if (await this.storage.exists(filePathOrKey)) {
      const data = await this.storage.download(filePathOrKey);
      const tempDir = path.resolve(this.config.workdir, "downloads");
      mkdirSync(tempDir, { recursive: true });
      const filename = filePathOrKey.split("/").pop() || "template";
      const localPath = path.join(tempDir, `${randomUUID()}-${filename}`);
      await writeFile(localPath, data);
      return localPath;
    }

    // Try the legacy path resolution (relative to parent of storage root)
    const legacyResolved = path.resolve(this.config.storageRoot, "..", filePathOrKey);
    if (existsSync(legacyResolved)) {
      return legacyResolved;
    }

    throw new Error(`File not found: ${filePathOrKey}`);
  }

  /**
   * Upload the rendered output to storage and return the storage key.
   */
  async uploadResult(localPath: string, storageKey: string): Promise<string> {
    const data = await readFile(localPath);
    await this.storage.upload(storageKey, data, "video/mp4");
    return storageKey;
  }

  private async runNexrender(
    jobData: Record<string, unknown>,
    onProgress?: ProgressCallback,
    timeoutMs: number = 600_000
  ): Promise<string> {
    const tmpId = randomUUID();
    const jobPath = path.resolve(this.config.workdir, `job-${tmpId}.json`);
    const resultPath = path.resolve(this.config.workdir, `result-${tmpId}.json`);
    const workerScript = path.resolve(__dirname, "nexrender-worker.mjs");

    mkdirSync(path.dirname(jobPath), { recursive: true });
    await writeFile(jobPath, JSON.stringify(jobData));

    try {
      console.log("[render-engine] Spawning nexrender worker...");

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
            env: {
              ...process.env,
              AERENDER_PATH: this.aerenderPath,
              FFMPEG_PATH: this.ffmpegPath,
            },
          }
        );
        stdout = r.stdout || "";
        stderr = r.stderr || "";
      } catch (execErr: unknown) {
        const e = execErr as { stdout?: string; stderr?: string; message?: string; code?: string };
        stdout = e.stdout || "";
        stderr = e.stderr || "";

        // Write debug file
        const debugPath = path.resolve(this.config.workdir, `render-debug-${tmpId}.txt`);
        await writeFile(debugPath, `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}\n\nERROR: ${e.message}\nCODE: ${e.code}`);
        console.error("[render-engine] Worker failed. Debug:", debugPath);
        console.error("[render-engine] STDOUT (last 2000):", stdout.slice(-2000));
        console.error("[render-engine] STDERR (last 1000):", stderr.slice(-1000));

        if (!existsSync(resultPath)) {
          throw new Error(`Render failed: ${e.message}\nSTDOUT: ${stdout.slice(-500)}\nSTDERR: ${stderr.slice(-500)}`);
        }
      }

      if (stdout) console.log("[render-engine] stdout:", stdout.slice(-2000));
      if (stderr) console.log("[render-engine] stderr:", stderr.slice(-1000));

      onProgress?.({ phase: "RENDERING", progress: 70, message: "Render complete, encoding..." });

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
}
