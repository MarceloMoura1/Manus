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
      useUtils: () => ({
        conversations: { list: { invalidate }, counts: { invalidate }, linkedTickets: { invalidate } },
        crm: { list: { invalidate } },
      }),
      evolution: { getStatus: { useQuery: query } },
      conversations: {
        messages: { useQuery: query },
        list: { useQuery: query },
        eligibleUsers: { useQuery: query },
        updateContact: { useMutation: mutation },
        linkCrm: { useMutation: mutation },
        companyCandidates: { useQuery: query },
        phoneCandidates: { useQuery: query },
        historyDetail: { useQuery: query },
        history: { useQuery: query },
        historyPage: { useQuery: query },
        linkedTickets: { useQuery: query },
        close: { useMutation: mutation },
        reopen: { useMutation: mutation },
        claim: { useMutation: mutation },
        transfer: { useMutation: mutation },
      },
      crm: { getById: { useQuery: query } },
      megadesk: {
        attendanceRecipient: { useQuery: query },
        createConversation: { useMutation: mutation },
        sendMessage: { useMutation: mutation },
        sendAttachment: { useMutation: mutation },
      },
    },
  };
});

vi.mock("@/hooks/useUserPersonalization", () => ({
  useUserPersonalization: () => ({ preference: {} }),
}));

vi.mock("@/hooks/useDebounce", () => ({ useDebounce: <T,>(value: T) => value }));

import { ConversationsPage } from "./Home";
import { ConversationDetailsPanel } from "@/components/ConversationDetailsPanel";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { NewAttendanceFlow } from "./NewAttendanceFlow";

beforeEach(() => {
  vi.stubGlobal("React", React);
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
    const render = (theme: "light" | "dark") => {
      localStorage.setItem("megadesk_theme", theme);
      return renderToStaticMarkup(
        React.createElement(
          ThemeProvider,
          { defaultTheme: theme },
          React.createElement(
            React.Fragment,
            undefined,
        React.createElement(ConversationsPage, { attendanceLaunch: 0, attendancePhone: "" }),
        React.createElement(NewAttendanceFlow, { embedded: true, onCancel: () => undefined }),
        React.createElement(ConversationDetailsPanel, {
          conversation: {
            id: "conversation-theme",
            publicCode: "CV-THEME",
            contactId: "contact-theme",
            name: "Cliente Theme",
            phone: "5511999999999",
            status: "open",
          },
          open: true,
          canManageClients: false,
          onClose: () => undefined,
          onContactUpdated: () => undefined,
          onCrmLinked: () => undefined,
          onNavigate: () => undefined,
          onToast: () => undefined,
        }),
          ),
        ),
      )
    };
    const lightMarkup = render("light");
    const darkMarkup = render("dark");

    for (const markup of [lightMarkup, darkMarkup]) {
      expect(markup).toContain('data-testid="attendance-workspace"');
      expect(markup).toContain("bg-white data-[theme=dark]:border-slate-800 data-[theme=dark]:bg-slate-950");
      expect(markup).toContain("bg-slate-50 group-data-[theme=dark]:bg-slate-900");
      expect(markup).toContain('data-testid="attendance-empty-state"');
      expect(markup).toContain("from-slate-50 to-slate-100 group-data-[theme=dark]:from-slate-950 group-data-[theme=dark]:to-slate-900");
      expect(markup).toContain('data-testid="new-attendance-flow"');
      expect(markup).toContain("data-[theme=dark]:bg-slate-950");
      expect(markup).toContain('data-testid="conversation-details-panel"');
      expect(markup).toContain("data-[theme=dark]:border-slate-800");
      expect(markup).not.toContain("dark:");
    }
    expect(lightMarkup).toContain('data-theme="light"');
    expect(darkMarkup).toContain('data-theme="dark"');
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
