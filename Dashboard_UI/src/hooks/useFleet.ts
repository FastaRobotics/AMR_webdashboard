import { useCallback, useEffect } from "react";

import {
  apiErrorMessage,
  getRobotConnectionStatus,
  getRobotList,
} from "../api/routes";
import type { RobotId, RobotSummary } from "../api/types";
import { useRobotStore } from "../store/robotStore";

const DEFAULT_POLL_INTERVAL_MS = 5000;

interface UseFleetOptions {
  /** Poll connection status on this interval. 0 disables polling. */
  pollIntervalMs?: number;
}

interface UseFleetReturn {
  robots: RobotSummary[];
  selectedRobotId: RobotId | null;
  connectionStatus: Record<RobotId, boolean>;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  selectRobot: (robotId: RobotId) => void;
}

/**
 * Loads the fleet from the backend and keeps per-robot connection state fresh.
 *
 * The backend is the sole source of valid robot ids — only `amr_1` and `go2_1`
 * exist today — so every page must read the id from here rather than hardcode
 * one, otherwise the request is rejected with a 422 by the path enum.
 *
 * The poll is **shared process-wide**: several pages and the always-mounted
 * status bar all call this hook, and one poller for the whole app is both
 * cheaper and more consistent than one per component. The fastest requested
 * interval wins, and polling stops when the last consumer unmounts.
 */

/** One shared poller: how many consumers it has, its cadence and its timer. */
interface FleetPoller {
  consumers: number;
  intervalMs: number;
  timer: number | null;
  inFlight: boolean;
}

const poller: FleetPoller = {
  consumers: 0,
  intervalMs: DEFAULT_POLL_INTERVAL_MS,
  timer: null,
  inFlight: false,
};

function stopTimer(): void {
  if (poller.timer !== null) {
    window.clearInterval(poller.timer);
    poller.timer = null;
  }
}

function startTimer(): void {
  stopTimer();
  if (poller.intervalMs <= 0) return;

  poller.timer = window.setInterval(() => {
    void pollFleet();
  }, poller.intervalMs);
}

/**
 * One fleet refresh, de-duplicated across every mounted consumer.
 *
 * Results land in the zustand store, so consumers re-render through their own
 * selectors — the poller itself needs no subscribers of its own.
 */
async function pollFleet(): Promise<void> {
  if (poller.inFlight) return;
  poller.inFlight = true;

  const store = useRobotStore.getState();
  store.setRefreshing(true);

  try {
    const fleet = await getRobotList();

    /**
     * The backend returns `JSONResponse(content=[])` — a 200 with an empty
     * body rather than `[]` — when the fleet is empty, which axios surfaces as
     * an empty string. Normalise before anything calls .map on it.
     */
    const safeFleet = Array.isArray(fleet) ? fleet : [];

    store.setRobots(safeFleet);
    store.setError(null);

    // Per-robot status. allSettled so one offline robot cannot fail the poll.
    const results = await Promise.allSettled(
      safeFleet.map((robot) => getRobotConnectionStatus(robot.id)),
    );

    results.forEach((result) => {
      if (result.status === "fulfilled") {
        useRobotStore.getState().setConnectionStatus(result.value);
      }
    });
  } catch (err) {
    store.setError(apiErrorMessage(err));
  } finally {
    poller.inFlight = false;
    const state = useRobotStore.getState();
    state.setLoading(false);
    state.setRefreshing(false);
  }
}

/** Force a refresh; used by the explicit "Refresh" buttons. */
export function refreshFleet(): Promise<void> {
  return pollFleet();
}

export function useFleet({
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: UseFleetOptions = {}): UseFleetReturn {
  const robots = useRobotStore((state) => state.robots);
  const selectedRobotId = useRobotStore((state) => state.selectedRobotId);
  const connectionStatus = useRobotStore((state) => state.connectionStatus);
  const isLoading = useRobotStore((state) => state.isLoading);
  const isRefreshing = useRobotStore((state) => state.isRefreshing);
  const error = useRobotStore((state) => state.error);
  const selectRobot = useRobotStore((state) => state.selectRobot);

  const refresh = useCallback(() => pollFleet(), []);

  useEffect(() => {
    poller.consumers += 1;

    // The fastest requested interval drives the shared timer; 0 means "no
    // polling" and must not disable a faster consumer that is already running.
    if (
      poller.consumers === 1 ||
      (pollIntervalMs > 0 && pollIntervalMs < poller.intervalMs)
    ) {
      poller.intervalMs = pollIntervalMs <= 0 ? 0 : pollIntervalMs;
      startTimer();
    }

    // Only the first consumer triggers the initial load.
    if (poller.consumers === 1) {
      void pollFleet();
    }

    return () => {
      poller.consumers -= 1;
      if (poller.consumers <= 0) {
        poller.consumers = 0;
        stopTimer();
      }
    };
  }, [pollIntervalMs]);

  return {
    robots,
    selectedRobotId,
    connectionStatus,
    isLoading,
    isRefreshing,
    error,
    refresh,
    selectRobot,
  };
}
