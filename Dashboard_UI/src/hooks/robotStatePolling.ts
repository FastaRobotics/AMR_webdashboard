import { apiErrorMessage, getRobotState } from "../api/routes";
import type { SimRobotState } from "../api/types";

const MIN_POLL_INTERVAL_MS = 2000;
const EMPTY_SNAPSHOT: RobotStateSnapshot = {
  state: null,
  isLoading: false,
  error: null,
  unavailable: false,
  lastUpdatedAt: null,
};

export interface RobotStateSnapshot {
  state: SimRobotState | null;
  isLoading: boolean;
  error: string | null;
  unavailable: boolean;
  lastUpdatedAt: number | null;
}

interface RobotStateEntry {
  snapshot: RobotStateSnapshot;
  listeners: Set<() => void>;
  consumers: Map<symbol, number>;
  timer: number | null;
  inFlight: Promise<void> | null;
}

const entries = new Map<string, RobotStateEntry>();

function getEntry(robotId: string): RobotStateEntry {
  let entry = entries.get(robotId);
  if (!entry) {
    entry = {
      snapshot: EMPTY_SNAPSHOT,
      listeners: new Set(),
      consumers: new Map(),
      timer: null,
      inFlight: null,
    };
    entries.set(robotId, entry);
  }
  return entry;
}

function publish(entry: RobotStateEntry, snapshot: RobotStateSnapshot): void {
  entry.snapshot = snapshot;
  entry.listeners.forEach((listener) => listener());
}

export function getRobotStateSnapshot(robotId: string | null): RobotStateSnapshot {
  return robotId ? getEntry(robotId).snapshot : EMPTY_SNAPSHOT;
}

export function subscribeRobotState(
  robotId: string | null,
  listener: () => void,
): () => void {
  if (!robotId) return () => undefined;
  const entry = getEntry(robotId);
  entry.listeners.add(listener);
  return () => entry.listeners.delete(listener);
}

export function refreshRobotState(robotId: string): Promise<void> {
  const entry = getEntry(robotId);
  if (entry.inFlight) return entry.inFlight;

  publish(entry, { ...entry.snapshot, isLoading: true });
  const request = Promise.resolve()
    .then(() => getRobotState(robotId))
    .then((next) => {
      publish(entry, {
        state: next,
        isLoading: false,
        error: null,
        unavailable: next === null,
        lastUpdatedAt: next === null ? entry.snapshot.lastUpdatedAt : Date.now(),
      });
    })
    .catch((error: unknown) => {
      publish(entry, {
        ...entry.snapshot,
        isLoading: false,
        error: apiErrorMessage(error),
      });
    })
    .finally(() => {
      if (entry.inFlight === request) entry.inFlight = null;
    });
  entry.inFlight = request;
  return request;
}

function updateTimer(robotId: string, entry: RobotStateEntry): void {
  if (entry.timer !== null) {
    window.clearInterval(entry.timer);
    entry.timer = null;
  }
  if (entry.consumers.size === 0) return;

  const intervals = [...entry.consumers.values()].filter((interval) => interval > 0);
  if (intervals.length === 0) return;

  const interval = Math.max(MIN_POLL_INTERVAL_MS, Math.min(...intervals));
  entry.timer = window.setInterval(() => {
    void refreshRobotState(robotId);
  }, interval);
}

export function registerRobotStateConsumer(
  robotId: string,
  pollIntervalMs: number,
): () => void {
  const entry = getEntry(robotId);
  const firstConsumer = entry.consumers.size === 0;
  const previousInterval = Math.min(
    ...[...entry.consumers.values()].filter((interval) => interval > 0),
    Number.POSITIVE_INFINITY,
  );
  const consumer = Symbol(robotId);
  entry.consumers.set(consumer, pollIntervalMs);
  updateTimer(robotId, entry);

  if (
    firstConsumer ||
    (pollIntervalMs > 0 &&
      Math.max(MIN_POLL_INTERVAL_MS, pollIntervalMs) < previousInterval)
  ) {
    void refreshRobotState(robotId);
  }

  return () => {
    entry.consumers.delete(consumer);
    updateTimer(robotId, entry);
  };
}

export { EMPTY_SNAPSHOT };
