import { existsSync, mkdirSync } from "fs";
import path from "path";

const STORAGE_ROOT = process.env.STORAGE_PATH || "./storage";

function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function getStoragePath(...segments: string[]): string {
  const fullPath = path.join(STORAGE_ROOT, ...segments);
  ensureDir(path.dirname(fullPath));
  return fullPath;
}

export function getTemplatePath(orgId: string, templateId: string): string {
  return getStoragePath("orgs", orgId, "templates", templateId);
}

export function getTemplateFilePath(orgId: string, templateId: string, filename: string): string {
  return getStoragePath("orgs", orgId, "templates", templateId, filename);
}

/** @deprecated Use getTemplateFilePath */
export const getTemplateAepPath = getTemplateFilePath;

export function getAssetPath(orgId: string, assetId: string, filename: string): string {
  return getStoragePath("orgs", orgId, "assets", assetId, filename);
}

export function getRenderOutputPath(_orgId: string, jobId: string): string {
  const renderRoot = path.resolve(STORAGE_ROOT, "..", "..", "..", "renders");
  ensureDir(renderRoot);
  return path.join(renderRoot, `${jobId}.mp4`);
}

export function getPreviewOutputPath(orgId: string, variantId: string): string {
  return getStoragePath("orgs", orgId, "previews", `${variantId}.png`);
}

export function getTempRenderDir(jobId: string): string {
  const dir = getStoragePath("tmp", `render-${jobId}`);
  ensureDir(dir);
  return dir;
}
