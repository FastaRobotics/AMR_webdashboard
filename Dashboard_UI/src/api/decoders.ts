import type { Waypoint } from "./types";

export interface RosbagEntry {
  name: string;
  size_bytes: number;
  duration_s: number;
  created_at?: number;
}

export interface RecordingSnapshot {
  recording: boolean;
  rosbagName: string | null;
  durationS: number;
  rosbags: RosbagEntry[];
}

export function decodeWaypoints(value: unknown): Waypoint[] {
  if (!Array.isArray(value) || !value.every(isWaypoint)) {
    throw new Error("The backend returned an invalid waypoint list.");
  }
  return value;
}

export function decodeRecordingSnapshot(payload: unknown): RecordingSnapshot {
  const data = isRecord(payload) ? payload : {};
  const rosbags: RosbagEntry[] = Array.isArray(data.rosbags)
    ? data.rosbags.flatMap((entry) => {
        if (!isRecord(entry) || typeof entry.name !== "string") return [];
        return [
          {
            name: entry.name,
            size_bytes:
              typeof entry.size_bytes === "number" ? entry.size_bytes : 0,
            duration_s:
              typeof entry.duration_s === "number" ? entry.duration_s : 0,
            created_at:
              typeof entry.created_at === "number"
                ? entry.created_at
                : undefined,
          },
        ];
      })
    : [];

  return {
    recording: data.recording === true,
    rosbagName: typeof data.rosbag_name === "string" ? data.rosbag_name : null,
    durationS: typeof data.duration_s === "number" ? data.duration_s : 0,
    rosbags,
  };
}

function isWaypoint(value: unknown): value is Waypoint {
  if (typeof value !== "object" || value === null) return false;
  return (
    "name" in value &&
    typeof value.name === "string" &&
    "x" in value &&
    typeof value.x === "number" &&
    "y" in value &&
    typeof value.y === "number" &&
    "yaw" in value &&
    typeof value.yaw === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
