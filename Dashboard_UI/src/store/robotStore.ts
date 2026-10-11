import { create } from "zustand";

import type { RobotConnectionStatus, RobotId, RobotSummary } from "../api/types";

/**
 * rosbridge address per robot.
 *
 * The backend's `POST /connection/{robot_id}/connect` declares
 * `host: str = Body("0.0.0.0")`, and `Robot.connect()` does
 * `Ros(host=host or self.host)`. Because FastAPI fills in that 0.0.0.0 default
 * when the field is omitted, the UI must always send the real address —
 * otherwise the backend is told to connect to 0.0.0.0.
 *
 * These mirror the ROBOTS dict in backend/routers/connection.py. Override them
 * per-robot in the Robot Connection page when a robot has moved networks.
 */
export const ROBOT_ENDPOINTS: Record<RobotId, { host: string; port: number }> = {
  amr_1: { host: "192.168.1.219", port: 9090 },
  go2_1: { host: "192.168.1.220", port: 7070 },
};

interface RobotState {
  /** Fleet as reported by GET /connection/robot_list. */
  robots: RobotSummary[];

  /** Currently selected robot id, shared by every page. */
  selectedRobotId: RobotId | null;

  /** Latest known connection state per robot id. */
  connectionStatus: Record<RobotId, boolean>;

  /** True once the fleet list has been fetched at least once. */
  hasLoadedFleet: boolean;

  /**
   * Fleet-poll bookkeeping. It lives in the store because the poller itself is
   * shared by every `useFleet` consumer (see hooks/useFleet.ts) — one poll for
   * the whole app instead of one per page.
   */
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;

  setRobots: (robots: RobotSummary[]) => void;
  selectRobot: (robotId: RobotId | null) => void;
  setConnectionStatus: (status: RobotConnectionStatus) => void;
  setLoading: (isLoading: boolean) => void;
  setRefreshing: (isRefreshing: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useRobotStore = create<RobotState>()((set, get) => ({
  robots: [],
  selectedRobotId: null,
  connectionStatus: {},
  hasLoadedFleet: false,
  isLoading: true,
  isRefreshing: false,
  error: null,

  /**
   * Replace the fleet list.
   *
   * Keeps the current selection when it is still present, otherwise falls back
   * to the first robot so pages always have a valid target. This is what stops
   * the UI from ever sending an id the backend's Robots enum would reject.
   */
  setRobots: (robots) => {
    const { selectedRobotId } = get();
    const stillPresent =
      selectedRobotId !== null && robots.some((r) => r.id === selectedRobotId);

    set({
      robots,
      hasLoadedFleet: true,
      selectedRobotId: stillPresent
        ? selectedRobotId
        : (robots[0]?.id ?? null),
    });
  },

  selectRobot: (robotId) => set({ selectedRobotId: robotId }),

  setConnectionStatus: ({ robotId, connected }) =>
    set((state) => ({
      connectionStatus: { ...state.connectionStatus, [robotId]: connected },
    })),

  setLoading: (isLoading) => set({ isLoading }),

  setRefreshing: (isRefreshing) => set({ isRefreshing }),

  setError: (error) => set({ error }),

  reset: () =>
    set({
      robots: [],
      selectedRobotId: null,
      connectionStatus: {},
      hasLoadedFleet: false,
      isLoading: true,
      isRefreshing: false,
      error: null,
    }),
}));

/** Convenience selector: the full RobotSummary for the selected robot. */
export function useSelectedRobot(): RobotSummary | null {
  return useRobotStore(
    (state) =>
      state.robots.find((robot) => robot.id === state.selectedRobotId) ?? null,
  );
}

/** Convenience selector: whether the selected robot is known to be connected. */
export function useSelectedRobotConnected(): boolean {
  return useRobotStore((state) =>
    state.selectedRobotId
      ? (state.connectionStatus[state.selectedRobotId] ?? false)
      : false,
  );
}
