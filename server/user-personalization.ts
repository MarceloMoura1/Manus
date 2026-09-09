import type { Express, Request, Response } from "express";
import express from "express";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  assertOperationalCsrf,
  resolveOperationalSessionReadOnly,
} from "./_core/megadesk-session";
import {
  getUserSettings,
  updateUserConversationAppearance,
} from "./db-user-settings";
import {
  PRODUCT_MEDIA_MAX_BYTES,
  processProductImage,
  productMediaRoot,
} from "./product-media";
import {
  DEFAULT_CONVERSATION_BACKGROUND,
  isConversationBackgroundPresetId,
  isConversationBubbleColor,
  normalizeConversationBubbleColor,
  type ConversationBackgroundPreference,
} from "../shared/user-personalization";

const BACKGROUND_PREFIX = "user-backgrounds";
const IMAGE_KEY = /^user-backgrounds\/[0-9a-f]{32}\/[0-9a-f-]{36}\.webp$/i;

type Identity = { tenantId: string; userId: string };
type ConversationBackgroundSettings = Pick<
  Awaited<ReturnType<typeof getUserSettings>>,
  | "conversationBackgroundType"
  | "conversationBackgroundPresetId"
  | "conversationBackgroundImageKey"
  | "conversationIncomingBubbleColor"
  | "conversationOutgoingBubbleColor"
>;

type ConversationAppearanceColors = {
  incomingBubbleColor?: string | null;
  outgoingBubbleColor?: string | null;
};

export class UserPersonalizationError extends Error {
  constructor(
    public readonly code: "BAD_IMAGE" | "TOO_LARGE" | "NOT_FOUND" | "STORAGE",
    message: string
  ) {
    super(message);
  }
}

function identityKey(identity: Identity): string {
  return createHash("sha256")
    .update(`${identity.tenantId}:${identity.userId}`)
    .digest("hex")
    .slice(0, 32);
}

export function resolveUserBackgroundPath(root: string, key: string): string {
  if (!IMAGE_KEY.test(key))
    throw new UserPersonalizationError(
      "STORAGE",
      "Referência de imagem inválida."
    );
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...key.split("/"));
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`))
    throw new UserPersonalizationError(
      "STORAGE",
      "Referência de imagem inválida."
    );
  return resolved;
}

async function atomicWrite(target: string, data: Buffer) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function imageKeyFor(identity: Identity): string {
  return `${BACKGROUND_PREFIX}/${identityKey(identity)}/${randomUUID()}.webp`;
}

function isOwnedKey(
  identity: Identity,
  key: string | null | undefined
): key is string {
  return Boolean(
    key &&
      key.startsWith(`${BACKGROUND_PREFIX}/${identityKey(identity)}/`) &&
      IMAGE_KEY.test(key)
  );
}

function imageRevision(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function imageErrorStatus(error: unknown): number {
  if (!(error instanceof UserPersonalizationError)) return 500;
  if (error.code === "TOO_LARGE") return 413;
  if (error.code === "NOT_FOUND") return 404;
  return 400;
}

async function resolveIdentity(req: Request): Promise<Identity | null> {
  const session = await resolveOperationalSessionReadOnly(req);
  return session
    ? { tenantId: session.tenantId, userId: session.userId }
    : null;
}

/** Returns a renderable preference while keeping the storage key private. */
export function userConversationBackgroundPreference(
  settings: ConversationBackgroundSettings
): ConversationBackgroundPreference {
  const hasCustomImage = Boolean(settings.conversationBackgroundImageKey);
  const bubbleColors = {
    incomingBubbleColor: normalizeConversationBubbleColor(
      settings.conversationIncomingBubbleColor
    ),
    outgoingBubbleColor: normalizeConversationBubbleColor(
      settings.conversationOutgoingBubbleColor
    ),
  };
  if (
    settings.conversationBackgroundType === "preset" &&
    isConversationBackgroundPresetId(settings.conversationBackgroundPresetId)
  ) {
    return {
      backgroundType: "preset",
      presetId: settings.conversationBackgroundPresetId,
      customImageUrl: null,
      hasCustomImage,
      ...bubbleColors,
    };
  }
  if (settings.conversationBackgroundType === "custom" && hasCustomImage) {
    return {
      backgroundType: "custom",
      presetId: null,
      customImageUrl: `/api/user-personalization/background?v=${imageRevision(settings.conversationBackgroundImageKey!)}`,
      hasCustomImage: true,
      ...bubbleColors,
    };
  }
  return {
    ...DEFAULT_CONVERSATION_BACKGROUND,
    hasCustomImage,
    ...bubbleColors,
  };
}

export function userConversationBackgroundUploadResponse(
  settings: ConversationBackgroundSettings
) {
  return {
    ok: true,
    preference: userConversationBackgroundPreference(settings),
  };
}

export async function uploadUserConversationBackground(
  identity: Identity,
  bytes: Buffer,
  colors: ConversationAppearanceColors = {}
) {
  if (bytes.length > PRODUCT_MEDIA_MAX_BYTES)
    throw new UserPersonalizationError(
      "TOO_LARGE",
      "A imagem deve ter no máximo 5 MB."
    );
  let image: Awaited<ReturnType<typeof processProductImage>>;
  try {
    image = await processProductImage(bytes);
  } catch {
    throw new UserPersonalizationError(
      "BAD_IMAGE",
      "Envie uma imagem JPG, PNG ou WebP estática válida."
    );
  }

  const root = productMediaRoot();
  const previous = await getUserSettings(identity.tenantId, identity.userId);
  const key = imageKeyFor(identity);
  const target = resolveUserBackgroundPath(root, key);
  try {
    await atomicWrite(target, image.main);
    await updateUserConversationAppearance(identity.tenantId, identity.userId, {
      conversationBackgroundType: "custom",
      conversationBackgroundPresetId: null,
      conversationBackgroundImageKey: key,
      conversationIncomingBubbleColor:
        colors.incomingBubbleColor === undefined
          ? normalizeConversationBubbleColor(
              previous.conversationIncomingBubbleColor
            )
          : normalizeConversationBubbleColor(colors.incomingBubbleColor),
      conversationOutgoingBubbleColor:
        colors.outgoingBubbleColor === undefined
          ? normalizeConversationBubbleColor(
              previous.conversationOutgoingBubbleColor
            )
          : normalizeConversationBubbleColor(colors.outgoingBubbleColor),
    });
  } catch (error) {
    await rm(target, { force: true });
    if (error instanceof UserPersonalizationError) throw error;
    throw new UserPersonalizationError(
      "STORAGE",
      "Não foi possível salvar a imagem."
    );
  }

  if (isOwnedKey(identity, previous.conversationBackgroundImageKey)) {
    await rm(
      resolveUserBackgroundPath(root, previous.conversationBackgroundImageKey),
      { force: true }
    ).catch(() => undefined);
  }
  return userConversationBackgroundUploadResponse(
    await getUserSettings(identity.tenantId, identity.userId)
  );
}

export async function saveUserConversationAppearance(
  identity: Identity,
  preference: {
    backgroundType: "default" | "preset" | "custom";
    presetId: string | null;
    incomingBubbleColor?: string | null;
    outgoingBubbleColor?: string | null;
  }
) {
  const previous = await getUserSettings(identity.tenantId, identity.userId);
  const keepsCustomBackground = preference.backgroundType === "custom";
  await updateUserConversationAppearance(identity.tenantId, identity.userId, {
    conversationBackgroundType: keepsCustomBackground
      ? previous.conversationBackgroundType
      : preference.backgroundType,
    conversationBackgroundPresetId: keepsCustomBackground
      ? previous.conversationBackgroundPresetId
      : preference.presetId,
    conversationBackgroundImageKey: keepsCustomBackground
      ? previous.conversationBackgroundImageKey
      : null,
    conversationIncomingBubbleColor:
      preference.incomingBubbleColor === undefined
        ? normalizeConversationBubbleColor(
            previous.conversationIncomingBubbleColor
          )
        : normalizeConversationBubbleColor(preference.incomingBubbleColor),
    conversationOutgoingBubbleColor:
      preference.outgoingBubbleColor === undefined
        ? normalizeConversationBubbleColor(
            previous.conversationOutgoingBubbleColor
          )
        : normalizeConversationBubbleColor(preference.outgoingBubbleColor),
  });
  if (
    !keepsCustomBackground &&
    isOwnedKey(identity, previous.conversationBackgroundImageKey)
  ) {
    await rm(
      resolveUserBackgroundPath(
        productMediaRoot(),
        previous.conversationBackgroundImageKey
      ),
      { force: true }
    ).catch(() => undefined);
  }
  return { ok: true };
}

async function handleUpload(req: Request, res: Response) {
  try {
    const identity = await resolveIdentity(req);
    if (!identity) return void res.status(401).end();
    assertOperationalCsrf(req);
    if (!Buffer.isBuffer(req.body))
      throw new UserPersonalizationError(
        "BAD_IMAGE",
        "Envie uma imagem válida."
      );
    const incomingBubbleColor = req.header("x-megadesk-incoming-bubble-color");
    const outgoingBubbleColor = req.header("x-megadesk-outgoing-bubble-color");
    if (
      (incomingBubbleColor !== undefined &&
        incomingBubbleColor !== "default" &&
        !isConversationBubbleColor(incomingBubbleColor)) ||
      (outgoingBubbleColor !== undefined &&
        outgoingBubbleColor !== "default" &&
        !isConversationBubbleColor(outgoingBubbleColor))
    ) {
      throw new UserPersonalizationError("BAD_IMAGE", "Cor de balão inválida.");
    }
    res.status(200).json(
      await uploadUserConversationBackground(identity, req.body, {
        incomingBubbleColor:
          incomingBubbleColor === "default" ? null : incomingBubbleColor,
        outgoingBubbleColor:
          outgoingBubbleColor === "default" ? null : outgoingBubbleColor,
      })
    );
  } catch (error) {
    res
      .status(imageErrorStatus(error))
      .json({
        error:
          error instanceof UserPersonalizationError
            ? error.message
            : "Não foi possível salvar a imagem.",
      });
  }
}

async function handleRead(req: Request, res: Response) {
  try {
    const identity = await resolveIdentity(req);
    if (!identity) return void res.status(401).end();
    const settings = await getUserSettings(identity.tenantId, identity.userId);
    if (!isOwnedKey(identity, settings.conversationBackgroundImageKey))
      throw new UserPersonalizationError("NOT_FOUND", "Imagem não encontrada.");
    const file = resolveUserBackgroundPath(
      productMediaRoot(),
      settings.conversationBackgroundImageKey
    );
    const info = await stat(file);
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Content-Length", String(info.size));
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.send(await readFile(file));
  } catch (error) {
    res
      .status(imageErrorStatus(error))
      .json({ error: "Imagem não encontrada." });
  }
}

export function registerUserPersonalizationRoutes(app: Express) {
  const raw = express.raw({
    type: ["image/jpeg", "image/png", "image/webp", "application/octet-stream"],
    limit: PRODUCT_MEDIA_MAX_BYTES,
  });
  app.put(
    "/api/user-personalization/background",
    raw,
    (req, res) => void handleUpload(req, res)
  );
  app.get(
    "/api/user-personalization/background",
    (req, res) => void handleRead(req, res)
  );
}
