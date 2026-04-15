import { existsSync, mkdirSync } from "fs";
import { readFile, writeFile, rm } from "fs/promises";
import path from "path";
import type { StorageProvider } from "./storage";

export class LocalStorageProvider implements StorageProvider {
  private root: string;

  constructor(root?: string) {
    this.root = path.resolve(root || process.env.STORAGE_PATH || "./storage");
  }

  private resolve(key: string): string {
    const fullPath = path.join(this.root, key);
    const dir = path.dirname(fullPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return fullPath;
  }

  async upload(key: string, data: Buffer): Promise<string> {
    const fullPath = this.resolve(key);
    await writeFile(fullPath, data);
    return key;
  }

  async download(key: string): Promise<Buffer> {
    const fullPath = this.resolve(key);
    return readFile(fullPath);
  }

  async getUrl(key: string): Promise<string> {
    // For local storage, return an API path the client can fetch
    return `/api/storage/${encodeURIComponent(key)}`;
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true }).catch(() => {});
  }

  getLocalPath(key: string): string {
    return this.resolve(key);
  }
}
