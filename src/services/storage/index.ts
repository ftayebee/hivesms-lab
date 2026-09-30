import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";
import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/errors";
import { localDataPath } from "@/config/env";

/**
 * File storage abstraction. Files are always served through authenticated app routes, never via
 * public bucket URLs, so tenant isolation is enforced by the application.
 *  - local: .local/storage on disk (development / single-node)
 *  - s3: any S3-compatible service (AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces...)
 */
export interface StorageProvider {
  readonly key: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

class LocalStorage implements StorageProvider {
  readonly key = "local";
  private root = localDataPath("storage");
  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return full;
  }
  async put(key: string, body: Buffer, contentType: string) {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
    await writeFile(`${file}.meta`, JSON.stringify({ contentType }));
  }
  async get(key: string) {
    try {
      const file = this.resolve(key);
      const body = await readFile(file);
      const meta = JSON.parse(await readFile(`${file}.meta`, "utf8").catch(() => "{}")) as { contentType?: string };
      return { body, contentType: meta.contentType ?? "application/octet-stream" };
    } catch {
      return null;
    }
  }
  async delete(key: string) {
    const file = this.resolve(key);
    await unlink(file).catch(() => {});
    await unlink(`${file}.meta`).catch(() => {});
  }
}

class S3Storage implements StorageProvider {
  readonly key = "s3";
  private client: AwsClient;
  constructor(
    private endpoint: string,
    private bucket: string,
    accessKeyId: string,
    secretAccessKey: string,
    region: string,
  ) {
    this.client = new AwsClient({ accessKeyId, secretAccessKey, region: region || "auto", service: "s3" });
  }
  private url(key: string) {
    return `${this.endpoint.replace(/\/$/, "")}/${this.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
  async put(key: string, body: Buffer, contentType: string) {
    const res = await this.client.fetch(this.url(key), { method: "PUT", body: new Uint8Array(body), headers: { "content-type": contentType } });
    if (!res.ok) throw new Error(`S3 upload failed: HTTP ${res.status}`);
  }
  async get(key: string) {
    const res = await this.client.fetch(this.url(key));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`S3 download failed: HTTP ${res.status}`);
    return { body: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
  }
  async delete(key: string) {
    await this.client.fetch(this.url(key), { method: "DELETE" });
  }
}

let storage: StorageProvider | undefined;

export function getStorage(): StorageProvider {
  if (storage) return storage;
  if (process.env.STORAGE_PROVIDER === "s3") {
    const { STORAGE_S3_ENDPOINT, STORAGE_S3_BUCKET, STORAGE_S3_ACCESS_KEY_ID, STORAGE_S3_SECRET_ACCESS_KEY, STORAGE_S3_REGION } = process.env;
    if (!STORAGE_S3_ENDPOINT || !STORAGE_S3_BUCKET || !STORAGE_S3_ACCESS_KEY_ID || !STORAGE_S3_SECRET_ACCESS_KEY) {
      throw new Error("S3 storage selected but STORAGE_S3_* variables are incomplete");
    }
    storage = new S3Storage(STORAGE_S3_ENDPOINT, STORAGE_S3_BUCKET, STORAGE_S3_ACCESS_KEY_ID, STORAGE_S3_SECRET_ACCESS_KEY, STORAGE_S3_REGION ?? "");
  } else {
    storage = new LocalStorage();
  }
  return storage;
}

// ─── Upload validation ───

const ALLOWED_DOCUMENT_TYPES: Record<string, { ext: string[]; magic?: number[][] }> = {
  "application/pdf": { ext: ["pdf"], magic: [[0x25, 0x50, 0x44, 0x46]] },
  "image/png": { ext: ["png"], magic: [[0x89, 0x50, 0x4e, 0x47]] },
  "image/jpeg": { ext: ["jpg", "jpeg"], magic: [[0xff, 0xd8, 0xff]] },
};

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export interface StoredFile {
  key: string;
  name: string;
  size: number;
  contentType: string;
}

/**
 * Validates an uploaded document by size, declared type, extension AND file signature (magic
 * bytes), then stores it under a random key scoped to the organization.
 */
export async function storeDocument(organizationId: string, file: File, folder: string): Promise<StoredFile> {
  if (file.size === 0) throw new AppError("VALIDATION_ERROR", `${file.name} is empty.`);
  if (file.size > MAX_DOCUMENT_BYTES) throw new AppError("VALIDATION_ERROR", `${file.name} is larger than 5 MB.`);
  const rule = ALLOWED_DOCUMENT_TYPES[file.type];
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!rule || !rule.ext.includes(ext)) throw new AppError("VALIDATION_ERROR", `${file.name}: only PDF, PNG or JPG files are accepted.`);
  const bytes = Buffer.from(await file.arrayBuffer());
  const magicOk = !rule.magic || rule.magic.some((sig) => sig.every((b, i) => bytes[i] === b));
  if (!magicOk) throw new AppError("VALIDATION_ERROR", `${file.name} does not look like a valid ${ext.toUpperCase()} file.`);
  const key = `orgs/${organizationId}/${folder}/${randomUUID()}.${ext}`;
  await getStorage().put(key, bytes, file.type);
  const safeName = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  return { key, name: safeName, size: file.size, contentType: file.type };
}
