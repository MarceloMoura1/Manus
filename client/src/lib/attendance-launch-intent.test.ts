import { describe, expect, it } from "vitest";
import {
  consumeAttendanceLaunchIntent,
  createAttendanceLaunchIntent,
  queueAttendanceLaunchIntent,
} from "./attendance-launch-intent";

describe("supplier attendance launch intent", () => {
  it("is consumed once so closing and remounting Conversations does not reopen the composer", () => {
    const queued = queueAttendanceLaunchIntent(
      createAttendanceLaunchIntent(false),
      "5541999999999",
    );
    expect(queued).toEqual({ activeToken: 1, nextToken: 1, phone: "5541999999999" });

    const consumed = consumeAttendanceLaunchIntent(queued, queued.activeToken);
    expect(consumed).toEqual({ activeToken: 0, nextToken: 1, phone: "" });

    // A remounted child receives no active token, while the monotonic sequence is retained.
    expect(consumed.activeToken).toBe(0);
    expect(queueAttendanceLaunchIntent(consumed, "5541888888888")).toEqual({
      activeToken: 2,
      nextToken: 2,
      phone: "5541888888888",
    });
  });

  it("does not let a stale child consume a newer launch", () => {
    const first = queueAttendanceLaunchIntent(createAttendanceLaunchIntent(false), "551100000001");
    const second = queueAttendanceLaunchIntent(first, "551100000002");
    expect(consumeAttendanceLaunchIntent(second, first.activeToken)).toBe(second);
  });
});
