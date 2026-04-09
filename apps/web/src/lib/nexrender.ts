import type { TemplateManifest, RenderJobPayload } from "@dco/shared";
import { getRenderOutputPath } from "./storage";

interface NexrenderAsset {
  type: string;
  src?: string;
  layerName?: string;
  composition?: string;
  property?: string;
  value?: unknown;
}

interface NexrenderAction {
  module: string;
  [key: string]: unknown;
}

interface NexrenderJob {
  template: {
    src: string;
    composition: string;
    outputModule: string;
    outputExt: string;
  };
  assets: NexrenderAsset[];
  actions: {
    prerender?: NexrenderAction[];
    postrender: NexrenderAction[];
  };
}

export function buildNexrenderJob(
  payload: RenderJobPayload,
  orgId: string
): NexrenderJob {
  const { manifest, fieldValues, aepFilePath, jobId } = payload;
  const assets: NexrenderAsset[] = [];

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
      case "audio":
        // value should be a file path or URL
        if (typeof value === "string" && value.length > 0) {
          assets.push({
            type: field.nexrenderAsset.type === "footage" ? "video" : field.nexrenderAsset.type,
            src: value.startsWith("http") ? value : `file://${value}`,
            layerName: field.layerName,
            composition: manifest.composition,
          });
        }
        break;
    }
  }

  // Determine output resolution
  const outputVariant = payload.outputVariantId
    ? manifest.outputVariants.find((v) => v.id === payload.outputVariantId)
    : null;

  const postrender: NexrenderAction[] = [];

  // FFmpeg encode to H.264 MP4
  const ffmpegParams: Record<string, string> = {
    "-vcodec": "libx264",
    "-acodec": "aac",
    "-pix_fmt": "yuv420p",
    "-b:v": "8000k",
  };

  if (outputVariant && (outputVariant.width !== manifest.width || outputVariant.height !== manifest.height)) {
    ffmpegParams["-vf"] =
      `scale=${outputVariant.width}:${outputVariant.height}:force_original_aspect_ratio=decrease,pad=${outputVariant.width}:${outputVariant.height}:(ow-iw)/2:(oh-ih)/2`;
  }

  postrender.push({
    module: "@nexrender/action-encode",
    preset: "mp4",
    output: `${jobId}.mp4`,
    params: ffmpegParams,
  });

  // Copy to final storage
  const outputPath = getRenderOutputPath(orgId, jobId);
  postrender.push({
    module: "@nexrender/action-copy",
    output: outputPath,
  });

  return {
    template: {
      src: `file://${aepFilePath}`,
      composition: manifest.composition,
      outputModule: manifest.outputModule,
      outputExt: manifest.outputExt,
    },
    assets,
    actions: { postrender },
  };
}
