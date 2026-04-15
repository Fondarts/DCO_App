/**
 * S3-compatible storage provider.
 *
 * This file is NOT imported by the web app bundle.
 * It's only used by the worker when STORAGE_PROVIDER=s3.
 *
 * To use:
 *   npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
 *   Set STORAGE_PROVIDER=s3 and S3_* env vars.
 */

// This file intentionally has no top-level imports of @aws-sdk.
// All AWS SDK usage is deferred to runtime to prevent bundler errors.

import type { StorageProvider } from "./storage";

export class S3StorageProvider implements StorageProvider {
  private bucket: string;
  private client: any;

  constructor(config?: {
    bucket?: string;
    region?: string;
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  }) {
    this.bucket = config?.bucket || process.env.S3_BUCKET || "dco-storage";
    const endpoint = config?.endpoint || process.env.S3_ENDPOINT;

    // Runtime-only import
    const { S3Client } = this._require("@aws-sdk/client-s3");
    this.client = new S3Client({
      region: config?.region || process.env.S3_REGION || "us-east-1",
      endpoint,
      forcePathStyle: !!endpoint,
      credentials: {
        accessKeyId: config?.accessKeyId || process.env.S3_ACCESS_KEY || "",
        secretAccessKey: config?.secretAccessKey || process.env.S3_SECRET_KEY || "",
      },
    });
  }

  // Prevents bundler from analyzing the require
  private _require(mod: string) {
    return typeof globalThis !== "undefined"
      ? (globalThis as any).process?.mainModule?.require?.(mod) || require(mod)
      : require(mod);
  }

  async upload(key: string, data: Buffer, contentType?: string): Promise<string> {
    const { PutObjectCommand } = this._require("@aws-sdk/client-s3");
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket, Key: key, Body: data,
      ContentType: contentType || "application/octet-stream",
    }));
    return key;
  }

  async download(key: string): Promise<Buffer> {
    const { GetObjectCommand } = this._require("@aws-sdk/client-s3");
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async getUrl(key: string, expiresInSeconds: number = 3600): Promise<string> {
    const { GetObjectCommand } = this._require("@aws-sdk/client-s3");
    const { getSignedUrl } = this._require("@aws-sdk/s3-request-presigner");
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async exists(key: string): Promise<boolean> {
    const { HeadObjectCommand } = this._require("@aws-sdk/client-s3");
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch { return false; }
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = this._require("@aws-sdk/client-s3");
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  getLocalPath(): string {
    throw new Error("S3 storage does not support local paths. Use download() instead.");
  }
}
