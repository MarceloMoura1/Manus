import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  DEFAULT_CONVERSATION_BACKGROUND,
  normalizeConversationBackgroundPreference,
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

export function useUserPersonalization() {
  const identity = readSessionIdentity();
  const input = useMemo(() => ({
    clientId: identity.clientId || undefined,
    userEmail: identity.userEmail || undefined,
  }), [identity.clientId, identity.userEmail]);
  const query = trpc.userPersonalization.get.useQuery(input, {
    enabled: Boolean(input.clientId && input.userEmail),
    staleTime: 30_000,
  });

  return {
    ...query,
    cacheIdentity: input,
    preference: normalizeConversationBackgroundPreference(query.data ?? DEFAULT_CONVERSATION_BACKGROUND),
  };
}
