import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { conversationMessageBubbleStyle } from "@/components/ConversationMessageBubble";
import { DEFAULT_CONVERSATION_BACKGROUND } from "@shared/user-personalization";

const storage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
};

vi.mock("@/lib/trpc", () => {
  const query = () => ({ data: undefined, isError: false, isLoading: false, refetch: async () => undefined });
  const mutation = () => ({ isPending: false, mutate: () => undefined, mutateAsync: async () => undefined });
  const invalidate = async () => undefined;
  return {
    trpc: {
      useUtils: () => ({ conversations: { list: { invalidate }, counts: { invalidate } } }),
      evolution: { getStatus: { useQuery: query } },
      conversations: {
        messages: { useQuery: query },
        list: { useQuery: query },
        eligibleUsers: { useQuery: query },
        close: { useMutation: mutation },
        reopen: { useMutation: mutation },
        claim: { useMutation: mutation },
        transfer: { useMutation: mutation },
      },
      crm: { getById: { useQuery: query } },
      megadesk: { sendMessage: { useMutation: mutation }, sendAttachment: { useMutation: mutation } },
    },
  };
});

vi.mock("@/hooks/useUserPersonalization", () => ({
  useUserPersonalization: () => ({ preference: {} }),
}));

vi.mock("@/hooks/useDebounce", () => ({ useDebounce: <T,>(value: T) => value }));

import { ConversationsPage } from "./Home";

beforeEach(() => {
  const local = storage();
  const session = storage();
  Object.assign(globalThis, {
    localStorage: local,
    sessionStorage: session,
    window: {
      location: { search: "", hash: "", href: "http://localhost/", origin: "http://localhost", pathname: "/" },
      sessionStorage: session,
      localStorage: local,
    },
  });
});

describe("Atendimento dark mode", () => {
  it("renders the real Atendimento workspace with both the approved light surfaces and dark variants", () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        "div",
        { className: "dark" },
        React.createElement(ConversationsPage, { attendanceLaunch: 0, attendancePhone: "" })
      )
    );

    expect(markup).toContain('data-testid="attendance-workspace"');
    expect(markup).toContain("bg-white dark:bg-slate-950");
    expect(markup).toContain("bg-slate-50 dark:bg-slate-900");
    expect(markup).toContain('data-testid="attendance-empty-state"');
    expect(markup).toContain("from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900");
  });

  it("keeps message bubbles on the existing personalization helper instead of inheriting container colors", () => {
    const preference = {
      ...DEFAULT_CONVERSATION_BACKGROUND,
      incomingBubbleColor: "#DBEAFE",
      outgoingBubbleColor: "#1E293B",
    };

    expect(conversationMessageBubbleStyle("incoming", preference)).toMatchObject({ backgroundColor: "#DBEAFE" });
    expect(conversationMessageBubbleStyle("outgoing", preference)).toMatchObject({ backgroundColor: "#1E293B" });
  });
});
