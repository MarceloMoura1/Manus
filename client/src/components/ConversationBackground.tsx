import {
  useEffect,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import {
  DEFAULT_CONVERSATION_BACKGROUND,
  normalizeConversationBackgroundPreference,
  resolveConversationBackgroundStyle,
  type ConversationBackgroundPreference,
} from "@shared/user-personalization";
import {
  isUserPersonalizationBackgroundPath,
  resolveUserPersonalizationBackgroundUrl,
} from "@/lib/trpc-url";

type ConversationBackgroundProps = HTMLAttributes<HTMLDivElement> & {
  preference?: ConversationBackgroundPreference | null;
  children: ReactNode;
};

export function ConversationBackground({
  preference,
  className,
  children,
  ...props
}: ConversationBackgroundProps) {
  const normalized = normalizeConversationBackgroundPreference(
    preference ?? DEFAULT_CONVERSATION_BACKGROUND
  );
  const customImageUrl =
    normalized.backgroundType === "custom" &&
    isUserPersonalizationBackgroundPath(normalized.customImageUrl)
      ? resolveUserPersonalizationBackgroundUrl(normalized.customImageUrl)
      : normalized.customImageUrl;
  const renderablePreference =
    customImageUrl === normalized.customImageUrl
      ? normalized
      : { ...normalized, customImageUrl };
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [renderablePreference.customImageUrl]);

  const safePreference = imageFailed
    ? DEFAULT_CONVERSATION_BACKGROUND
    : renderablePreference;
  const style = resolveConversationBackgroundStyle(
    safePreference
  ) as CSSProperties;
  return (
    <div {...props} className={className} style={style}>
      {safePreference.backgroundType === "custom" &&
        safePreference.customImageUrl && (
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
