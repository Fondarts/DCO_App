import { getStorageProvider, StorageKeys } from "@dco/shared";
import type { StorageProvider } from "@dco/shared";
import { existsSync, mkdirSync } from "fs";
import path from "path";

/** Singleton storage provider */
let _storage: StorageProvider | null = null;
export function getStorage(): StorageProvider {
  if (!_storage) _storage = getStorageProvider();
  return _storage;
}

// --- Legacy path helpers (used by aerender.ts and other local-only code) ---
// These resolve to absolute local paths and only work with the local provider.

const STORAGE_ROOT = process.env.STORAGE_PATH || "./storage";

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
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

// Re-export shared key builders for convenience
export { StorageKeys };
