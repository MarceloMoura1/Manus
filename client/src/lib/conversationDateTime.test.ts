import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  DEFAULT_TIME_ZONE,
  CONVERSATION_LOCALE,
  CONVERSATION_TIME_ZONE,
  formatDate,
  formatShortDate,
  formatTime,
  formatDateTime,
  formatConversationDateTime,
  formatConversationTime,
  parsePlatformDate,
} from "./conversationDateTime";

describe("platform date/time presentation in Brasilia time", () => {
  it("formats canonical UTC timestamps in Brasilia time (17:14Z -> 14:14)", () => {
    const instant = "2026-09-07T17:14:00.000Z";
    expect(formatTime(instant)).toBe("14:14");
    expect(formatConversationTime(instant)).toBe("14:14");
    expect(formatDateTime(instant)).toBe("07/09/2026, 14:14");
    expect(formatConversationDateTime(instant)).toBe("07/09/2026, 14:14");
    expect(formatDate(instant)).toBe("07/09/2026");
    expect(formatShortDate(instant)).toBe("07/09");
  });

  it("handles UTC day boundary correctly (2026-09-08T01:30:00.000Z -> 07/09/2026 22:30)", () => {
    const instant = "2026-09-08T01:30:00.000Z";
    expect(formatTime(instant)).toBe("22:30");
    expect(formatDateTime(instant)).toBe("07/09/2026, 22:30");
    expect(formatDate(instant)).toBe("07/09/2026");
  });

  it("preserves previous calendar date when UTC advances past midnight", () => {
    expect(formatDateTime("2026-09-07T02:30:00.000Z")).toBe("06/09/2026, 23:30");
    expect(formatDate("2026-09-07T02:30:00.000Z")).toBe("06/09/2026");
  });

  it("parses database SQL timestamps without timezone as UTC instants", () => {
    // MySQL TIMESTAMP columns returned as strings (YYYY-MM-DD HH:mm:ss)
    expect(formatTime("2026-09-07 17:44:00")).toBe("14:44");
    expect(formatDateTime("2026-09-07 17:44:00")).toBe("07/09/2026, 14:44");
    expect(formatTime("2026-09-07T17:44:00")).toBe("14:44");
  });

  it("formats interaction card timestamp and message bubble to the EXACT same time at the same instant", () => {
    const messageInstant = "2026-09-07T17:44:00.000Z";
    const interactionInstant = "2026-09-07T17:44:00.000Z";

    const formattedMessageTime = formatConversationTime(messageInstant);
    const formattedInteractionTime = formatTime(interactionInstant);

    expect(formattedMessageTime).toBe("14:44");
    expect(formattedInteractionTime).toBe("14:44");
    expect(formattedMessageTime).toBe(formattedInteractionTime);
  });

  it("supports numeric timestamps in seconds and milliseconds", () => {
    const epochMs = new Date("2026-09-07T17:44:00.000Z").getTime();
    const epochSec = Math.floor(epochMs / 1000);

    expect(formatTime(epochMs)).toBe("14:44");
    expect(formatTime(epochSec)).toBe("14:44");
  });

  it("guarantees host independence with explicit pt-BR and America/Sao_Paulo", () => {
    expect(DEFAULT_LOCALE).toBe("pt-BR");
    expect(DEFAULT_TIME_ZONE).toBe("America/Sao_Paulo");
    expect(CONVERSATION_LOCALE).toBe("pt-BR");
    expect(CONVERSATION_TIME_ZONE).toBe("America/Sao_Paulo");
    expect(formatDateTime("not-a-date", "—")).toBe("—");
    expect(formatTime(null, "--:--")).toBe("--:--");
    expect(formatDate(undefined, "")).toBe("");
    expect(parsePlatformDate("invalid")).toBeNull();
  });
});
