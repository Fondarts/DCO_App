import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { existsSync } from "fs";
import type { TemplateManifest } from "@dco/shared";

const execFileAsync = promisify(execFile);

// Find FFmpeg binary
function findFFmpeg(): string {
  const candidates = [
    "ffmpeg",
    "C:\\Users\\Fede\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.0.1-full_build\\bin\\ffmpeg.exe",
  ];
  for (const c of candidates) {
    if (c === "ffmpeg" || existsSync(c)) return c;
  }
  return "ffmpeg";
}

const FFMPEG = findFFmpeg();

interface ExportOptions {
  manifest: TemplateManifest;
  fieldValues: Record<string, unknown>;
  outputVariantId?: string;
  backgroundImage?: string; // path to background image
  outputPath: string;
}

function escapeFFmpegText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "'\\\\\\''")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");
}

export async function exportVideo(options: ExportOptions): Promise<void> {
  const { manifest, fieldValues, outputVariantId, backgroundImage, outputPath } = options;

  // Determine output resolution
  const outputVariant = outputVariantId
    ? manifest.outputVariants.find((v) => v.id === outputVariantId)
    : null;
  const width = outputVariant?.width || manifest.width;
  const height = outputVariant?.height || manifest.height;
  const duration = manifest.duration || 10;

  // Collect text fields with their values
  const textFields = manifest.fields
    .filter((f) => f.type === "text")
    .map((f) => ({
      label: f.label,
      value: (fieldValues[f.id] as string) || (f.default as string) || f.label,
    }));

  // Build FFmpeg filter chain
  const filters: string[] = [];

  // Start with background
  let inputArgs: string[];
  if (backgroundImage && existsSync(backgroundImage)) {
    inputArgs = ["-loop", "1", "-i", backgroundImage, "-t", String(duration)];
    filters.push(`scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x111827`);
  } else {
    // Generate solid color background
    inputArgs = [
      "-f", "lavfi",
      "-i", `color=c=0x111827:s=${width}x${height}:d=${duration}:r=${manifest.fps || 30}`,
    ];
  }

  // Add text overlays
  const fontSize = Math.round(Math.min(width, height) * 0.05);
  const totalTexts = textFields.length;
  const centerY = height / 2;
  const lineSpacing = fontSize * 1.8;
  const startY = centerY - ((totalTexts - 1) * lineSpacing) / 2;

  for (let i = 0; i < textFields.length; i++) {
    const text = escapeFFmpegText(textFields[i].value);
    const y = Math.round(startY + i * lineSpacing);
    const isFirst = i === 0;
    const fs = isFirst ? Math.round(fontSize * 1.4) : fontSize;

    // Fade in animation: each text fades in 0.3s after the previous
    const fadeStart = 0.3 + i * 0.4;
    filters.push(
      `drawtext=text='${text}':fontsize=${fs}:fontcolor=white:x=(w-text_w)/2:y=${y}:alpha='if(lt(t\\,${fadeStart})\\,0\\,min(1\\,(t-${fadeStart})/0.3))':shadowcolor=black:shadowx=2:shadowy=2`
    );
  }

  // Add a subtle animated bar at the bottom
  const barHeight = Math.round(height * 0.005);
  filters.push(
    `drawbox=x=0:y=h-${barHeight}:w='iw*(t/${duration})':h=${barHeight}:color=0x3B82F6:t=fill`
  );

  const filterChain = filters.join(",");

  const args = [
    ...inputArgs,
    "-vf", filterChain,
    "-c:v", "libx264",
    "-preset", "fast",
    "-pix_fmt", "yuv420p",
    "-b:v", "4000k",
    "-movflags", "+faststart",
    "-y",
    outputPath,
  ];

  // Ensure output dir exists
  const dir = path.dirname(outputPath);
  const { mkdirSync } = await import("fs");
  mkdirSync(dir, { recursive: true });

  try {
    await execFileAsync(FFMPEG, args, { timeout: 60000 });
  } catch (err) {
    const error = err as Error & { stderr?: string };
    throw new Error(`FFmpeg failed: ${error.stderr || error.message}`);
  }
}
