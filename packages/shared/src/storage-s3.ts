import type { StorageProvider } from "./storage";

/**
 * S3-compatible storage provider.
 * Works with AWS S3, MinIO, DigitalOcean Spaces, etc.
 *
 * Requires: @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner
 * Install only when STORAGE_PROVIDER=s3
 */
export class S3StorageProvider implements StorageProvider {
  private bucket: string;
  private client: unknown;
  private endpoint: string | undefined;

  constructor(config?: {
    bucket?: string;
    region?: string;
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  }) {
    this.bucket = config?.bucket || process.env.S3_BUCKET || "dco-storage";
    this.endpoint = config?.endpoint || process.env.S3_ENDPOINT;

    // Lazy import to avoid requiring @aws-sdk when not using S3
    const { S3Client } = require("@aws-sdk/client-s3");

    this.client = new S3Client({
      region: config?.region || process.env.S3_REGION || "us-east-1",
      endpoint: this.endpoint,
      forcePathStyle: !!this.endpoint, // Required for MinIO
      credentials: {
        accessKeyId: config?.accessKeyId || process.env.S3_ACCESS_KEY || "",
        secretAccessKey: config?.secretAccessKey || process.env.S3_SECRET_KEY || "",
      },
    });
  }

  async upload(key: string, data: Buffer, contentType?: string): Promise<string> {
    const { PutObjectCommand } = require("@aws-sdk/client-s3");
    await (this.client as { send: (cmd: unknown) => Promise<void> }).send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType || "application/octet-stream",
      })
    );
    return key;
  }

  async download(key: string): Promise<Buffer> {
    const { GetObjectCommand } = require("@aws-sdk/client-s3");
    const response = await (this.client as { send: (cmd: unknown) => Promise<{ Body: { transformToByteArray: () => Promise<Uint8Array> } }> }).send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async getUrl(key: string, expiresInSeconds: number = 3600): Promise<string> {
    const { GetObjectCommand } = require("@aws-sdk/client-s3");
    const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async exists(key: string): Promise<boolean> {
    const { HeadObjectCommand } = require("@aws-sdk/client-s3");
    try {
      await (this.client as { send: (cmd: unknown) => Promise<void> }).send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key })
      );
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
    await (this.client as { send: (cmd: unknown) => Promise<void> }).send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
    );
  }

  getLocalPath(): string {
    throw new Error("S3 storage does not support local paths. Use download() instead.");
  }
}
