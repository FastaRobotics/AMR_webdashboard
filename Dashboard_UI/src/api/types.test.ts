import { describe, expect, it } from "vitest";

import { isRobotStreamMessage, isStreamError } from "./types";

describe("robot stream payload guards", () => {
  it("accepts the backend error envelope", () => {
    expect(isStreamError({ error: "robot not connected" })).toBe(true);
    expect(isStreamError({ error: 42 })).toBe(false);
  });

  it("accepts topic envelopes with nullable first-frame data", () => {
    expect(
      isRobotStreamMessage(
        { robot_id: "amr_1", status: "idle", odom: null },
        "odom",
      ),
    ).toBe(true);
  });

  it("rejects missing and malformed topic payloads", () => {
    expect(
      isRobotStreamMessage({ robot_id: "amr_1", status: "idle" }, "odom"),
    ).toBe(false);
    expect(
      isRobotStreamMessage(
        { robot_id: "amr_1", status: "idle", odom: "not an odometry message" },
        "odom",
      ),
    ).toBe(false);
  });
});
