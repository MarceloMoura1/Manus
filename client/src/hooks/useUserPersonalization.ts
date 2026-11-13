import { useCallback, useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  DEFAULT_CONVERSATION_BACKGROUND,
  isConversationBubbleStyle,
  normalizeConversationBackgroundPreference,
  type ConversationBubbleStyle,
} from "@shared/user-personalization";

const SESSION_KEY = "megadesk_session_v1";

type SessionIdentity = { clientId?: string; userEmail?: string };

function readSessionIdentity(): SessionIdentity {
  try {
    const value = localStorage.getItem(SESSION_KEY);
    if (!value) return {};
    const parsed = JSON.parse(value) as SessionIdentity;
    return { clientId: parsed.clientId, userEmail: parsed.userEmail };
  } catch {
    return {};
  }
}

function getStoredBubbleStyle(clientId?: string): ConversationBubbleStyle {
  if (typeof window === "undefined") return "classic_tail";
  try {
    const stored = localStorage.getItem(
      `megadesk_bubble_style_${clientId || "default"}`
    );
    if (stored && isConversationBubbleStyle(stored)) return stored;
  } catch {}
  return "classic_tail";
}

export function useUserPersonalization() {
  const identity = readSessionIdentity();
  const input = useMemo(
    () => ({
      clientId: identity.clientId || undefined,
      userEmail: identity.userEmail || undefined,
    }),
    [identity.clientId, identity.userEmail]
  );

  const [localBubbleStyle, setLocalBubbleStyle] =
    useState<ConversationBubbleStyle>(() =>
      getStoredBubbleStyle(identity.clientId)
    );

  useEffect(() => {
    setLocalBubbleStyle(getStoredBubbleStyle(identity.clientId));
  }, [identity.clientId]);

  const setBubbleStyle = useCallback(
    (style: ConversationBubbleStyle) => {
      try {
        localStorage.setItem(
          `megadesk_bubble_style_${identity.clientId || "default"}`,
          style
        );
      } catch {}
      setLocalBubbleStyle(style);
    },
    [identity.clientId]
  );

  const query = trpc.userPersonalization.get.useQuery(input, {
    enabled: Boolean(input.clientId && input.userEmail),
    staleTime: 30_000,
  });

  const preference = useMemo(() => {
    const base = normalizeConversationBackgroundPreference(
      query.data ?? DEFAULT_CONVERSATION_BACKGROUND
    );
    return {
      ...base,
      bubbleStyle: localBubbleStyle,
    };
  }, [query.data, localBubbleStyle]);

  return {
    ...query,
    cacheIdentity: input,
    preference,
    setBubbleStyle,
  };
}
