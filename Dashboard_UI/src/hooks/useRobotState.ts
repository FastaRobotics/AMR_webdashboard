import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { apiErrorMessage, getWaypoints } from "../api/routes";
import type { SimRobotState, Waypoint } from "../api/types";
import {
  getRobotStateSnapshot,
  registerRobotStateConsumer,
  refreshRobotState,
  subscribeRobotState,
} from "./robotStatePolling";
import { usePolling } from "./usePolling";

/**
 * Polls the backend's per-robot state (`GET /sim/robots/{robot_id}`).
 *
 * This is where the dashboard gets everything the five streaming sockets do not
 * carry: battery level, the current task ("mapping" / "exploring" /
 * "navigation"), the goal, the remaining distance, the plan length and the
 * rosbag registry. The production robot backend has no equivalent route, so the
 * hook reports `unavailable` instead of an error when it 404s — pages then fall
 * back to what the WebSocket streams do provide.
 */
export interface UseRobotStateOptions {
  /** Desired poll interval in ms. Consumers share the fastest cadence, floored at 2000ms. */
  pollIntervalMs?: number;
  /** Skip polling entirely (e.g. no robot selected). */
  enabled?: boolean;
}

export interface UseRobotStateReturn {
  state: SimRobotState | null;
  isLoading: boolean;
  error: string | null;
  /** True when the backend answered 404: this API does not exist there. */
  unavailable: boolean;
  lastUpdatedAt: number | null;
  refresh: () => Promise<void>;
}

export function useRobotState(
  robotId: string | null,
  { pollIntervalMs = 2000, enabled = true }: UseRobotStateOptions = {},
): UseRobotStateReturn {
  const snapshot = useSyncExternalStore(
    (listener) => subscribeRobotState(robotId, listener),
    () => getRobotStateSnapshot(robotId),
    () => getRobotStateSnapshot(robotId),
  );

  useEffect(() => {
    if (!robotId || !enabled) return;
    return registerRobotStateConsumer(robotId, pollIntervalMs);
  }, [enabled, pollIntervalMs, robotId]);

  const refresh = useCallback(
    () => (robotId && enabled ? refreshRobotState(robotId) : Promise.resolve()),
    [enabled, robotId],
  );

  return {
    ...snapshot,
    refresh,
  };
}

export interface UseWaypointsReturn {
  waypoints: Waypoint[];
  isLoading: boolean;
  error: string | null;
  /** False when the backend serves no waypoint route (production backend). */
  available: boolean;
  refresh: () => Promise<void>;
}

/**
 * Loads the backend's named waypoints. The production backend stores none (the
 * Navigation page's list is hardcoded there), so an empty list is a normal
 * outcome rather than a failure.
 */
export function useWaypoints(pollIntervalMs = 0): UseWaypointsReturn {
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);

  const loadWaypoints = useCallback(async () => {
    setIsLoading(true);
    try {
      const next = await getWaypoints();
      setWaypoints(next ?? []);
      setAvailable(next !== null);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refresh = usePolling(loadWaypoints, {
    intervalMs: pollIntervalMs,
  });

  return { waypoints, isLoading, error, available, refresh };
}
