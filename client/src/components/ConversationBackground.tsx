import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  DEFAULT_CONVERSATION_BACKGROUND,
  normalizeConversationBackgroundPreference,
  resolveConversationBackgroundStyle,
  type ConversationBackgroundPreference,
} from "@shared/user-personalization";
import {
  USER_PERSONALIZATION_BACKGROUND_PATH,
  userPersonalizationBackgroundUrl,
} from "@/lib/trpc-url";

type ConversationBackgroundProps = {
  preference?: ConversationBackgroundPreference | null;
  className?: string;
  children: ReactNode;
};

export function ConversationBackground({ preference, className, children }: ConversationBackgroundProps) {
  const normalized = normalizeConversationBackgroundPreference(preference ?? DEFAULT_CONVERSATION_BACKGROUND);
  const customImageUrl = normalized.backgroundType === "custom" && normalized.customImageUrl === USER_PERSONALIZATION_BACKGROUND_PATH
    ? userPersonalizationBackgroundUrl()
    : normalized.customImageUrl;
  const renderablePreference = customImageUrl === normalized.customImageUrl
    ? normalized
    : { ...normalized, customImageUrl };
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [renderablePreference.customImageUrl]);

  const safePreference = imageFailed ? DEFAULT_CONVERSATION_BACKGROUND : renderablePreference;
  const style = resolveConversationBackgroundStyle(safePreference) as CSSProperties;
  return (
    <div className={className} style={style}>
      {safePreference.backgroundType === "custom" && safePreference.customImageUrl && (
        <img
          className="hidden"
          src={safePreference.customImageUrl}
          alt=""
          aria-hidden="true"
          onError={() => setImageFailed(true)}
        />
      )}
      {children}
    </div>
  );
}
