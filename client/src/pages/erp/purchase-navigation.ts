const PURCHASE_OPEN_INTENT_KEY = "megadesk_purchase_open_intent_v1";

type ReadStorage = Pick<Storage, "getItem" | "removeItem">;
type WriteStorage = Pick<Storage, "setItem">;

export function queuePurchaseOpenIntent(
  storage: WriteStorage | null | undefined,
  publicId: string
): void {
  if (!storage || !publicId.trim()) return;
  try {
    storage.setItem(
      PURCHASE_OPEN_INTENT_KEY,
      JSON.stringify({ publicId: publicId.trim() })
    );
  } catch {
    // Navigation still succeeds even if session storage is unavailable.
  }
}

export function consumePurchaseOpenIntent(
  storage: ReadStorage | null | undefined
): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PURCHASE_OPEN_INTENT_KEY);
    storage.removeItem(PURCHASE_OPEN_INTENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.publicId === "string" && parsed.publicId.trim()
      ? parsed.publicId.trim()
      : null;
  } catch {
    return null;
  }
}
