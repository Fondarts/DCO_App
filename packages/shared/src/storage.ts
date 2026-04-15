/**
 * Storage Provider Interface
 *
 * Abstracts file storage so the app works with both local filesystem
 * and S3-compatible object storage (MinIO, AWS S3, etc).
 *
 * All keys are slash-separated paths like:
 *   "orgs/{orgId}/templates/{templateId}/file.mogrt"
 */

export interface StorageProvider {
  /** Upload a file. Returns the storage key. */
  upload(key: string, data: Buffer, contentType?: string): Promise<string>;

  /** Download a file as Buffer. */
  download(key: string): Promise<Buffer>;

  /** Get a URL for the client to download the file (presigned for S3, local API path for local). */
  getUrl(key: string, expiresInSeconds?: number): Promise<string>;

  /** Check if a file exists. */
  exists(key: string): Promise<boolean>;

  /** Delete a file. */
  delete(key: string): Promise<void>;

  /** Get the absolute local path (only works for local provider, throws for S3). */
  getLocalPath(key: string): string;
}

/**
 * Create the appropriate storage provider based on STORAGE_PROVIDER env var.
 * - "local" (default): uses local filesystem
 * - "s3": uses S3-compatible storage (requires @aws-sdk/client-s3)
 */
export function createStorageProvider(overrideType?: string): StorageProvider {
  const type = overrideType || process.env.STORAGE_PROVIDER || "local";

  if (type === "s3") {
    const { S3StorageProvider } = require("./storage-s3");
    return new S3StorageProvider();
  }

  const { LocalStorageProvider } = require("./storage-local");
  return new LocalStorageProvider();
}

/** Singleton instance */
let _provider: StorageProvider | null = null;
export function getStorageProvider(): StorageProvider {
  if (!_provider) _provider = createStorageProvider();
  return _provider;
}

/** Standard key builders */
export const StorageKeys = {
  template(orgId: string, templateId: string, filename: string): string {
    return `orgs/${orgId}/templates/${templateId}/${filename}`;
  },
  render(orgId: string, jobId: string): string {
    return `orgs/${orgId}/renders/${jobId}.mp4`;
  },
  preview(orgId: string, variantId: string): string {
    return `orgs/${orgId}/previews/${variantId}.png`;
  },
  asset(orgId: string, assetId: string, filename: string): string {
    return `orgs/${orgId}/assets/${assetId}/${filename}`;
  },
};
