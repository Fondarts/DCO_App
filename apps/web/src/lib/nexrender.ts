import type { TemplateManifest, RenderJobPayload } from "@dco/shared";
import path from "path";
import { getRenderOutputPath } from "./storage";

const MOGRT_ACTION_PATH = path.resolve("src/lib/nexrender-mogrt-action.cjs");

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
    outputModule?: string;
    outputExt: string;
  };
  assets: NexrenderAsset[];
  actions: {
    predownload?: NexrenderAction[];
    postrender: NexrenderAction[];
  };
}

function buildAepJob(
  manifest: TemplateManifest,
  fieldValues: Record<string, unknown>,
  templateFilePath: string
): { assets: NexrenderAsset[]; template: NexrenderJob["template"] } {
  const assets: NexrenderAsset[] = [];

  for (const field of manifest.fields) {
    const value = fieldValues[field.id] ?? field.default;
    if (value === null || value === undefined) continue;
    if (!field.nexrenderAsset) continue;

    const comp = field.composition || manifest.composition;

    switch (field.nexrenderAsset.type) {
      case "data":
        assets.push({
          type: "data",
          layerName: field.layerName,
          property: field.nexrenderAsset.property,
          value,
          composition: comp,
        });
        break;

      case "image":
      case "footage":
      case "audio":
        if (typeof value === "string" && value.length > 0) {
          assets.push({
            type: field.nexrenderAsset.type === "footage" ? "video" : field.nexrenderAsset.type,
            src: value.startsWith("http") ? value : `file://${value}`,
            layerName: field.layerName,
            composition: comp,
          });
        }
        break;
    }
  }

  return {
    assets,
    template: {
      src: `file://${templateFilePath}`,
      composition: manifest.composition,
      outputModule: manifest.outputModule,
      outputExt: manifest.outputExt,
    },
  };
}

function buildMogrtActions(
  manifest: TemplateManifest,
  fieldValues: Record<string, unknown>
): { predownload: NexrenderAction[]; mediaAssets: NexrenderAsset[] } {
  const essentialParameters: Record<string, unknown> = {};
  const mediaAssets: NexrenderAsset[] = [];

  for (const field of manifest.fields) {
    const value = fieldValues[field.id] ?? field.default;
    if (value === null || value === undefined) continue;

    if (field.type === "image" || field.type === "video" || field.type === "audio") {
      if (typeof value === "string" && value.length > 0 && field.layerName) {
        mediaAssets.push({
          type: field.type === "video" ? "video" : field.type,
          src: value.startsWith("http") ? value : `file://${value}`,
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

  return {
    predownload: [
      {
        module: MOGRT_ACTION_PATH,
        essentialParameters,
      },
    ],
    mediaAssets,
  };
}

export function buildNexrenderJob(
  payload: RenderJobPayload,
  orgId: string
): NexrenderJob {
  const { manifest, fieldValues, templateFilePath, jobId } = payload;
  const isMogrt = manifest.format === "mogrt";

  let template: NexrenderJob["template"];
  let assets: NexrenderAsset[];

  let predownload: NexrenderAction[] | undefined;

  if (isMogrt) {
    const absPath = path.resolve(templateFilePath);
    template = {
      src: `file:///${absPath.replace(/\\/g, "/").replace(/ /g, "%20")}`,
      composition: "mogrt",
      outputExt: "avi",
    };
    const mogrt = buildMogrtActions(manifest, fieldValues);
    assets = mogrt.mediaAssets;
    predownload = mogrt.predownload;
  } else {
    const aep = buildAepJob(manifest, fieldValues, templateFilePath);
    template = aep.template;
    assets = aep.assets;

    const variantComp = payload.outputVariantId
      ? manifest.outputVariants.find((v) => v.id === payload.outputVariantId)?.composition
      : undefined;
    if (variantComp) {
      template = { ...template, composition: variantComp };
    }
  }

  const outputVariant = payload.outputVariantId
    ? manifest.outputVariants.find((v) => v.id === payload.outputVariantId)
    : null;

  const postrender: NexrenderAction[] = [];

  const ffmpegParams: Record<string, string> = {
    "-vcodec": "libx264",
    "-acodec": "aac",
    "-pix_fmt": "yuv420p",
    "-b:v": "8000k",
  };

  if (outputVariant && !outputVariant.composition &&
      (outputVariant.width !== manifest.width || outputVariant.height !== manifest.height)) {
    ffmpegParams["-vf"] =
      `scale=${outputVariant.width}:${outputVariant.height}:force_original_aspect_ratio=decrease,pad=${outputVariant.width}:${outputVariant.height}:(ow-iw)/2:(oh-ih)/2`;
  }

  postrender.push({
    module: "@nexrender/action-encode",
    preset: "mp4",
    output: `${jobId}.mp4`,
    params: ffmpegParams,
  });

  const outputPath = getRenderOutputPath(orgId, jobId);
  postrender.push({
    module: "@nexrender/action-copy",
    output: outputPath,
  });

  return {
    template,
    assets,
    actions: {
      ...(predownload ? { predownload } : {}),
      postrender,
    },
  };
}
