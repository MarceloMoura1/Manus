import { describe, expect, it } from "vitest";
import {
  CONVERSATION_LOCALE,
  CONVERSATION_TIME_ZONE,
  formatConversationDateTime,
  formatConversationTime,
} from "./conversationDateTime";

describe("conversation date/time presentation", () => {
  it("formats canonical UTC timestamps in Brasilia time", () => {
    expect(formatConversationDateTime("2026-09-07T17:14:00.000Z")).toBe("07/09/2026, 14:14");
    expect(formatConversationTime("2026-09-07T17:14:00.000Z")).toBe("14:14");
  });

  it("keeps the correct Brasilia calendar date across a UTC day boundary", () => {
    expect(formatConversationDateTime("2026-09-07T02:30:00.000Z")).toBe("06/09/2026, 23:30");
  });

  it("uses an explicit IANA timezone instead of the test runner timezone", () => {
    expect(CONVERSATION_LOCALE).toBe("pt-BR");
    expect(CONVERSATION_TIME_ZONE).toBe("America/Sao_Paulo");
    expect(formatConversationDateTime("not-a-date", "—")).toBe("—");
  });
});
