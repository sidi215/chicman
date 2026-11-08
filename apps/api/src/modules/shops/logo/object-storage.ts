import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { StorageConfig } from "../../../config/env.js";

/** Result of reading a staged upload. */
export type StagedObject =
  | { kind: "missing" }
  /** Larger than the limit (by metadata or by the capped read). */
  | { kind: "tooLarge" }
  | { kind: "ok"; bytes: Buffer };

/**
 * The two buckets of the logo flow (spec 06, Storage locations), through the
 * S3-compatible API only, so SeaweedFS and R2 differ only by configuration.
 * Methods throw on storage failures; a missing staged object is not a failure.
 */
export interface ObjectStorage {
  /** Presigned PUT for one staging key, with `Content-Type` and `Content-Length` signed. */
  presignStagingPut(key: string, contentType: string, contentLength: number, expiresInSeconds: number): Promise<string>;
  /** Reads a staged object, never more than `maxBytes + 1` bytes. */
  readStaging(key: string, maxBytes: number): Promise<StagedObject>;
  /** Writes a public media object with a server-set content type. */
  putMedia(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Deletes a media object; deleting a missing key succeeds. */
  deleteMedia(key: string): Promise<void>;
  /** Deletes a staging object; deleting a missing key succeeds. */
  deleteStaging(key: string): Promise<void>;
}

function isNotFound(error: unknown): boolean {
  if (error instanceof S3ServiceException) {
    return error.$metadata.httpStatusCode === 404 || error.name === "NoSuchKey" || error.name === "NotFound";
  }
  return false;
}

/** Reads at most `limit` bytes from a body stream, and reports whether more existed. */
async function readCapped(body: AsyncIterable<Uint8Array>, limit: number): Promise<{ bytes: Buffer; exceeded: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > limit) {
      // Stop reading: anything beyond the limit is never buffered.
      const destroy = (body as { destroy?: () => void }).destroy;
      if (typeof destroy === "function") destroy.call(body);
      return { bytes: Buffer.alloc(0), exceeded: true };
    }
    chunks.push(Buffer.from(chunk));
  }
  return { bytes: Buffer.concat(chunks, total), exceeded: false };
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // Path-style addressing works with SeaweedFS and R2 alike.
      forcePathStyle: true,
      // No flexible checksums: they would add headers the browser upload cannot
      // match, and are not supported the same way by every S3 provider.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  presignStagingPut(key: string, contentType: string, contentLength: number, expiresInSeconds: number): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.config.uploadsBucket,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    });
    return getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds,
      signableHeaders: new Set(["content-type", "content-length"]),
    });
  }

  async readStaging(key: string, maxBytes: number): Promise<StagedObject> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.config.uploadsBucket, Key: key }));
      if ((head.ContentLength ?? 0) > maxBytes) return { kind: "tooLarge" };
      const object = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.uploadsBucket, Key: key, Range: `bytes=0-${maxBytes}` }),
      );
      if (object.Body === undefined) return { kind: "missing" };
      // The object can be replaced between the two calls: the read is capped.
      const { bytes, exceeded } = await readCapped(object.Body as AsyncIterable<Uint8Array>, maxBytes);
      return exceeded ? { kind: "tooLarge" } : { kind: "ok", bytes };
    } catch (error) {
      if (isNotFound(error)) return { kind: "missing" };
      throw error;
    }
  }

  async putMedia(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.mediaBucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.byteLength,
        // Keys are immutable: a key is never rewritten.
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  }

  async deleteMedia(key: string): Promise<void> {
    await this.delete(this.config.mediaBucket, key);
  }

  async deleteStaging(key: string): Promise<void> {
    await this.delete(this.config.uploadsBucket, key);
  }

  private async delete(bucket: string, key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
}

/** A short, fixed reason for logs and `lastDeleteError` (never an error message). */
export function storageErrorCode(error: unknown): string {
  if (error instanceof S3ServiceException) {
    const status = error.$metadata.httpStatusCode;
    return `S3_${status === undefined ? "ERROR" : `HTTP_${status}`}`.slice(0, 64);
  }
  if (error instanceof Error && error.name === "TimeoutError") return "STORAGE_TIMEOUT";
  return "STORAGE_ERROR";
}
