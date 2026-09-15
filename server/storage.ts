// Preconfigured storage helpers for Manus WebDev templates
// Uses the Biz-provided storage proxy (Authorization: Bearer <token>)

import { ENV } from './_core/env';

export type StorageConfig = { baseUrl: string; apiKey: string };

export type StorageReadErrorStage = "storage_config" | "download_url";
export type StorageReadErrorKind = "auth" | "rate_limit" | "server" | "transport" | "timeout" | "invalid_response" | "config";

export class StorageReadError extends Error {
  readonly cause?: unknown;

  constructor(readonly details: {
    stage: StorageReadErrorStage;
    kind: StorageReadErrorKind;
    providerStatus?: number;
    cause?: unknown;
  }) {
    super(`Storage read failed at ${details.stage}: ${details.kind}`);
    this.name = "StorageReadError";
    this.cause = details.cause;
  }

  get stage() { return this.details.stage; }
  get kind() { return this.details.kind; }
  get providerStatus() { return this.details.providerStatus; }
}

function validStorageReadConfig(config: StorageConfig): StorageConfig {
  if (!config.baseUrl || !config.apiKey) {
    throw new StorageReadError({ stage: "storage_config", kind: "config" });
  }
  return { baseUrl: config.baseUrl.replace(/\/+$/, ""), apiKey: config.apiKey };
}

function getStorageConfig(): StorageConfig {
  const baseUrl = ENV.forgeApiUrl;
  const apiKey = ENV.forgeApiKey;

  if (!baseUrl || !apiKey) {
    throw new Error(
      "Storage proxy credentials missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY"
    );
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

function getStorageReadConfig(): StorageConfig {
  try {
    return getStorageConfig();
  } catch (cause) {
    throw new StorageReadError({ stage: "storage_config", kind: "config", cause });
  }
}

function buildUploadUrl(baseUrl: string, relKey: string): URL {
  const url = new URL("v1/storage/upload", ensureTrailingSlash(baseUrl));
  url.searchParams.set("path", normalizeKey(relKey));
  return url;
}

async function buildDownloadUrl(
  baseUrl: string,
  relKey: string,
  apiKey: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = ENV.ticketAttachmentReadTimeoutMs,
): Promise<string> {
  let downloadApiUrl: URL;
  try {
    downloadApiUrl = new URL("v1/storage/downloadUrl", ensureTrailingSlash(baseUrl));
  } catch (cause) {
    throw new StorageReadError({ stage: "storage_config", kind: "config", cause });
  }
  downloadApiUrl.searchParams.set("path", normalizeKey(relKey));
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetcher(downloadApiUrl, {
        method: "GET",
        headers: buildAuthHeaders(apiKey),
        signal: controller.signal,
      });
    } catch (cause) {
      throw new StorageReadError({ stage: "download_url", kind: timedOut ? "timeout" : "transport", cause });
    }
    if (!response.ok) {
      const kind: StorageReadErrorKind = response.status === 401 || response.status === 403
        ? "auth"
        : response.status === 429
          ? "rate_limit"
          : response.status >= 500
            ? "server"
            : "invalid_response";
      throw new StorageReadError({ stage: "download_url", kind, providerStatus: response.status });
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      throw new StorageReadError({
        stage: "download_url",
        kind: timedOut ? "timeout" : "invalid_response",
        ...(timedOut ? {} : { providerStatus: response.status }),
        cause,
      });
    }
    const url = typeof payload === "object" && payload !== null && "url" in payload ? (payload as { url?: unknown }).url : null;
    if (typeof url !== "string") {
      throw new StorageReadError({ stage: "download_url", kind: "invalid_response", providerStatus: response.status });
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Unsupported download URL protocol");
      return parsed.toString();
    } catch (cause) {
      throw new StorageReadError({ stage: "download_url", kind: "invalid_response", providerStatus: response.status, cause });
    }
  } finally {
    clearTimeout(timer);
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const segmentStart = relKey.lastIndexOf("/");
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1 || lastDot <= segmentStart) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

function toFormData(
  data: Buffer | Uint8Array | string,
  contentType: string,
  fileName: string
): FormData {
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });
  const form = new FormData();
  form.append("file", blob, fileName || "file");
  return form;
}

function buildAuthHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}` };
}

async function putStorageObject(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType: string,
  appendSuffix: boolean,
): Promise<{ key: string; url: string }> {
  const { baseUrl, apiKey } = getStorageConfig();
  const normalizedKey = normalizeKey(relKey);
  const key = appendSuffix ? appendHashSuffix(normalizedKey) : normalizedKey;
  const uploadUrl = buildUploadUrl(baseUrl, key);
  const formData = toFormData(data, contentType, key.split("/").pop() ?? key);
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: buildAuthHeaders(apiKey),
    body: formData,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(
      `Storage upload failed (${response.status} ${response.statusText}): ${message}`
    );
  }
  const url = (await response.json()).url;
  return { key, url };
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  return putStorageObject(relKey, data, contentType, true);
}

/**
 * Callers that already own a collision-resistant opaque key (such as a UUID
 * persisted before upload) need its exact value back for authenticated reads.
 */
export async function storagePutExact(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  return putStorageObject(relKey, data, contentType, false);
}

export async function storageGet(
  relKey: string,
  dependencies: { config?: StorageConfig; fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ key: string; url: string; }> {
  const { baseUrl, apiKey } = dependencies.config ? validStorageReadConfig(dependencies.config) : getStorageReadConfig();
  const key = normalizeKey(relKey);
  return {
    key,
    url: await buildDownloadUrl(baseUrl, key, apiKey, dependencies.fetch, dependencies.timeoutMs),
  };
}
