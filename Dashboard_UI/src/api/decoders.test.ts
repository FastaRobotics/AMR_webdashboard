import { describe, expect, it } from "vitest";

import { decodeRecordingSnapshot, decodeWaypoints } from "./decoders";

describe("decodeWaypoints", () => {
  it("accepts an empty list as a valid available endpoint response", () => {
    expect(decodeWaypoints([])).toEqual([]);
  });

  describe("decodeRecordingSnapshot", () => {
    it("validates bag fields and supplies safe defaults", () => {
      expect(
        decodeRecordingSnapshot({
          recording: true,
          rosbag_name: "run_1",
          duration_s: 12,
          rosbags: [
            { name: "run_1", size_bytes: 64, duration_s: 12, created_at: 3 },
            { name: 42, size_bytes: "bad" },
            { name: "partial" },
          ],
        }),
      ).toEqual({
        recording: true,
        rosbagName: "run_1",
        durationS: 12,
        rosbags: [
          { name: "run_1", size_bytes: 64, duration_s: 12, created_at: 3 },
          {
            name: "partial",
            size_bytes: 0,
            duration_s: 0,
            created_at: undefined,
          },
        ],
      });
    });

    it("handles a missing or malformed outer payload without throwing", () => {
      expect(decodeRecordingSnapshot(null)).toEqual({
        recording: false,
        rosbagName: null,
        durationS: 0,
        rosbags: [],
      });
    });
  });

  it("accepts and preserves valid waypoint data", () => {
    const waypoints = [{ name: "charging_station", x: 1, y: 2, yaw: 0.5 }];
    expect(decodeWaypoints(waypoints)).toEqual(waypoints);
  });

  it("rejects malformed backend payloads", () => {
    expect(() => decodeWaypoints({ waypoints: [] })).toThrow(
      "invalid waypoint list",
    );
    expect(() =>
      decodeWaypoints([{ name: "broken", x: "1", y: 2, yaw: 0 }]),
    ).toThrow("invalid waypoint list");
  });
});
